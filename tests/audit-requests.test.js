/**
 * /api/admin/audit-requests (2026-09-24): lists AI Visibility Audit requests
 * posted by the home-page form, for the morning digest.
 * Pure test against a recording D1 stub, same pattern as registry-endpoints.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAdminAuditRequests,
  sendAuditRequestEmails,
  auditSig,
  handleAdminAuditStatus,
  handleAuditApprove,
} from '../src/admin/audit.js';
import { handleClaimRequest } from '../src/auth/charity-api.js';

const H = { handleAdminAuditRequests, sendAuditRequestEmails, auditSig, handleAdminAuditStatus, handleAuditApprove, handleClaimRequest };

// The real admin check reads the bearer token off the request and compares it
// with env.ADMIN_TOKEN, so the tests build real Requests: `ok` carries the
// right token, `!ok` a wrong one.
const env = { RESEND_API_KEY: 're_test', ADMIN_TOKEN: 'secret-admin' };
function adminReq(ok, body, url = 'https://www.giveready.org/api/admin/audit-requests') {
  const headers = { Authorization: `Bearer ${ok ? env.ADMIN_TOKEN : 'wrong-token'}` };
  if (body === undefined) return new Request(url, { headers });
  return new Request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function stubDb(results) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const rec = { sql, binds: [] }; calls.push(rec);
      const api = { bind(...b) { rec.binds = b; return api; }, async all() { return { results }; }, async run() { return { meta: { changes: 1 } }; } };
      return api;
    },
  };
}
const U = (q) => new URL('https://www.giveready.org/api/admin/audit-requests' + q);

test('rejects without admin auth', async () => {
  const r = await H.handleAdminAuditRequests(stubDb([]), env, adminReq(false), U(''));
  assert.equal(r.status, 403);
  const noToken = await H.handleAdminAuditRequests(stubDb([]), env, new Request(U('')), U(''));
  assert.equal(noToken.status, 401);
});

test('parses the form message and counts non-test requests', async () => {
  const db = stubDb([
    { id: '1', email: 'a@x.org', charity_registration_number: '1182899', status: 'pending', created_at: '2026-09-24 10:00:00',
      message: 'ai-audit | name: City Kids Surfing | website: https://www.getcitykidssurfing.com | reg: 1182899' },
    { id: '2', email: 'geordie@testventures.net', charity_registration_number: 'TEST', status: 'pending', created_at: '2026-09-24 09:00:00',
      message: 'ai-check | TEST from Claude post-deploy check 2026-09-24, ignore' },
  ]);
  const r = await (await H.handleAdminAuditRequests(db, env, adminReq(true), U('?hours=24'))).json();
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
  const r = await (await H.handleAdminAuditRequests(db, env, adminReq(true), U('?hours=99999'))).json();
  assert.equal(r.window_hours, 2160);
  assert.equal(r.requests[0].website, null);
  assert.equal(r.requests[0].registration, null);
  const r2 = await (await H.handleAdminAuditRequests(stubDb([]), env, adminReq(true), U('?hours=abc'))).json();
  assert.equal(r2.window_hours, 168);
});


// ---- emails, status, approval ------------------------------------------------
function mockFetch(ok = true) {
  const sent = [];
  globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok, status: ok ? 200 : 403, text: async () => 'nope' }; };
  return sent;
}
test('an audit request emails the charity and Geordie; a TEST request emails nobody', async () => {
  const sent = mockFetch();
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const req = (message, email = 'joe@cks.org') => ({ headers: { get: () => '1.2.3.4' },
    json: async () => ({ email, charity_registration_number: 'City Kids Surfing', message }) });
  await H.handleClaimRequest(stubDb([]), req('ai-audit | name: City Kids Surfing | website: https://x.org | reg: 1182899'), env, ctx);
  await Promise.all(waits);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((m) => m.to[0]).sort(), ['geordie@testventures.net', 'joe@cks.org']);
  assert.match(sent.find((m) => m.to[0] === 'joe@cks.org').subject, /City Kids Surfing/);
  const before = sent.length;
  await H.handleClaimRequest(stubDb([]), req('ai-audit | TEST from Claude'), env, ctx);
  await Promise.all(waits);
  assert.equal(sent.length, before);
});

test('a Resend rejection is logged as audit_email_failed', async () => {
  mockFetch(false);
  const db = stubDb([]);
  const ok = await H.sendAuditRequestEmails(env, db, { email: 'a@b.org', message: 'ai-audit | name: X' });
  assert.equal(ok, false);
  // logOnboardingEvent writes one onboarding_events row; the step is bind ?2.
  const log = db.calls.at(-1);
  assert.match(log.sql, /INSERT INTO onboarding_events/);
  assert.equal(log.binds[1], 'audit_email_failed');
});

test('status endpoint: admin only, valid statuses only', async () => {
  const req = (ok, body) => adminReq(ok, body, 'https://www.giveready.org/api/admin/audit-requests/status');
  assert.equal((await H.handleAdminAuditStatus(stubDb([]), env, req(false, {}))).status, 403);
  const bad = await H.handleAdminAuditStatus(stubDb([]), env, req(true, { id: '1', status: 'hacked' }));
  assert.equal(bad.status, 400);
  const db = stubDb([]); db.prepare = ((orig) => (sql) => { const a = orig(sql); a.run = async () => ({ meta: { changes: 1 } }); return a; })(db.prepare.bind(db));
  const good = await H.handleAdminAuditStatus(db, env, req(true, { id: '1', status: 'audit_drafted' }));
  assert.equal(good.status, 200);
  assert.deepEqual(db.calls.at(-1).binds.slice(0, 1), ['audit_drafted']);
});

test('approve link: wrong signature refused, right one approves only a drafted audit', async () => {
  const sig = await H.auditSig(env, 'abc');
  assert.equal(sig.length, 64);
  const row = (status) => ({ status, email: 'joe@cks.org', message: 'ai-audit | name: City Kids Surfing' });
  function db(status) {
    const calls = [];
    return { calls, prepare(sql) { const rec = { sql, binds: [] }; calls.push(rec);
      const api = { bind(...b) { rec.binds = b; return api; }, async first() { return row(status); }, async run() { return { meta: { changes: 1 } }; } };
      return api; } };
  }
  const U = (q) => new URL('https://www.giveready.org/api/admin/audit-approve' + q);
  const forged = await H.handleAuditApprove(db('audit_drafted'), env, U('?id=abc&sig=' + '0'.repeat(64)));
  assert.equal(forged.status, 403);
  const d1 = db('audit_drafted');
  const ok = await H.handleAuditApprove(d1, env, U(`?id=abc&sig=${sig}`));
  assert.equal(ok.status, 200);
  assert.ok(d1.calls.some((c) => /SET status = 'audit_approved'/.test(c.sql)));
  const d2 = db('pending');
  const notReady = await H.handleAuditApprove(d2, env, U(`?id=abc&sig=${sig}`));
  assert.equal(notReady.status, 409);
  assert.ok(!d2.calls.some((c) => /audit_approved/.test(c.sql)));
});
