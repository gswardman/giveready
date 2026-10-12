/**
 * GiveReady — Admin nonprofit moderation: verify, drafts, approve, reject, description edit.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { logOnboardingEvent } from '../lib/funnel.js';
import { escHtml } from '../lib/html.js';
import { json, error } from '../lib/http.js';
import { checkAdminAuth } from './auth.js';

// ============================================
// ADMIN: Manual verify override
// ============================================

export async function handleAdminVerify(db, env, request, slug) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return error('Unauthorized', 401);
  }

  let body;
  try { body = await request.json(); } catch { return error('Invalid JSON', 400); }

  const status = body.verification_status || 'domain_verified';
  const validStatuses = ['unverified', 'email_verified', 'domain_verified', 'registry_verified'];
  if (!validStatuses.includes(status)) {
    return error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
  }

  const verified = status === 'domain_verified' || status === 'registry_verified' ? 1 : 0;

  const result = await db.prepare(`
    UPDATE nonprofits SET verification_status = ?1, verified = ?2, updated_at = datetime('now')
    WHERE slug = ?3
  `).bind(status, verified, slug).run();

  if (result.meta.changes === 0) return error('Nonprofit not found', 404);

  return json({ success: true, slug, verification_status: status, verified });
}

export async function handleAdminDrafts(db, env, request) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const drafts = await db.prepare(`
    SELECT id, slug, name, contact_email, country, city, mission, usdc_wallet, website, created_at
    FROM nonprofits
    WHERE verified = 0
    ORDER BY created_at DESC
  `).all();

  return json({
    count: drafts.results.length,
    drafts: drafts.results,
  });
}

export async function handleAdminApprove(db, env, request, slug) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const result = await db.prepare(`
    UPDATE nonprofits
    SET verified = 1, updated_at = datetime('now')
    WHERE slug = ?1 AND verified = 0
  `).bind(slug).run();

  if (result.changes === 0) {
    return error('Draft not found or already approved', 404);
  }

  const approved = await db.prepare(
    `SELECT id, contact_email, usdc_wallet FROM nonprofits WHERE slug = ?1`
  ).bind(slug).first();
  await logOnboardingEvent(db, 'verified', {
    nonprofit_id: approved?.id, slug, email: approved?.contact_email,
    reason: approved?.usdc_wallet ? 'x402 now live (wallet present)' : 'no wallet, donors redirected',
  });

  return json({
    success: true,
    slug,
    donate_url: `https://giveready.org/donate/${slug}`,
  });
}

export async function handleAdminReject(db, env, request, slug) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  // Get the nonprofit ID first
  const nonprofit = await db.prepare(
    `SELECT id FROM nonprofits WHERE slug = ?1 AND verified = 0`
  ).bind(slug).first();

  if (!nonprofit) {
    return error('Draft not found or already approved', 404);
  }

  const id = nonprofit.id;

  // Delete related records. Order matters: everything holding a foreign key
  // into nonprofits (or into charity_users) has to go first, or the final
  // DELETE throws and the whole call 500s.
  //
  // charity_sessions -> charity_users -> nonprofits is the dependency chain.
  // Registration started writing charity_users rows on 2026-08-01, so from
  // that date every draft has one and rejecting a draft without clearing it
  // fails. profile_edits is an audit trail and also references both.
  try {
    await db.prepare(`
      DELETE FROM charity_sessions
      WHERE active_nonprofit_id = ?1
         OR charity_user_id IN (SELECT id FROM charity_users WHERE nonprofit_id = ?1)
    `).bind(id).run();

    await db.prepare(
      `DELETE FROM profile_edits WHERE nonprofit_id = ?1`
    ).bind(id).run();

    await db.prepare(
      `DELETE FROM charity_users WHERE nonprofit_id = ?1`
    ).bind(id).run();

    await db.prepare(
      `DELETE FROM nonprofit_causes WHERE nonprofit_id = ?1`
    ).bind(id).run();

    await db.prepare(
      `DELETE FROM registrations WHERE nonprofit_id = ?1`
    ).bind(id).run();

    await db.prepare(
      `DELETE FROM nonprofits WHERE id = ?1`
    ).bind(id).run();
  } catch (e) {
    console.error(`[AdminReject] Failed to delete ${slug} (${id}): ${e && e.message}`);
    return error(`Reject failed: ${(e && e.message) || 'database error'}`, 500);
  }

  return json({
    success: true,
    slug,
    deleted: true,
  });
}

// ============================================
// DESCRIPTION ADMIN — manual editor for the existing nonprofits.description
// column. Token-gated GET/POST at /admin/nonprofits/<slug>/edit. POST writes
// directly to nonprofits.description; the public /nonprofits/<slug> page
// renders that column and flips from noindex to indexable when description
// reaches 200+ chars (or when verified=1, regardless of length).
// ============================================
export async function handleAdminDescriptionEdit(db, env, request, slug) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const np = await db
    .prepare(`SELECT id, name, slug, verified, description FROM nonprofits WHERE slug = ?1`)
    .bind(slug)
    .first();
  if (!np) return error('Nonprofit not found', 404);

  if (request.method === 'POST') {
    const form = await request.formData();
    const newDesc = (form.get('description') || '').toString().trim();
    if (newDesc.length < 20) return error('Description must be at least 20 characters', 400);
    if (newDesc.length > 4000) return error('Description must be at most 4000 characters', 400);

    await db
      .prepare(`UPDATE nonprofits SET description = ?1, updated_at = datetime('now') WHERE id = ?2`)
      .bind(newDesc, np.id)
      .run();

    const tok = encodeURIComponent(new URL(request.url).searchParams.get('token') || '');
    return new Response(null, { status: 303, headers: { Location: `/admin/nonprofits/${slug}/edit?token=${tok}&saved=1` } });
  }

  // GET — render the editor.
  const url = new URL(request.url);
  const saved = url.searchParams.get('saved') === '1';
  const currentDesc = (np.description || '').trim();
  const charCount = currentDesc.length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<meta name="referrer" content="no-referrer" />
<title>Edit description — ${escHtml(np.name)} — GiveReady admin</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem; color: #111; line-height: 1.55; }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
  .nav { font-size: 0.85rem; color: #666; margin-bottom: 1rem; }
  .saved { background: #d1fae5; color: #065f46; padding: 0.5rem 0.75rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; }
  textarea { width: 100%; min-height: 220px; font-family: inherit; font-size: 1rem; padding: 0.75rem; box-sizing: border-box; }
  button { padding: 0.5rem 1.25rem; font-size: 1rem; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer; }
  .meta { font-size: 0.85rem; color: #666; }
  .badge { display: inline-block; font-size: 0.7rem; background: #d1fae5; color: #065f46; padding: 0.1rem 0.45rem; border-radius: 3px; margin-left: 0.5rem; }
  .indexable { color: #065f46; font-weight: 600; }
  .noindex { color: #92400e; font-weight: 600; }
</style>
</head>
<body>
<div class="nav"><a href="/nonprofits/${escHtml(slug)}">View public page</a></div>
<h1>${escHtml(np.name)} ${np.verified ? '<span class="badge">Verified</span>' : ''}</h1>
<p class="meta">Slug: <code>${escHtml(slug)}</code></p>
${saved ? '<div class="saved">Saved.</div>' : ''}
<form method="POST">
  <p>Write a clear paragraph: what does this nonprofit do, who do they serve, why does it matter. Avoid IRS-style boilerplate. <strong>200+ chars</strong> flips the page from noindex to indexable (verified=1 pages always indexable).</p>
  <textarea name="description" maxlength="4000" placeholder="A few sentences. Distinctive. 20–4000 characters.">${escHtml(currentDesc)}</textarea>
  <p><button type="submit">Save</button></p>
</form>
<p class="meta">Current length: ${charCount} chars · Page is currently <span class="${(np.verified || charCount >= 200) ? 'indexable' : 'noindex'}">${(np.verified || charCount >= 200) ? 'INDEXABLE' : 'NOINDEX,FOLLOW'}</span></p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Robots-Tag': 'noindex,nofollow' },
  });
}
