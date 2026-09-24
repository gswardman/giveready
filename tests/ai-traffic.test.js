/**
 * /api/ai-traffic (2026-09-24): the home page's live AI-visits count.
 * Guards the cost contract: a fresh cache row is served with ONE read and no
 * discovery_hits scan; only a missing/stale row triggers the scan, which then
 * writes the cache back. Also guards the vendor filter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
function grab(name, kw = 'async function') {
  const i = src.indexOf(`${kw} ${name}(`);
  assert.ok(i > -1, `${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unterminated');
}
const vendors = src.slice(src.indexOf('const AI_VENDORS'), src.indexOf('];', src.indexOf('const AI_VENDORS')) + 2);
const H = new Function(
  'const CORS_HEADERS = {};\n' + vendors + '\n' + grab('aiVendorFor', 'function') + '\n' +
  grab('refreshAiTraffic') + '\n' + grab('handleAiTraffic') +
  '\nreturn { aiVendorFor, refreshAiTraffic, handleAiTraffic };'
)();

function stubDb({ cached = null, hits = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const rec = { sql, binds: [] }; calls.push(rec);
      const api = {
        bind(...b) { rec.binds = b; return api; },
        async first() { return cached; },
        async all() { return { results: hits }; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return api;
    },
  };
}

test('vendor filter: only OpenAI, Anthropic, Perplexity', () => {
  assert.equal(H.aiVendorFor('Mozilla/5.0 ... GPTBot/1.1'), 'OpenAI (ChatGPT)');
  assert.equal(H.aiVendorFor('compatible; ClaudeBot/1.0; +claudebot@anthropic.com'), 'Anthropic (Claude)');
  assert.equal(H.aiVendorFor('PerplexityBot/1.0'), 'Perplexity');
  assert.equal(H.aiVendorFor('Googlebot/2.1'), null);
  assert.equal(H.aiVendorFor('SemrushBot/7'), null);
  assert.equal(H.aiVendorFor('bingbot/2.0'), null);
});

test('fresh cache row: one read, no scan', async () => {
  const cached = { value: JSON.stringify({ total: 2089, recent: [] }), updated_at: '2026-09-24 09:00:00' };
  const db = stubDb({ cached });
  const res = await H.handleAiTraffic(db);
  const body = JSON.parse(await res.text());
  assert.equal(body.total, 2089);
  assert.equal(db.calls.length, 1);
  assert.doesNotMatch(db.calls[0].sql, /discovery_hits/);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=600');
});

test('missing cache: scans once, sums by vendor, writes back, newest first', async () => {
  const db = stubDb({ cached: null, hits: [
    { user_agent: 'ClaudeBot/1.0', route: '/nonprofits/a', hits: 10, last_hit: '2026-09-20 10:00:00' },
    { user_agent: 'PerplexityBot/1.0', route: '/causes/surf-therapy', hits: 1, last_hit: '2026-09-24 08:51:15' },
    { user_agent: 'GPTBot/1.1', route: '/guides/x', hits: 4, last_hit: '2026-09-23 12:00:00' },
  ] });
  const body = JSON.parse(await (await H.handleAiTraffic(db)).text());
  assert.equal(body.total, 15);
  assert.equal(body.by_vendor['Anthropic (Claude)'], 10);
  assert.equal(body.recent[0].route, '/causes/surf-therapy');
  assert.ok(db.calls.some((c) => /FROM discovery_hits/.test(c.sql)));
  const write = db.calls.find((c) => /INSERT OR REPLACE INTO stats_cache/.test(c.sql));
  assert.ok(write, 'cache written back');
  assert.equal(JSON.parse(write.binds[0]).total, 15);
});
