/**
 * GiveReady — AI audit requests: notification emails, approval link, admin status/list endpoints.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { logOnboardingEvent } from '../lib/funnel.js';
import { escHtml } from '../lib/html.js';
import { json } from '../lib/http.js';
import { checkAdminAuth } from './auth.js';

// ── AI Visibility Audit: emails, status and approval (2026-09-24) ────────
//
// Flow: the home-page form posts an "ai-audit | ..." claim_request (status
// 'pending'). The charity gets a confirmation and Geordie gets a notification,
// both via Resend. The hourly audit pipeline (GitHub Actions, in a separate
// private repo) drafts the report, sets 'audit_drafted' and
// emails Geordie the PDF with a signed approve link. Clicking it sets
// 'audit_approved'; the next pipeline run sends the PDF to the charity and
// sets 'audit_sent'. A bad run sets 'audit_failed'.
const AUDIT_NOTIFY_TO = 'geordie@testventures.net';
const AUDIT_FROM = 'GiveReady <audit@giveready.org>';
export const AUDIT_STATUSES = ['pending', 'audit_drafted', 'audit_approved', 'audit_sent', 'audit_failed', 'audit_skipped'];

async function sendResend(env, msg) {
  if (!env.RESEND_API_KEY) { console.error('[Resend] RESEND_API_KEY is not set'); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!r.ok) { console.error('[Resend] send failed:', r.status, await r.text()); return false; }
    return true;
  } catch (e) {
    console.error('[Resend] network error:', (e && e.message) || e);
    return false;
  }
}

// escHtml is defined once, near the top of the file (duplicate removed 2026-09-25: it stopped the Worker loading).

function auditField(msg, key) {
  const m = (msg || '').match(new RegExp(key + ':\\s*([^|]*)'));
  const v = m ? m[1].trim() : '';
  return v && v !== '-' ? v : null;
}

export async function sendAuditRequestEmails(env, db, req) {
  const name = auditField(req.message, 'name') || req.charity_registration_number || 'your charity';
  const website = auditField(req.message, 'website');
  const toCharity = sendResend(env, {
    from: AUDIT_FROM, to: [req.email], reply_to: AUDIT_NOTIFY_TO,
    subject: `Your AI Visibility Audit for ${name} is on its way`,
    text: `Hi,\n\nThanks for asking for a free AI Visibility Audit for ${name}.\n\n` +
      `We're asking ChatGPT, Claude and Perplexity the questions your donors, the people you help and funders ask, ` +
      `and checking your website. Your report arrives by email as a PDF within two working days: your score, ` +
      `who AI names instead of you, and the fixes in order.\n\nIf you have questions in the meantime, just reply to this email.\n\n` +
      `Geordie Wardman\nGiveReady (giveready.org)\n`,
  });
  const toGeordie = sendResend(env, {
    from: AUDIT_FROM, to: [AUDIT_NOTIFY_TO], reply_to: req.email,
    subject: `New AI audit request: ${name}`,
    html: `<p><b>${escHtml(name)}</b> asked for an AI Visibility Audit.</p><ul>` +
      `<li>Email: ${escHtml(req.email)}</li><li>Website: ${escHtml(website || '-')}</li>` +
      `<li>Registration: ${escHtml(auditField(req.message, 'reg') || '-')}</li></ul>` +
      `<p>The hourly pipeline will draft the report and send it to you for approval.</p>`,
  });
  const [a, b] = await Promise.all([toCharity, toGeordie]);
  if (!a || !b) {
    try {
      await logOnboardingEvent(db, 'audit_email_failed', {
        email: req.email, outcome: 'fail', reason: `Resend rejected: charity=${a ? 'ok' : 'fail'} notify=${b ? 'ok' : 'fail'}`,
      });
    } catch (e) { /* logging must never fail the request */ }
  }
  return a && b;
}

export async function auditSig(env, id) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_TOKEN || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('approve:' + id));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/admin/audit-requests/status  {id, status, note?}  (admin token)
export async function handleAdminAuditStatus(db, env, request) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!id || !AUDIT_STATUSES.includes(status)) return json({ error: 'id and a valid status required', allowed: AUDIT_STATUSES }, 400);
  const r = await db.prepare(
    `UPDATE claim_requests SET status = ?1, reviewed_by = ?2, reviewed_at = datetime('now')
      WHERE id = ?3 AND (message LIKE 'ai-audit |%' OR message LIKE 'ai-check |%')`
  ).bind(status, String(body.note || 'audit-pipeline').slice(0, 200), id).run();
  const changed = (r && r.meta && r.meta.changes) || 0;
  return json({ id, status, updated: changed }, changed ? 200 : 404);
}

// GET /api/admin/audit-approve?id=&sig=  (signed link emailed to Geordie; no token in the URL)
export async function handleAuditApprove(db, env, url) {
  const id = url.searchParams.get('id') || '';
  const sig = url.searchParams.get('sig') || '';
  const page = (title, body, status = 200) => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escHtml(title)}</title><body style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;line-height:1.5">` +
    `<h1 style="font-size:22px">${escHtml(title)}</h1><p>${body}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!id || !/^[0-9a-f]{64}$/.test(sig)) return page('Link not valid', 'This approval link is incomplete.', 400);
  const expected = await auditSig(env, id);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return page('Link not valid', 'This approval link does not match.', 403);
  const row = await db.prepare(`SELECT status, email, message FROM claim_requests WHERE id = ?1`).bind(id).first();
  if (!row) return page('Not found', 'No audit request with that id.', 404);
  const name = escHtml(auditField(row.message, 'name') || 'this charity');
  if (row.status === 'audit_sent') return page('Already sent', `The audit for ${name} has already gone out.`);
  if (row.status === 'audit_approved') return page('Already approved', `The audit for ${name} is queued and goes out within the hour.`);
  if (row.status !== 'audit_drafted') return page('Not ready', `The audit for ${name} is not waiting for approval (status: ${escHtml(row.status)}).`, 409);
  await db.prepare(`UPDATE claim_requests SET status = 'audit_approved', reviewed_by = 'geordie-approve-link', reviewed_at = datetime('now') WHERE id = ?1`).bind(id).run();
  return page('Approved', `The audit for ${name} goes to ${escHtml(row.email)} within the hour.`);
}

// AI Visibility Audit requests (2026-09-24). The home-page form posts to
// /api/charity/claim-request with a message starting "ai-audit |" (or the
// earlier "ai-check |"). This lists them for the morning digest so a lead is
// seen the day it arrives. Read-only, admin token required.
export async function handleAdminAuditRequests(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;
  let hours = parseInt(url.searchParams.get('hours') || '168', 10);
  if (!Number.isFinite(hours) || hours < 1) hours = 168;
  if (hours > 2160) hours = 2160;
  const status = url.searchParams.get('status');
  const statusSql = status && AUDIT_STATUSES.includes(status) ? ' AND status = ?2' : '';
  const stmt = db.prepare(`
    SELECT id, email, charity_registration_number, message, status, created_at
    FROM claim_requests
    WHERE (message LIKE 'ai-audit |%' OR message LIKE 'ai-check |%')
      AND created_at >= datetime('now', ?1)${statusSql}
    ORDER BY created_at DESC
    LIMIT 200
  `);
  const rows = await (statusSql ? stmt.bind(`-${hours} hours`, status) : stmt.bind(`-${hours} hours`)).all();
  const field = (msg, key) => {
    const m = (msg || '').match(new RegExp(key + ':\\s*([^|]*)'));
    const v = m ? m[1].trim() : '';
    return v && v !== '-' ? v : null;
  };
  const requests = (rows.results || []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    email: r.email,
    charity: field(r.message, 'name') || r.charity_registration_number,
    website: field(r.message, 'website'),
    registration: field(r.message, 'reg'),
    status: r.status,
    is_test: /\bTEST\b/.test(r.message || '') || r.charity_registration_number === 'TEST',
  }));
  return json({
    window_hours: hours,
    count: requests.filter((r) => !r.is_test).length,
    count_including_tests: requests.length,
    requests,
  });
}
