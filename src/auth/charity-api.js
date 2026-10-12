/**
 * GiveReady — Charity dashboard API: /api/charity/* and the audit claim request.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { sendAuditRequestEmails } from '../admin/audit.js';
import { logOnboardingEvent } from '../lib/funnel.js';
import { CORS_HEADERS, json } from '../lib/http.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { isValidEmail, isValidSolanaAddress } from '../lib/validation.js';
import { apiError } from './magic-link.js';
import { requireCharitySession } from './session.js';

// ---- charity endpoints ----

export async function handleCharityMe(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  const users = await db.prepare(`
    SELECT cu.id AS user_id, cu.nonprofit_id, n.slug, n.name
    FROM charity_users cu
    JOIN nonprofits n ON cu.nonprofit_id = n.id
    WHERE cu.email = ?1 AND cu.revoked_at IS NULL
    ORDER BY n.name
  `).bind(auth.session.email).all();
  const active = await db.prepare(
    `SELECT id, slug, name FROM nonprofits WHERE id = ?1`
  ).bind(auth.session.active_nonprofit_id).first();
  return json({
    email: auth.session.email,
    charities: users.results || [],
    active_charity: active,
  });
}

export async function handleCharitySwitch(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return apiError('VALIDATION_FAILED', 'Invalid JSON'); }
  const np = body?.nonprofit_id;
  if (!np) return apiError('VALIDATION_FAILED', 'nonprofit_id required');
  const user = await db.prepare(
    `SELECT cu.id FROM charity_users cu
     WHERE cu.email = ?1 AND cu.nonprofit_id = ?2 AND cu.revoked_at IS NULL`
  ).bind(auth.session.email, np).first();
  if (!user) return apiError('FORBIDDEN', 'You do not have access to this charity', 403);
  await db.prepare(
    `UPDATE charity_sessions SET active_nonprofit_id = ?1, charity_user_id = ?2 WHERE token_hash = ?3`
  ).bind(np, user.id, auth.session.token_hash).run();
  return json({ ok: true, active_nonprofit_id: np });
}

export async function handleCharityProfileGet(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  const np = await db.prepare(`SELECT * FROM nonprofits WHERE id = ?1`)
    .bind(auth.session.active_nonprofit_id).first();
  if (!np) return apiError('NOT_FOUND', 'Charity not found', 404);
  return json(np);
}

export const ALLOWED_PROFILE_FIELDS = [
  'name', 'tagline', 'mission', 'description', 'website',
  'city', 'region', 'country', 'founded_year',
  'beneficiaries_per_year', 'donation_url', 'contact_email',
  'logo_url', 'annual_budget_usd', 'budget_year', 'team_size',
  // usdc_wallet is self-serve so a charity can switch on zero-fee x402
  // agent donations without waiting on the operator. Format-validated in
  // handleCharityProfilePatch; it only takes effect once verified = 1,
  // because handleDonate requires a verified row before quoting a 402.
  'usdc_wallet',
];

export async function handleCharityProfilePatch(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return apiError('VALIDATION_FAILED', 'Invalid JSON'); }
  if (!body || typeof body !== 'object') return apiError('VALIDATION_FAILED', 'JSON object required');

  const existing = await db.prepare(`SELECT * FROM nonprofits WHERE id = ?1`)
    .bind(auth.session.active_nonprofit_id).first();
  if (!existing) return apiError('NOT_FOUND', 'Charity not found', 404);

  // A bad wallet address means donations vanish, so this one field gets
  // checked rather than trusted. Empty string clears it (turns x402 off).
  if ('usdc_wallet' in body) {
    const w = (body.usdc_wallet || '').trim();
    if (w && !isValidSolanaAddress(w)) {
      await logOnboardingEvent(db, 'wallet_set', {
        nonprofit_id: existing.id, slug: existing.slug, email: existing.contact_email,
        outcome: 'fail', reason: 'Malformed Solana address rejected',
      });
      return apiError('VALIDATION_FAILED', 'That does not look like a Solana wallet address. Expected 32-44 base58 characters.');
    }
    body.usdc_wallet = w || null;
  }

  const updates = [];
  const params = [];
  const audit = [];
  let idx = 1;
  for (const f of ALLOWED_PROFILE_FIELDS) {
    if (f in body && body[f] !== existing[f]) {
      updates.push(`${f} = ?${idx}`);
      params.push(body[f]);
      audit.push({ field: f, old: existing[f], next: body[f] });
      idx++;
    }
  }
  if (updates.length === 0) return json({ ok: true, changes: 0 });

  updates.push(`updated_at = datetime('now')`);
  params.push(auth.session.active_nonprofit_id);

  // A wallet proof belongs to the address that signed it. Changing the
  // address must drop the proof, or /payable would vouch for the new one.
  if (audit.some(c => c.field === 'usdc_wallet')) {
    updates.push('wallet_signature = NULL', 'wallet_proved_at = NULL', 'wallet_proof_message = NULL');
  }

  await db.prepare(
    `UPDATE nonprofits SET ${updates.join(', ')} WHERE id = ?${idx}`
  ).bind(...params).run();

  // Audit rows (fire-and-log-on-fail)
  for (const c of audit) {
    await db.prepare(`
      INSERT INTO profile_edits (id, charity_user_id, nonprofit_id, field, old_value, new_value)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      crypto.randomUUID(),
      auth.session.charity_user_id,
      auth.session.active_nonprofit_id,
      c.field,
      c.old == null ? null : String(c.old),
      c.next == null ? null : String(c.next)
    ).run().catch(e => console.error('[profile_edits] insert failed:', e));
  }

  // A wallet change is the step that decides whether x402 is available at
  // all, so it is counted separately from an ordinary profile edit.
  const walletChange = audit.find(c => c.field === 'usdc_wallet');
  if (walletChange) {
    await logOnboardingEvent(db, walletChange.next ? 'wallet_set' : 'wallet_cleared', {
      nonprofit_id: existing.id, slug: existing.slug, email: existing.contact_email,
      reason: existing.verified ? 'live immediately (already verified)' : 'pending verification',
    });
  }
  await logOnboardingEvent(db, 'profile_edit', {
    nonprofit_id: existing.id, slug: existing.slug, email: existing.contact_email,
    reason: audit.map(c => c.field).join(','),
  });

  return json({ ok: true, changes: audit.length });
}

export async function handleCharityQueries(db, request, url) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  const daysRaw = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 30, 1), 90);
  // Single aggregate query. No N+1.
  const rows = await db.prepare(`
    SELECT ql.query_text, COUNT(*) AS hits, MAX(ql.created_at) AS last_seen
    FROM query_matches qm
    JOIN query_log ql ON qm.query_log_id = ql.id
    WHERE qm.nonprofit_id = ?1
      AND ql.created_at > datetime('now', ?2)
      AND ql.query_text IS NOT NULL
      AND ql.query_text <> ''
      -- Migration 012 flagged the seeded fixtures. The admin traffic endpoint
      -- already excludes them; this one did not, so a charity could have been
      -- shown synthetic searches as if they were real donor demand.
      AND COALESCE(ql.is_demo, 0) = 0
    GROUP BY ql.query_text
    ORDER BY hits DESC, last_seen DESC
    LIMIT 50
  `).bind(auth.session.active_nonprofit_id, `-${days} days`).all();
  return json({ days, queries: rows.results || [] });
}

export async function handleCharityDonations(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  // Stub for MVP. Ships in Month 1-3 of the grant period.
  return json({
    donations: [],
    total_count: 0,
    note: 'Donation ledger ships in Month 1-3 of the Gates grant period. ' +
          'Will show AI-initiated donations with on-chain attribution and Gift Aid eligibility.',
  });
}

export async function handleClaimRequest(db, request, env, ctx) {
  // Unauthenticated. Rate-limited per IP.
  const rl = checkRateLimit(request, 'write');
  if (rl) return rl;

  let body;
  try { body = await request.json(); } catch { return apiError('VALIDATION_FAILED', 'Invalid JSON'); }
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) return apiError('VALIDATION_FAILED', 'Valid email required');
  const np = body.nonprofit_id || null;
  const reg = (body.charity_registration_number || '').trim() || null;
  if (!np && !reg) return apiError('VALIDATION_FAILED', 'nonprofit_id or charity_registration_number required');
  const ip = request.headers.get('cf-connecting-ip') || null;

  await db.prepare(`
    INSERT INTO claim_requests (id, nonprofit_id, charity_registration_number, email, message, ip_address)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(crypto.randomUUID(), np, reg, email, body.message || null, ip).run();

  console.log(`[Claim-Request] ${email} -> ${np || reg}`);
  const msg = String(body.message || '');
  if (env && ctx && /^ai-(audit|check) \|/.test(msg) && !/\bTEST\b/.test(msg)) {
    ctx.waitUntil(sendAuditRequestEmails(env, db, { email, message: msg, charity_registration_number: reg }));
  }
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
