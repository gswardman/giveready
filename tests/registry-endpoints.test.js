/**
 * Unit tests for the registry endpoints and the trust filters on /api/search.
 *
 * Run with:  node --test tests/registry-endpoints.test.js
 *
 * WHAT THESE GUARD (2026-08-27)
 * The daily IRS registry check ran for five days and matched zero rows. Nothing
 * caught it because every individual piece looked fine: the endpoint returned
 * 200, the JSON parsed, the loop completed. The defects were in the seams.
 * These tests cover the seams:
 *
 *   1. Positional placeholder / bind-count agreement. Every filter added to
 *      handleSearch pushes a param and renumbers ?N. Get that wrong and D1
 *      throws at runtime, in production, on a query nobody runs in dev.
 *   2. `page` actually moving the offset. It was accepted and ignored, so
 *      page=1 and page=20 returned identical rows for months.
 *   3. `country` producing a filtered total. The unfiltered count came back for
 *      every value, which reads as "41,227 organisations in Bermuda".
 *   4. The EIN join excluding non-US registration numbers. UK charity numbers
 *      are 6-8 digits and zero-pad into US EIN space.
 *
 * These are PURE tests against a recording stub. They assert the SQL that would
 * be sent, not the rows that come back. Integration against live D1 belongs
 * elsewhere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pull the handlers out of the Worker source by brace matching. */
function loadHandlers() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
  const grab = (name) => {
    const i = src.indexOf(`async function ${name}(`);
    assert.ok(i > -1, `${name} not found in src/index.js`);
    let depth = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
    }
    throw new Error(`unterminated ${name}`);
  };
  const names = ['handleSearch', 'handleListNonprofits', 'handleRegistryEins', 'handleRegistryRevoked'];
  const body = 'function json(o){return {__json:o};}\n'
    + names.map(grab).join('\n\n')
    + `\nreturn {${names.join(',')}};`;
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

const H = loadHandlers();

function stubDb() {
  const calls = [];
  const db = {
    prepare(sql) {
      const rec = { sql, binds: [] };
      calls.push(rec);
      const api = {
        bind(...b) { rec.binds = b; return api; },
        async all() { return { results: [] }; },
        async first() { return { count: 0 }; },
        run() { return { catch() {} }; },
      };
      return api;
    },
  };
  return { db, calls };
}

const U = (p) => new URL('https://www.giveready.org' + p);

/** Every ?N in the SQL must be covered by a bind, with no gaps. */
function assertPlaceholders(rec, label) {
  const used = [...new Set([...rec.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])))];
  const max = used.length ? Math.max(...used) : 0;
  for (let i = 1; i <= max; i++) {
    assert.ok(used.includes(i), `${label}: placeholder ?${i} is skipped`);
  }
  assert.equal(max, rec.binds.length, `${label}: ?1..?${max} but ${rec.binds.length} binds`);
}

const SEARCH_CASES = [
  ['plain', '/api/search?cause=music-education'],
  ['verified', '/api/search?cause=music-education&verified=1'],
  ['safe_to_recommend', '/api/search?cause=music-education&safe_to_recommend=1'],
  ['safe + freshness', '/api/search?cause=music-education&safe_to_recommend=1&checked_within_hours=24'],
  ['explicit status + freshness', '/api/search?cause=x&registry_status=revoked&checked_within_hours=168'],
  ['every filter at once', '/api/search?q=surf&cause=x&country=United+Kingdom&ghd_aligned=1&verified=1&registry_status=good_standing&checked_within_hours=24'],
];

for (const [label, url] of SEARCH_CASES) {
  test(`handleSearch binds match placeholders: ${label}`, async () => {
    const { db, calls } = stubDb();
    await H.handleSearch(db, U(url));
    const queries = calls.filter((c) => /FROM nonprofits n/.test(c.sql));
    assert.ok(queries.length > 0, 'no directory query issued');
    queries.forEach((q) => assertPlaceholders(q, label));
  });
}

test('handleSearch: safe_to_recommend pins good_standing without a bind', async () => {
  const { db, calls } = stubDb();
  await H.handleSearch(db, U('/api/search?cause=x&safe_to_recommend=1'));
  const q = calls.find((c) => /FROM nonprofits n/.test(c.sql));
  assert.match(q.sql, /registry_status = 'good_standing'/);
});

test('handleSearch: safe_to_recommend beats an explicit registry_status', async () => {
  const { db, calls } = stubDb();
  await H.handleSearch(db, U('/api/search?cause=x&safe_to_recommend=1&registry_status=revoked'));
  const q = calls.find((c) => /FROM nonprofits n/.test(c.sql));
  assert.ok(!q.binds.includes('revoked'), 'revoked must not be bound when safe_to_recommend is set');
});

test('handleSearch: results carry the registry columns', async () => {
  const { db, calls } = stubDb();
  await H.handleSearch(db, U('/api/search?cause=x'));
  const q = calls.find((c) => /FROM nonprofits n/.test(c.sql));
  for (const col of ['registry_status', 'registry_status_source_date', 'registry_status_checked_at']) {
    assert.match(q.sql, new RegExp(`n\\.${col}`), `missing ${col}`);
  }
});

test('handleListNonprofits: page moves the offset', async () => {
  const { db } = stubDb();
  const r = await H.handleListNonprofits(db, U('/api/nonprofits?page=5&limit=100'));
  assert.equal(r.__json.offset, 400);
});

test('handleListNonprofits: page=1 and no page agree', async () => {
  const { db } = stubDb();
  const a = await H.handleListNonprofits(db, U('/api/nonprofits?limit=50'));
  const b = await H.handleListNonprofits(db, U('/api/nonprofits?page=1&limit=50'));
  assert.equal(a.__json.offset, b.__json.offset);
});

test('handleListNonprofits: explicit offset beats page', async () => {
  const { db } = stubDb();
  const r = await H.handleListNonprofits(db, U('/api/nonprofits?offset=77&page=9&limit=10'));
  assert.equal(r.__json.offset, 77);
});

test('handleListNonprofits: country filters the total too', async () => {
  const { db, calls } = stubDb();
  await H.handleListNonprofits(db, U('/api/nonprofits?country=United+Kingdom'));
  const counts = calls.filter((c) => /COUNT\(\*\)/.test(c.sql));
  assert.equal(counts.length, 1);
  assert.match(counts[0].sql, /WHERE LOWER\(country\)/, 'total ignored the country filter');
  calls.forEach((c) => assertPlaceholders(c, 'list country'));
});

test('handleListNonprofits: paging order is a total order', async () => {
  const { db, calls } = stubDb();
  await H.handleListNonprofits(db, U('/api/nonprofits?page=2'));
  const q = calls.find((c) => /SELECT id, slug/.test(c.sql));
  assert.match(q.sql, /ORDER BY[^)]*,\s*id\b/, 'ORDER BY must end in id or OFFSET paging can skip rows');
});

test('handleRegistryEins: cursor and limit are bound in order', async () => {
  const { db, calls } = stubDb();
  await H.handleRegistryEins(db, U('/api/registry/eins?cursor=every-2&limit=50'));
  assert.deepEqual(calls[0].binds, ['every-2', 50]);
  assertPlaceholders(calls[0], 'eins');
});

test('handleRegistryEins: excludes non-US registration numbers', async () => {
  const { db, calls } = stubDb();
  await H.handleRegistryEins(db, U('/api/registry/eins'));
  assert.match(
    calls[0].sql,
    /country = 'United States' OR type LIKE '501\(c\)%'/,
    'UK charity numbers zero-pad into US EIN space; the country filter is what stops that',
  );
});

test('handleRegistryEins: returns both raw EIN sources, not just the COALESCE', async () => {
  const { db, calls } = stubDb();
  await H.handleRegistryEins(db, U('/api/registry/eins'));
  assert.match(calls[0].sql, /reg\.ein AS ein_registrations/);
  assert.match(calls[0].sql, /idein\.ein AS ein_id_pattern/);
  // Without both, agreement between the real registration and the id-derived
  // guess cannot be measured, and the guess covers ~86% of the directory.
});

test('handleRegistryEins: only 9-digit-shaped ids are used as a fallback key', async () => {
  const { db, calls } = stubDb();
  await H.handleRegistryEins(db, U('/api/registry/eins'));
  assert.match(calls[0].sql, /GLOB 'every-(\[0-9\]){9}'/);
});

test('handleRegistryRevoked: revoked and reinstated stay in separate arrays', async () => {
  const { db } = stubDb();
  const r = await H.handleRegistryRevoked(db, U('/api/registry/revoked'));
  assert.ok(Array.isArray(r.__json.revoked));
  assert.ok(Array.isArray(r.__json.reinstated));
  assert.ok(!('nonprofits' in r.__json), 'a merged list would publish an accusation against reinstated charities');
});
