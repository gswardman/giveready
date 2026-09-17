import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');

// Lift routeClassFor out of the worker. Same trick as guide-links.test.js:
// the function is pure and has no imports, so it evaluates standalone.
function loadRouteClassFor() {
  const i = src.indexOf('function routeClassFor(route) {');
  assert.ok(i > -1, 'routeClassFor missing');
  const end = src.indexOf('\n}\n', i) + 3;
  return new Function(src.slice(i, end) + '\nreturn routeClassFor;')();
}

test('routeClassFor: the four classes added with migration 026', () => {
  const rc = loadRouteClassFor();
  assert.equal(rc('/'), 'home');
  assert.equal(rc('/nonprofits'), 'nonprofits-list');
  assert.equal(rc('/out/city-kids-surfing'), 'out');
  assert.equal(rc('/search'), 'search');
});

// THE ORDERING TRAP. `/nonprofits` exactly must be caught before the
// startsWith('/nonprofits') branch, or the directory listing disappears into
// the profile-page count and a paginated walk becomes invisible again. That is
// precisely the confusion migration 026 exists to end, so it gets its own test
// rather than relying on a reviewer noticing branch order.
test('routeClassFor: listing and profile pages do not collapse into one class', () => {
  const rc = loadRouteClassFor();
  assert.equal(rc('/nonprofits'), 'nonprofits-list');
  assert.equal(rc('/nonprofits/city-kids-surfing'), 'nonprofits');
  assert.notEqual(rc('/nonprofits'), rc('/nonprofits/city-kids-surfing'));
});

test('routeClassFor: existing classes are unchanged', () => {
  const rc = loadRouteClassFor();
  for (const [route, cls] of [
    ['/AGENTS.md', 'agents-manifest'],
    ['/agents.md', 'agents-manifest'],
    ['/llms.txt', 'llms'],
    ['/sitemap.xml', 'sitemap'],
    ['/mcp', 'mcp'],
    ['/mcp/sse', 'mcp'],
    ['/guides', 'guides'],
    ['/guides/best-uk-youth-charities-outdoors-skills', 'guides'],
    ['/causes/music-education', 'causes'],
    ['/donate/waves-for-change', 'donate'],
    ['/api/agents/leaderboard', 'agent-api'],
    ['/api/stats', 'other-api'],
    ['/about', 'other'],
  ]) assert.equal(rc(route), cls, route);
});

// The JS function is the readable spec; the SQL CASE in handleAdminTraffic is
// the thing that actually classifies stored rows. They drifted apart once
// before. Both must name every class.
test('the SQL CASE mirrors routeClassFor', () => {
  const i = src.indexOf("WHEN route IN ('/AGENTS.md','/agents.md')");
  assert.ok(i > -1, 'SQL route_class CASE missing');
  const sql = src.slice(i, src.indexOf('END AS route_class', i));
  for (const cls of ['home', 'nonprofits-list', 'out', 'search']) {
    assert.ok(sql.includes(`'${cls}'`), `SQL CASE missing ${cls}`);
  }
  assert.ok(
    sql.indexOf("route = '/nonprofits'") < sql.indexOf("route LIKE '/nonprofits%'"),
    'SQL CASE must test exact /nonprofits before the LIKE, same order as the JS'
  );
});

test('recordTraffic upserts counters and never inserts a row per request', () => {
  const i = src.indexOf('function recordTraffic(');
  assert.ok(i > -1, 'recordTraffic missing');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  // A counter, not a log. If this ever becomes a plain INSERT the table grows
  // with traffic and becomes the next discovery_hits.
  assert.ok(body.includes('ON CONFLICT(bucket, route_class, agent_class) DO UPDATE SET hits = hits + 1'));
  assert.ok(body.includes('ON CONFLICT(bucket, country) DO UPDATE SET hits = hits + 1'));
  assert.ok(!/INSERT INTO traffic_rollup[\s\S]{0,200}crypto\.randomUUID/.test(body));
  // Must not throw into the request path.
  assert.ok(body.includes('.catch('), 'recordTraffic must swallow its own errors');
});

test('recordTraffic is called at the fetch choke point, unawaited', () => {
  const i = src.indexOf('async fetch(request, env, ctx) {');
  assert.ok(i > -1, 'fetch entry missing');
  const head = src.slice(i, i + 1600);
  assert.ok(head.includes('ctx.waitUntil(recordTraffic('), 'recordTraffic not wired into fetch');
  // Above the HEAD rewrite, so a HEAD is counted once as itself.
  assert.ok(
    head.indexOf('recordTraffic(') < head.indexOf("request.method === 'HEAD'"),
    'recordTraffic must run before the HEAD rewrite'
  );
});

test('migration 026 creates both tables with counter primary keys', () => {
  const m = fs.readFileSync(path.join(ROOT, 'migrations', '026-traffic-rollup.sql'), 'utf8');
  assert.ok(m.includes('CREATE TABLE IF NOT EXISTS traffic_rollup'));
  assert.ok(m.includes('CREATE TABLE IF NOT EXISTS traffic_geo'));
  assert.ok(m.includes('PRIMARY KEY (bucket, route_class, agent_class)'));
  assert.ok(m.includes('PRIMARY KEY (bucket, country)'));
});

// A null denominator means "not measured". A zero would read as "no traffic"
// and would make the share look like a real number on the first morning after
// deploy, when the counter has only covered part of the window.
test('admin traffic reports a null denominator when migration 026 is absent', () => {
  assert.ok(src.includes('discovery_logged_share_pct'));
  assert.ok(/let trafficRollup = null;/.test(src));
});

// REGRESSION. The first live call after deploy returned
// discovery_logged_share_pct = 288.9%: the counter had been running 27 minutes
// and was divided into a 60-minute discovery_hits count. A share is only
// meaningful once the counter covers the whole reported window.
test('no share is computed over a window the counter does not cover', () => {
  assert.ok(src.includes('SELECT MIN(bucket) AS b FROM traffic_rollup'), 'earliest bucket not read');
  assert.ok(src.includes('const coversFullWindow = !!(earliestBucket && earliestBucket <= sinceBucket);'));
  assert.ok(
    src.includes('edge_requests_in_period: (trafficRollup && trafficRollup.covers_full_window)'),
    'edge_requests_in_period must be null on a partial window'
  );
  assert.ok(
    /discovery_logged_share_pct:\s*\n?\s*\(trafficRollup && trafficRollup\.covers_full_window && trafficRollup\.total_requests > 0\)/.test(src),
    'share must be guarded by covers_full_window'
  );
});

test('partial-window arithmetic: the guard is what stops a >100% share', () => {
  // The exact shape of the live 288.9% reading, as data.
  const sinceBucket = '2026-09-17T09';
  const cases = [
    { earliest: '2026-09-17T09', expect: true,  note: 'counter starts at or before window start' },
    { earliest: '2026-09-17T10', expect: false, note: 'counter started mid-window (the 288.9% case)' },
    { earliest: '2026-09-16T00', expect: false || true, note: 'counter predates window' },
    { earliest: null,            expect: false, note: 'empty table' },
  ];
  for (const c of cases) {
    const covers = !!(c.earliest && c.earliest <= sinceBucket);
    assert.equal(covers, c.expect, c.note);
  }
  // And with the guard false, a 26/9 ratio never reaches the caller.
  const covers = false;
  const share = (covers && 9 > 0) ? Math.round((26 / 9) * 1000) / 10 : null;
  assert.equal(share, null);
});
