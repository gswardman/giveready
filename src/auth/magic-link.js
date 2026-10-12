/**
 * GiveReady — Passwordless login: magic-link request, verify, logout, and the dashboard API error/cookie helpers.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { randomHex, sha256Hex } from '../lib/crypto.js';
import { logOnboardingEvent } from '../lib/funnel.js';
import { CORS_HEADERS, json } from '../lib/http.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { isValidEmail } from '../lib/validation.js';
import { verifyResultHTML } from './claim.js';

// ============================================
// CHARITY DASHBOARD: AUTH + PROFILE + QUERIES
// Migration: 011-charity-dashboard.sql
// Reviewed: /plan-eng-review 2026-04-20
// ============================================

// ---- helpers ----

export function apiError(code, message, status = 400, details) {
  return json({ error: { code, message, details: details || {} } }, status);
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const re = new RegExp('(?:^|; )' + name + '=([^;]*)');
  const m = header.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

// Per-email rate limit for /api/auth/request. D1-backed count of magic_link_tokens
// created in the last hour for this email. Eventually consistent but sufficient
// for the real abuse case at this scale. DO upgrade tracked as follow-up.
export async function isAuthEmailRateLimited(db, email) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS c FROM magic_link_tokens
     WHERE email = ?1 AND created_at > datetime('now', '-1 hour')`
  ).bind(email).first();
  return (row?.c ?? 0) >= 5;
}

// ---- email template ----

async function sendLoginMagicLink(email, token, env) {
  const url = `https://giveready.org/api/auth/verify?token=${token}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #111; margin-bottom: 16px;">Sign in to GiveReady</h2>
      <p style="font-size: 15px; color: #444; line-height: 1.6; margin-bottom: 24px;">
        Click the button below to sign in to your GiveReady dashboard. The link works for 24 hours and can be used once.
      </p>
      <a href="${url}" style="display: inline-block; background: #059669; color: #fff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 8px; margin-bottom: 24px;">Sign in &rarr;</a>
      <p style="font-size: 13px; color: #999; line-height: 1.6; margin-top: 24px;">
        If you didn\u2019t request this, you can safely ignore this email. No one can access your account without clicking this link.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="font-size: 12px; color: #bbb;">GiveReady \u2014 Making small nonprofits discoverable.</p>
    </div>
  `;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Resend has giveready.org (root) verified, not send.giveready.org.
        // The `send.` subdomain is just where Resend's SES infrastructure records live.
        from: 'GiveReady <login@giveready.org>',
        to: [email],
        subject: 'Sign in to GiveReady',
        html,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error('[Auth] Resend failed:', t);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[Auth] Resend error:', e);
    return false;
  }
}

// ---- auth handlers ----

export const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export async function handleAuthRequest(db, env, ctx, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // Per-IP rate limit (reuse existing in-memory limiter for writes)
  const rl = checkRateLimit(request, 'write');
  if (rl) {
    console.log(`[Auth.reject] request ip-rate-limit ip=${ip}`);
    return rl;
  }

  let body;
  try { body = await request.json(); } catch {
    console.log(`[Auth.reject] request invalid-json ip=${ip}`);
    return apiError('VALIDATION_FAILED', 'Invalid JSON');
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    console.log(`[Auth.reject] request invalid-email ip=${ip} raw=${(body.email || '').slice(0, 40)}`);
    return apiError('VALIDATION_FAILED', 'Valid email required');
  }

  // Per-email rate limit
  if (await isAuthEmailRateLimited(db, email)) {
    console.log(`[Auth.reject] request email-rate-limit ip=${ip} email=${email}`);
    return apiError('RATE_LIMITED', 'Too many login requests for this email. Try again in an hour.', 429);
  }

  // Generate token, store hash, expire after MAGIC_LINK_TTL_MS (24h since 2026-09-25)
  const token = randomHex(16);              // 128-bit
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();
  const ua = request.headers.get('user-agent') || null;

  await db.prepare(
    `INSERT INTO magic_link_tokens (token_hash, email, expires_at, ip_address, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(tokenHash, email, expiresAt, ip, ua).run();

  // Fire email asynchronously so the client navigates to /check-email immediately.
  // The send result used to be discarded, which is why a dead Resend key produced
  // a normal-looking "check your email" page and no signal anywhere. The 204 below
  // is unchanged (no account enumeration), but a failure now leaves a trace.
  ctx.waitUntil((async () => {
    const sent = await sendLoginMagicLink(email, token, env);
    if (!sent) {
      console.error(`[Auth] magic link NOT delivered to ${email} -- Resend rejected the send`);
      await logOnboardingEvent(db, 'signin_email_failed', {
        email, user_agent: ua, outcome: 'fail',
        reason: 'Resend did not accept the message',
      });
    }
  })());
  ctx.waitUntil(logOnboardingEvent(db, 'signin_request', { email, user_agent: ua }));

  console.log(`[Auth] Magic link requested: ${email}`);

  // 204 tells the client "accepted, go show the check-email page"
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Magic-link sign-in (reworked 2026-09-25).
//
// 1. The link now lasts MAGIC_LINK_TTL_MS (24h, was 15 min). Charity staff read
//    email hours later; a 15-minute link sent Geordie's own test to TOKEN_INVALID.
// 2. GET no longer spends the token. It shows a confirm page with a button that
//    POSTs the token back. Mail scanners (Microsoft Safe Links, Mimecast, many
//    charity Outlook setups) open every link in an email; with a single-use GET
//    they burned the token before the person clicked. Scanners fetch, they do
//    not submit forms.
// 3. Failures are an HTML page with a way forward, not raw JSON. The status and
//    body are identical for missing / used / expired (CSO M2, 2026-04-20); the
//    distinction is logged server-side only.
// 4. Fixes a latent crash: `ua` was read in the no-charity branch before its
//    `const` declaration (temporal dead zone), so a verified email with no
//    charity bound threw instead of showing the claim-request page.

function authInvalidLinkResponse() {
  return new Response(verifyResultHTML(
    'This sign-in link has expired',
    'Sign-in links work once and last 24 hours. <a href="/signin">Send me a new link &rarr;</a>',
    false
  ), { status: 410, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
}

function authConfirmHTML(token) {
  const safe = String(token).replace(/[^a-f0-9]/gi, '');
  return verifyResultHTML(
    'Sign in to GiveReady',
    `<form method="POST" action="/api/auth/verify" style="margin-top:20px">` +
    `<input type="hidden" name="token" value="${safe}" />` +
    `<button type="submit" style="background:#059669;color:#fff;font-size:15px;font-weight:600;border:0;padding:12px 28px;border-radius:8px;cursor:pointer;font-family:inherit">Sign in &rarr;</button>` +
    `</form>`,
    true
  );
}

export async function lookupMagicLink(db, token) {
  if (!token || !/^[a-f0-9]{32}$/i.test(token)) return { row: null, reason: 'missing' };
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT token_hash, email, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ?1`
  ).bind(tokenHash).first();
  if (!row) return { row: null, reason: 'missing' };
  if (row.used_at) return { row: null, reason: 'used', email: row.email };
  if (new Date(row.expires_at) < new Date()) return { row: null, reason: 'expired', email: row.email };
  return { row, reason: null };
}

export async function handleAuthVerify(db, env, request, url) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ua = request.headers.get('user-agent') || null;

  // GET: show the confirm button, do NOT spend the token.
  if (request.method === 'GET') {
    const token = url.searchParams.get('token');
    const { row, reason, email } = await lookupMagicLink(db, token);
    if (!row) {
      console.log(`[Auth.reject] verify-get ${reason} ip=${ip}${email ? ` email=${email}` : ''}`);
      return authInvalidLinkResponse();
    }
    return new Response(authConfirmHTML(token), {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  }

  // POST: the person pressed the button. Spend the token and start a session.
  let token = null;
  const ctype = request.headers.get('content-type') || '';
  try {
    if (ctype.includes('application/json')) {
      token = ((await request.json()) || {}).token || null;
    } else {
      const form = await request.formData();
      token = form.get('token');
    }
  } catch { token = null; }

  const { row, reason, email } = await lookupMagicLink(db, token);
  if (!row) {
    console.log(`[Auth.reject] verify ${reason} ip=${ip}${email ? ` email=${email}` : ''}`);
    return authInvalidLinkResponse();
  }
  const tokenHash = row.token_hash;

  // Mark used before creating session (prevents double-use race). The WHERE on
  // used_at IS NULL makes a double submit lose cleanly.
  const upd = await db.prepare(
    `UPDATE magic_link_tokens SET used_at = datetime('now') WHERE token_hash = ?1 AND used_at IS NULL`
  ).bind(tokenHash).run();
  if (upd && upd.meta && upd.meta.changes === 0) {
    console.log(`[Auth.reject] verify used-race ip=${ip} email=${row.email}`);
    return authInvalidLinkResponse();
  }

  // Find all charities for this email
  const users = await db.prepare(`
    SELECT cu.id AS user_id, cu.nonprofit_id, n.slug, n.name
    FROM charity_users cu
    JOIN nonprofits n ON cu.nonprofit_id = n.id
    WHERE cu.email = ?1 AND cu.revoked_at IS NULL
    ORDER BY n.name
  `).bind(row.email).all();

  const list = users.results || [];
  if (list.length === 0) {
    // Valid email, no access. A counted funnel step, not a silent dead end.
    await logOnboardingEvent(db, 'signin_no_charity', {
      email: row.email, outcome: 'fail', user_agent: ua,
      reason: 'Email verified but no charity_users row bound to it',
    });
    return new Response(verifyResultHTML(
      'No dashboard access yet',
      `This email is verified, but no GiveReady charity is linked to it yet. ` +
      `<a href="/dashboard/claim-request?email=${encodeURIComponent(row.email)}">Request access to a charity &rarr;</a>`,
      false
    ), { status: 403, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  // Create session. 256-bit token, 30-day expiry. Revocable via revoked_at.
  const sessionToken = randomHex(32);
  const sessionHash = await sha256Hex(sessionToken);
  const SESSION_TTL_DAYS = 30;
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const first = list[0];

  await db.prepare(`
    INSERT INTO charity_sessions (token_hash, charity_user_id, active_nonprofit_id, expires_at, last_seen_at, ip_address, user_agent)
    VALUES (?1, ?2, ?3, ?4, datetime('now'), ?5, ?6)
  `).bind(sessionHash, first.user_id, first.nonprofit_id, sessionExpiresAt, ip, ua).run();

  const cookie = `gr_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`;
  const redirect = list.length > 1 ? '/dashboard/pick-charity' : '/dashboard';

  await logOnboardingEvent(db, 'signin_success', {
    email: row.email, nonprofit_id: first.nonprofit_id, slug: first.slug, user_agent: ua,
    reason: `${list.length} charity binding(s)`,
  });

  console.log(`[Auth] Sign-in success: ${row.email} (${list.length} charity binding(s))`);

  // 303 so the browser follows the POST with a GET.
  return new Response(null, {
    status: 303,
    headers: {
      'Location': redirect,
      'Set-Cookie': cookie,
      ...CORS_HEADERS,
    },
  });
}

export async function handleAuthLogout(db, request) {
  const token = getCookie(request, 'gr_session');
  if (token) {
    const hash = await sha256Hex(token);
    await db.prepare(
      `UPDATE charity_sessions SET revoked_at = datetime('now') WHERE token_hash = ?1 AND revoked_at IS NULL`
    ).bind(hash).run();
  }
  const clear = `gr_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/dashboard', 'Set-Cookie': clear, ...CORS_HEADERS },
  });
}
