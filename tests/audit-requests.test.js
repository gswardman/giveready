/**
 * /api/admin/audit-requests (2026-09-24): lists AI Visibility Audit requests
 * posted by the home-page form, for the morning digest.
 * Pure test against a recording D1 stub, same pattern as registry-endpoints.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');

function grab(name) {
  const i = src.indexOf(`async function ${name}(`);
  assert.ok(i > -1, `${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unterminated');
}

const H = new Function(
  'function json(o){return {__json:o};}\n'
  + 'function checkAdminAuth(env, req){ return req.ok ? null : {__denied:true}; }\n'
  + grab('handleAdminAuditRequests') + '\nreturn { handleAdminAuditRequests };'
)();

function stubDb(results) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const rec = { sql, binds: [] }; calls.push(rec);
      const api = { bind(...b) { rec.binds = b; return api; }, async all() { return { results }; } };
      return api;
    },
  };
}
const U = (q) => new URL('https://www.giveready.org/api/admin/audit-requests' + q);

test('rejects without admin auth', async () => {
  const r = await H.handleAdminAuditRequests(stubDb([]), {}, { ok: false }, U(''));
  assert.deepEqual(r, { __denied: true });
});

test('parses the form message and counts non-test requests', async () => {
  const db = stubDb([
    { id: '1', email: 'a@x.org', charity_registration_number: '1182899', status: 'pending', created_at: '2026-09-24 10:00:00',
      message: 'ai-audit | name: City Kids Surfing | website: https://www.getcitykidssurfing.com | reg: 1182899' },
    { id: '2', email: 'geordie@testventures.net', charity_registration_number: 'TEST', status: 'pending', created_at: '2026-09-24 09:00:00',
      message: 'ai-check | TEST from Claude post-deploy check 2026-09-24, ignore' },
  ]);
  const r = (await H.handleAdminAuditRequests(db, {}, { ok: true }, U('?hours=24'))).__json;
  assert.equal(r.window_hours, 24);
  assert.equal(r.count, 1);
  assert.equal(r.count_including_tests, 2);
  assert.equal(r.requests[0].charity, 'City Kids Surfing');
  assert.equal(r.requests[0].website, 'https://www.getcitykidssurfing.com');
  assert.equal(r.requests[0].registration, '1182899');
  assert.equal(r.requests[1].is_test, true);
  assert.deepEqual(db.calls[0].binds, ['-24 hours']);
  assert.match(db.calls[0].sql, /\?1/);
});

test('clamps the window and treats "-" as empty', async () => {
  const db = stubDb([{ id: '3', email: 'b@y.org', charity_registration_number: 'Some Charity', status: 'pending',
    created_at: '2026-09-24 11:00:00', message: 'ai-audit | name: Some Charity | website: - | reg: -' }]);
  const r = (await H.handleAdminAuditRequests(db, {}, { ok: true }, U('?hours=99999'))).__json;
  assert.equal(r.window_hours, 2160);
  assert.equal(r.requests[0].website, null);
  assert.equal(r.requests[0].registration, null);
  const r2 = (await H.handleAdminAuditRequests(stubDb([]), {}, { ok: true }, U('?hours=abc'))).__json;
  assert.equal(r2.window_hours, 168);
});
