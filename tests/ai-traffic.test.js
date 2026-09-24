/**
 * /api/ai-traffic and /api/ai-traffic/profile (2026-09-24): the home page's
 * live AI-traffic figures. Guards the cost contract: with fresh cache rows a
 * request reads stats_cache only and never scans discovery_hits. Only a
 * missing/stale row triggers a scan, which writes the cache back. Also guards
 * which user agents count as "AI" and the per-charity lookup.
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
function grabConst(name, end) {
  const i = src.indexOf(`const ${name} =`);
  assert.ok(i > -1, `${name} not found`);
  return src.slice(i, src.indexOf(end, i) + end.length);
}
const H = new Function(
  'const CORS_HEADERS = {};\nfunction json(o, s){ return { __json: o, status: s || 200 }; }\n' +
  grabConst('AI_VENDORS', '];') + '\n' + grabConst('AI_COMPANIES', '];') + '\n' + grabConst('AI_COMPANY_SQL', '`;') + '\n' +
  ['aiVendorFor', 'aiCompanyFor', 'cachedJson'].map((n) => grab(n, 'function')).join('\n') + '\n' +
  ['refreshAiTraffic', 'refreshAiTraffic30d', 'readCache', 'handleAiTraffic', 'handleAiTrafficProfile'].map((n) => grab(n)).join('\n') +
  '\nreturn { aiVendorFor, aiCompanyFor, handleAiTraffic, handleAiTrafficProfile };'
)();

// cache: { key: valueObject } for fresh rows; hits: discovery_hits GROUP BY rows
function stubDb({ cache = {}, hits = [], rollup = 10170 } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const rec = { sql, binds: [] }; calls.push(rec);
      const api = {
        bind(...b) { rec.binds = b; return api; },
        async first() {
          if (/FROM stats_cache/.test(sql)) { const v = cache[rec.binds[0]]; return v ? { value: JSON.stringify(v) } : null; }
          if (/FROM traffic_rollup/.test(sql)) return { n: rollup };
          return null;
        },
        async all() { return { results: hits }; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return api;
    },
  };
}

test('feed vendors: only OpenAI, Anthropic, Perplexity', () => {
  assert.equal(H.aiVendorFor('GPTBot/1.1'), 'OpenAI (ChatGPT)');
  assert.equal(H.aiVendorFor('ClaudeBot/1.0'), 'Anthropic (Claude)');
  assert.equal(H.aiVendorFor('PerplexityBot/1.0'), 'Perplexity');
  assert.equal(H.aiVendorFor('Googlebot/2.1'), null);
});

test('monthly companies: AI and search firms, never SEO tools', () => {
  assert.equal(H.aiCompanyFor('Mozilla/5.0 (compatible; Googlebot/2.1)'), 'Google');
  assert.equal(H.aiCompanyFor('Applebot/0.1'), 'Apple');
  assert.equal(H.aiCompanyFor('Amazonbot/0.1'), 'Amazon');
  assert.equal(H.aiCompanyFor('bingbot/2.0'), 'Microsoft');
  assert.equal(H.aiCompanyFor('SemrushBot/7'), null);
  assert.equal(H.aiCompanyFor('PetalBot'), null);
});

test('fresh caches: stats_cache reads only, no discovery_hits scan', async () => {
  const db = stubDb({ cache: {
    ai_traffic_7d: { total: 2089, bot_visits_7d: 10170, recent: [] },
    ai_traffic_30d: { total: 33000, by_company: { OpenAI: 7028 }, profiles_read: 2014, profiles: { 'city-kids-surfing': 6 } },
  } });
  const res = await H.handleAiTraffic(db);
  const body = JSON.parse(await res.text());
  assert.equal(body.total, 2089);
  assert.equal(body.month.profiles_read, 2014);
  assert.equal(body.month.profiles, undefined, 'per-slug map must not ship to every visitor');
  assert.ok(db.calls.every((c) => !/discovery_hits/.test(c.sql)));
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=600');
});

test('missing caches: scans once each, writes both back', async () => {
  const db = stubDb({ hits: [
    { user_agent: 'ClaudeBot/1.0', route: '/nonprofits/city-kids-surfing', hits: 6, last_hit: '2026-09-20 10:00:00' },
    { user_agent: 'PerplexityBot/1.0', route: '/causes/surf-therapy', hits: 1, last_hit: '2026-09-24 08:51:15' },
    { user_agent: 'Googlebot/2.1', route: '/nonprofits/bridges-for-music', hits: 3, last_hit: '2026-09-23 12:00:00' },
    { user_agent: 'SemrushBot/7', route: '/nonprofits/x', hits: 50, last_hit: '2026-09-23 12:00:00' },
  ] });
  const body = JSON.parse(await (await H.handleAiTraffic(db)).text());
  assert.equal(body.total, 7);                 // feed: Claude + Perplexity only
  assert.equal(body.bot_visits_7d, 10170);
  assert.equal(body.recent[0].route, '/causes/surf-therapy');
  assert.equal(body.month.total, 10);          // + Google, never Semrush
  assert.equal(body.month.profiles_read, 2);
  const writes = db.calls.filter((c) => /INSERT OR REPLACE INTO stats_cache/.test(c.sql));
  assert.equal(writes.length, 2);
});

test('profile lookup reads one cached row', async () => {
  const db = stubDb({ cache: { ai_traffic_30d: { profiles: { 'city-kids-surfing': 6 } } } });
  const U = (q) => new URL('https://www.giveready.org/api/ai-traffic/profile' + q);
  const hit = JSON.parse(await (await H.handleAiTrafficProfile(db, U('?slug=city-kids-surfing'))).text());
  assert.equal(hit.visits, 6);
  const miss = JSON.parse(await (await H.handleAiTrafficProfile(db, U('?slug=nobody-read-me'))).text());
  assert.equal(miss.visits, 0);
  const bad = await H.handleAiTrafficProfile(db, U('?slug=../../etc'));
  assert.equal(bad.status, 400);
  assert.ok(db.calls.every((c) => !/discovery_hits/.test(c.sql)));
});
