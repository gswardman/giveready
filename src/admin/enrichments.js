/**
 * GiveReady — Admin enrichment review: pending list, apply, reject, review page.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { ENRICHABLE_FIELDS, validDonationUrl } from '../api/enrichment.js';
import { escHtml } from '../lib/html.js';
import { json, error } from '../lib/http.js';
import { checkAdminAuth } from './auth.js';

// ============================================
// ADMIN — ENRICHMENT REVIEW QUEUE
// ============================================
// Daily human-in-the-loop review path. Token-gated, so the CSO concern from
// 2026-04-16 (self-reported agent_name spoofing) doesn't apply — the caller
// is authenticated as the admin via the existing GIVEREADY_ADMIN_TOKEN.
//
// Three handlers:
//   GET  /api/admin/enrichments/pending        — list pending submissions
//   POST /api/admin/enrichments/{id}/apply     — apply this value to the nonprofit
//   POST /api/admin/enrichments/{id}/reject    — reject with a reason
//
// Apply writes the value to the nonprofits table, marks the chosen enrichment
// as 'applied', and rejects any other pending submissions for the same
// (nonprofit, field) pair so the queue stays clean. Reject records the
// rejection_reason so the next agent submitting on this field gets it back
// in their response (existing self-learning loop).
//
// The bootstrap rationale: agent submissions are still rare. Applying via
// admin makes the leaderboard show "applied" counts climb, which signals to
// observing agents that the funnel rewards real submissions, which (in
// theory) increases their willingness to spend a request on /api/enrich.

export async function handleAdminEnrichmentsPending(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  const rows = await db.prepare(
    `SELECT ae.id, ae.nonprofit_id, ae.nonprofit_slug, ae.field, ae.value,
            ae.source_url, ae.agent_id, ae.agent_name, ae.confidence,
            ae.created_at,
            n.name AS nonprofit_name,
            (SELECT COUNT(*) FROM agent_enrichments ae2
             WHERE ae2.nonprofit_id = ae.nonprofit_id AND ae2.field = ae.field
               AND ae2.status = 'pending') AS competing_pending
       FROM agent_enrichments ae
       LEFT JOIN nonprofits n ON n.id = ae.nonprofit_id
      WHERE ae.status = 'pending'
      ORDER BY ae.created_at DESC
      LIMIT ?1`
  ).bind(limit).all();

  return json({
    count: rows.results.length,
    pending: rows.results,
    review_endpoints: {
      apply: 'POST /api/admin/enrichments/{id}/apply?token=...',
      reject: 'POST /api/admin/enrichments/{id}/reject?token=... body: {"reason":"..."}',
    },
  });
}

export async function handleAdminEnrichmentApply(db, env, request, id) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const enrichment = await db.prepare(
    `SELECT id, nonprofit_id, nonprofit_slug, field, value, status
       FROM agent_enrichments WHERE id = ?1`
  ).bind(id).first();

  if (!enrichment) return error('Enrichment not found', 404);
  if (enrichment.status !== 'pending') {
    return error(`Enrichment already ${enrichment.status}`, 400);
  }

  // Update the nonprofit's actual field with the chosen value. This is the
  // single SQL line that makes the enrichment "go live" on the public profile.
  // Using string interpolation for the column name is safe here because the
  // field is whitelisted by the original handleEnrich (ENRICHABLE_FIELDS) —
  // we only re-validate the column comes from a trusted enum.
  if (!ENRICHABLE_FIELDS.has(enrichment.field)) {
    return error(`Field '${enrichment.field}' is not in the enrichable allowlist`, 400);
  }
  // Re-validate at apply time: the row could predate the validator, and this
  // value becomes a 302 target for donors.
  if (enrichment.field === 'donation_url' && !validDonationUrl(enrichment.value)) {
    return error('donation_url must be an absolute https URL on the charity\'s own domain', 400);
  }

  await db.prepare(
    `UPDATE nonprofits SET ${enrichment.field} = ?1, updated_at = datetime('now')
     WHERE id = ?2`
  ).bind(enrichment.value, enrichment.nonprofit_id).run();

  // Mark this enrichment applied.
  await db.prepare(
    `UPDATE agent_enrichments
        SET status = 'applied', reviewed_at = datetime('now')
      WHERE id = ?1`
  ).bind(id).run();

  // Reject competing pending submissions for the same (nonprofit, field) pair
  // so the queue is clean. Record why, with the winning value, so the next
  // agent that resubmits sees the canonical form.
  const rejectionReason = `Admin selected a different value during manual review for '${enrichment.field}'. Aim for the winning canonical form when retrying.`;
  await db.prepare(
    `UPDATE agent_enrichments
        SET status = 'rejected',
            reviewed_at = datetime('now'),
            rejection_reason = ?1,
            winning_value = ?2
      WHERE nonprofit_id = ?3 AND field = ?4 AND status = 'pending' AND id != ?5`
  ).bind(rejectionReason, enrichment.value, enrichment.nonprofit_id, enrichment.field, id).run();

  return json({
    success: true,
    enrichment_id: id,
    nonprofit_slug: enrichment.nonprofit_slug,
    field: enrichment.field,
    applied_value: enrichment.value,
    profile_url: `https://giveready.org/nonprofits/${enrichment.nonprofit_slug}`,
  });
}

export async function handleAdminEnrichmentReject(db, env, request, id) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  let body = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch (_e) {
    return error('Invalid JSON body. Send {"reason": "..."} (optional "winning_value")', 400);
  }
  const reason = (body.reason || '').toString().trim() ||
    'Admin rejected during manual review. No reason provided.';
  const winningValue = body.winning_value ? String(body.winning_value).slice(0, 5000) : null;

  const enrichment = await db.prepare(
    `SELECT id, nonprofit_slug, field, status FROM agent_enrichments WHERE id = ?1`
  ).bind(id).first();

  if (!enrichment) return error('Enrichment not found', 404);
  if (enrichment.status !== 'pending') {
    return error(`Enrichment already ${enrichment.status}`, 400);
  }

  await db.prepare(
    `UPDATE agent_enrichments
        SET status = 'rejected',
            reviewed_at = datetime('now'),
            rejection_reason = ?1,
            winning_value = ?2
      WHERE id = ?3`
  ).bind(reason, winningValue, id).run();

  return json({
    success: true,
    enrichment_id: id,
    nonprofit_slug: enrichment.nonprofit_slug,
    field: enrichment.field,
    rejection_reason: reason,
  });
}

// ============================================
// ADMIN — ENRICHMENT REVIEW UI (HTML)
// ============================================
// Human-in-the-loop review page for the pending enrichment queue. Token-gated
// GET at /admin/enrichments?token=... . Renders every pending submission
// grouped by nonprofit then field so competing values for the same field sit
// together and conflicts are obvious. Approve/Reject buttons call the existing
// JSON endpoints (/api/admin/enrichments/{id}/apply and /reject) via fetch,
// carrying the same token from the page URL. No new write logic lives here —
// this is a thin render-and-fetch layer over handlers that already do the work.
//
// Each row is tagged internal-probe vs external using the same signal the
// public leaderboard uses to hide test traffic, so a reviewer can tell their
// own deploy/eval agents from wild ones at a glance. The tag is a heuristic,
// not ground truth — the raw agent_name is always shown.
export async function handleAdminEnrichmentsReview(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const token = url.searchParams.get('token') || '';

  const rows = await db.prepare(
    `SELECT ae.id, ae.nonprofit_id, ae.nonprofit_slug, ae.field, ae.value,
            ae.source_url, ae.agent_name, ae.confidence, ae.created_at,
            n.name AS nonprofit_name,
            (SELECT COUNT(*) FROM agent_enrichments ae2
              WHERE ae2.nonprofit_id = ae.nonprofit_id AND ae2.field = ae.field
                AND ae2.status = 'pending') AS competing_pending
       FROM agent_enrichments ae
       LEFT JOIN nonprofits n ON n.id = ae.nonprofit_id
      WHERE ae.status = 'pending'
      ORDER BY n.name, ae.field, ae.created_at ASC`
  ).all();

  const items = rows.results || [];

  // Group: nonprofit -> field -> [submissions]
  const byNp = new Map();
  for (const r of items) {
    const npKey = r.nonprofit_slug || String(r.nonprofit_id);
    if (!byNp.has(npKey)) byNp.set(npKey, { name: r.nonprofit_name || npKey, slug: r.nonprofit_slug, fields: new Map() });
    const npEntry = byNp.get(npKey);
    if (!npEntry.fields.has(r.field)) npEntry.fields.set(r.field, []);
    npEntry.fields.get(r.field).push(r);
  }

  // Heuristic: flag likely-internal agents (deploy probes, verifiers, test
  // harnesses). Conservative — only clear infra patterns; ambiguous design/eval
  // agents stay untagged so the reviewer decides.
  const internalRe = /debug|test|probe|deploy|verify|causepage|endpoint|localhost|smoke|healthcheck/i;
  let internalCount = 0, externalCount = 0;
  for (const r of items) { (internalRe.test(r.agent_name || '') ? internalCount++ : externalCount++); }

  const esc = (s) => escHtml(String(s == null ? '' : s));
  const fmtAge = (ts) => {
    if (!ts) return '';
    const then = new Date((ts + 'Z').replace(' ', 'T'));
    const days = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (isNaN(days)) return esc(ts);
    return days <= 0 ? 'today' : days + 'd ago';
  };

  let body = '';
  for (const [, np] of byNp) {
    body += `<section class="np">`;
    const npLink = np.slug ? `<a href="/nonprofits/${esc(np.slug)}" target="_blank" rel="noreferrer">${esc(np.name)}</a>` : esc(np.name);
    body += `<h2>${npLink}</h2>`;
    for (const [field, subs] of np.fields) {
      const conflict = subs.length > 1;
      body += `<div class="field ${conflict ? 'conflict' : ''}">`;
      body += `<div class="fieldname">${esc(field)}${conflict ? ` <span class="warn">${subs.length} competing — approving one auto-rejects the rest</span>` : ''}</div>`;
      for (const s of subs) {
        const isInternal = internalRe.test(s.agent_name || '');
        const tag = isInternal
          ? `<span class="tag internal" title="matches an internal deploy/test/probe pattern">likely internal</span>`
          : `<span class="tag external" title="no internal pattern matched">external?</span>`;
        const src = s.source_url
          ? `<a href="${esc(s.source_url)}" target="_blank" rel="noreferrer noopener">source</a>`
          : `<span class="nosrc">no source</span>`;
        body += `<div class="sub" data-id="${esc(s.id)}">
          <div class="val">${esc(s.value)}</div>
          <div class="metaline">${tag} <span class="agent">${esc(s.agent_name || 'unknown agent')}</span> · conf ${esc(s.confidence)} · ${src} · ${fmtAge(s.created_at)}</div>
          <div class="actions">
            <button class="approve" data-id="${esc(s.id)}">Approve</button>
            <button class="reject" data-id="${esc(s.id)}">Reject</button>
            <span class="result"></span>
          </div>
        </div>`;
      }
      body += `</div>`;
    }
    body += `</section>`;
  }
  if (!items.length) body = `<p class="empty">Queue is clear — no pending enrichments.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<meta name="referrer" content="no-referrer" />
<title>Enrichment review — GiveReady admin</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 2rem 1.25rem; color: #111; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  .summary { font-size: 0.9rem; color: #444; margin: 0 0 1.5rem; padding: 0.6rem 0.8rem; background: #f4f4f5; border-radius: 6px; }
  .summary b { color: #111; }
  section.np { margin: 0 0 1.75rem; padding: 0 0 0.5rem; border-bottom: 1px solid #eee; }
  section.np h2 { font-size: 1.05rem; margin: 0 0 0.6rem; }
  section.np h2 a { color: #1d4ed8; text-decoration: none; }
  .field { margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; border-left: 3px solid #e5e7eb; }
  .field.conflict { border-left-color: #d97706; background: #fffbeb; }
  .fieldname { font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; margin-bottom: 0.4rem; }
  .warn { font-weight: 500; text-transform: none; letter-spacing: 0; color: #b45309; font-size: 0.8rem; }
  .sub { padding: 0.5rem 0; border-top: 1px dashed #eee; }
  .sub:first-of-type { border-top: none; }
  .val { font-size: 1rem; word-break: break-word; }
  .metaline { font-size: 0.8rem; color: #666; margin: 0.25rem 0 0.4rem; }
  .agent { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tag { display: inline-block; font-size: 0.68rem; padding: 0.05rem 0.4rem; border-radius: 3px; margin-right: 0.3rem; }
  .tag.internal { background: #fde68a; color: #78350f; }
  .tag.external { background: #dbeafe; color: #1e40af; }
  .nosrc { color: #b91c1c; }
  button { padding: 0.35rem 0.9rem; font-size: 0.85rem; border: none; border-radius: 4px; cursor: pointer; margin-right: 0.4rem; }
  button.approve { background: #059669; color: #fff; }
  button.reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; }
  button:disabled { opacity: 0.5; cursor: default; }
  .result { font-size: 0.8rem; margin-left: 0.3rem; }
  .sub.done { opacity: 0.45; }
  .empty { color: #059669; font-weight: 600; }
  .foot { font-size: 0.78rem; color: #888; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Enrichment review</h1>
<div class="summary"><b>${items.length}</b> pending across <b>${byNp.size}</b> nonprofits · <b>${externalCount}</b> tagged external, <b>${internalCount}</b> likely internal (deploy/test/probe patterns). Conflicts are amber — approving one value auto-rejects the others for that field.</div>
${body}
<p class="foot">Tags are a heuristic on agent name, not proof. Approve writes the value live to the public profile immediately. Reject records a reason the next agent sees.</p>
<script>
  const TOKEN = ${JSON.stringify(token)};
  function wire(btn, kind) {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const sub = btn.closest('.sub');
      const result = sub.querySelector('.result');
      const buttons = sub.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      result.textContent = kind === 'apply' ? 'applying…' : 'rejecting…';
      try {
        const opts = { method: 'POST' };
        if (kind === 'reject') {
          const reason = prompt('Rejection reason (optional):') || 'Rejected during manual review.';
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify({ reason });
        }
        const res = await fetch('/api/admin/enrichments/' + id + '/' + kind + '?token=' + encodeURIComponent(TOKEN), opts);
        const data = await res.json();
        if (res.ok && data.success) {
          result.textContent = kind === 'apply' ? '✓ applied' : '✓ rejected';
          sub.classList.add('done');
        } else {
          result.textContent = '✗ ' + (data.error || res.status);
          buttons.forEach(b => b.disabled = false);
        }
      } catch (e) {
        result.textContent = '✗ ' + e.message;
        buttons.forEach(b => b.disabled = false);
      }
    });
  }
  document.querySelectorAll('button.approve').forEach(b => wire(b, 'apply'));
  document.querySelectorAll('button.reject').forEach(b => wire(b, 'reject'));
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
}
