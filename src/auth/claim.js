/**
 * GiveReady — Profile claim flow: verification email, one-time token verify page.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { logOnboardingEvent } from '../lib/funnel.js';
import { json, error } from '../lib/http.js';
import { isValidEmail, emailDomain, urlDomain } from '../lib/validation.js';

// ============================================
// MAGIC LINK VERIFICATION
// ============================================

async function sendVerificationEmail(email, orgName, token, env) {
  const verifyUrl = `https://giveready.org/verify?token=${token}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #111; margin-bottom: 16px;">Verify your GiveReady page</h2>
      <p style="font-size: 15px; color: #444; line-height: 1.6; margin-bottom: 24px;">
        Someone (hopefully you) is claiming the <strong>${orgName}</strong> page on GiveReady.
      </p>
      <p style="font-size: 15px; color: #444; line-height: 1.6; margin-bottom: 24px;">
        Click below to verify your email and activate your page:
      </p>
      <a href="${verifyUrl}" style="display: inline-block; background: #059669; color: #fff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 8px; margin-bottom: 24px;">Verify my page &rarr;</a>
      <p style="font-size: 13px; color: #999; line-height: 1.6; margin-top: 24px;">
        This link expires in 24 hours. If you didn\u2019t request this, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="font-size: 12px; color: #bbb;">GiveReady &mdash; Making small nonprofits discoverable.</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'GiveReady <verify@giveready.org>',
        to: [email],
        subject: `Verify your GiveReady page \u2014 ${orgName}`,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Resend] Email send failed:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Resend] Network error:', err);
    return false;
  }
}

export async function handleClaim(db, env, request, slug) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return error('Valid email required', 400);
  }

  // Find the nonprofit
  const nonprofit = await db.prepare(
    `SELECT id, slug, name, website, verification_status, claimed_by_email FROM nonprofits WHERE slug = ?1`
  ).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  // Check if already fully claimed by someone else
  if (nonprofit.claimed_by_email && nonprofit.verification_status !== 'unverified') {
    return error('This page has already been claimed. Contact support if you believe this is an error.', 409);
  }

  // Domain matching
  const eDomain = emailDomain(email);
  const wDomain = nonprofit.website ? urlDomain(nonprofit.website) : '';
  const domainMatch = eDomain && wDomain && (eDomain === wDomain || wDomain.endsWith('.' + eDomain) || eDomain.endsWith('.' + wDomain)) ? 1 : 0;

  // Generate token
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Store token
  await db.prepare(`
    INSERT INTO verification_tokens (id, nonprofit_id, email, token, purpose, domain_match, expires_at)
    VALUES (?1, ?2, ?3, ?4, 'claim', ?5, ?6)
  `).bind(crypto.randomUUID(), nonprofit.id, email, token, domainMatch, expiresAt).run();

  // Update nonprofit with claim-pending info
  await db.prepare(`
    UPDATE nonprofits SET claimed_by_email = ?1, claimed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?2
  `).bind(email, nonprofit.id).run();

  // Also update any enrichment data from the claim form
  const updates = [];
  const params = [];
  let idx = 1;
  if (body.mission) { updates.push(`mission = ?${idx}`); params.push(body.mission); idx++; }
  if (body.description) { updates.push(`description = ?${idx}`); params.push(body.description); idx++; }
  if (body.city) { updates.push(`city = ?${idx}`); params.push(body.city); idx++; }
  if (body.founded_year) { updates.push(`founded_year = ?${idx}`); params.push(parseInt(body.founded_year)); idx++; }
  // website, donation_url, usdc_wallet and contact_email are payment and
  // contact routes. They wait for verification and the charity dashboard.

  if (updates.length > 0) {
    updates.push(`updated_at = datetime('now')`);
    params.push(nonprofit.id);
    await db.prepare(
      `UPDATE nonprofits SET ${updates.join(', ')} WHERE id = ?${idx}`
    ).bind(...params).run();
  }

  // Send verification email
  const sent = await sendVerificationEmail(email, nonprofit.name, token, env);
  if (!sent) {
    await logOnboardingEvent(db, 'claim_email_failed', {
      email, nonprofit_id: nonprofit.id, slug, outcome: 'fail',
      reason: 'Resend did not accept the message',
    });
  }

  console.log(`[Claim] ${email} claiming ${slug} (${nonprofit.name}) — domain_match: ${domainMatch}, email_sent: ${sent}`);

  return json({
    success: true,
    message: sent
      ? 'Check your email for a verification link. It expires in 24 hours.'
      : 'Claim registered but we had trouble sending the verification email. Please try again or contact support.',
    email_sent: sent,
    domain_match: domainMatch,
    slug: nonprofit.slug,
    domain_match_note: domainMatch
      ? 'Your email domain matches the organisation website — you\'ll be fully verified once you click the link.'
      : 'We\'ll verify your claim manually after you confirm your email. This usually takes under 48 hours.',
  }, 201);
}

export async function handleVerifyToken(db, env, url) {
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response(verifyResultHTML('Invalid link', 'No verification token found. Please try claiming your page again.', false), {
      status: 400,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  // Look up token
  const record = await db.prepare(`
    SELECT vt.*, n.name as org_name, n.slug as org_slug, n.website as org_website
    FROM verification_tokens vt
    JOIN nonprofits n ON vt.nonprofit_id = n.id
    WHERE vt.token = ?1
  `).bind(token).first();

  if (!record) {
    return new Response(verifyResultHTML('Invalid link', 'This verification link is not valid. Please try claiming your page again.', false), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  // Check expiry
  if (new Date(record.expires_at) < new Date()) {
    return new Response(verifyResultHTML('Link expired', 'This verification link has expired. Please claim your page again to get a new link.', false), {
      status: 410,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  // Check already used
  if (record.used_at) {
    return new Response(verifyResultHTML('Already verified', `Your email has already been verified for ${record.org_name}. <a href="/api/nonprofits/${record.org_slug}">View your page &rarr;</a>`, true), {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  // Mark token as used
  await db.prepare(`UPDATE verification_tokens SET used_at = datetime('now') WHERE id = ?1`).bind(record.id).run();

  // Determine verification level
  const verificationStatus = record.domain_match ? 'domain_verified' : 'email_verified';

  // Update nonprofit
  await db.prepare(`
    UPDATE nonprofits SET verification_status = ?1, contact_email = ?2, verified = ?3, updated_at = datetime('now')
    WHERE id = ?4
  `).bind(verificationStatus, record.email, record.domain_match ? 1 : 0, record.nonprofit_id).run();

  console.log(`[Verify] ${record.email} verified ${record.org_slug} — status: ${verificationStatus}`);

  const successMsg = record.domain_match
    ? `<strong>${record.org_name}</strong> is now fully verified on GiveReady. Your page is live and ready to receive donations.`
    : `Your email has been verified for <strong>${record.org_name}</strong>. We\u2019ll complete a manual review within 48 hours to fully activate your page.`;

  return new Response(verifyResultHTML('Email verified', successMsg + `<br><br><a href="https://giveready.org/donate/${record.org_slug}" style="color:#059669;font-weight:600;">View your page &rarr;</a>`, true), {
    status: 200,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

export function verifyResultHTML(title, message, success) {
  const accent = success ? '#059669' : '#dc2626';
  const icon = success ? '\u2713' : '\u2717';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} \u2014 GiveReady</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      background: #ffffff; color: #111; -webkit-font-smoothing: antialiased;
      display: flex; flex-direction: column; min-height: 100vh;
    }
    nav {
      height: 52px; padding: 0 24px; display: flex; align-items: center;
      border-bottom: 1px solid #e5e5e5;
    }
    .nav-name { font-weight: 700; font-size: 15px; color: #111; text-decoration: none; }
    .nav-tag { font-size: 10px; font-weight: 600; color: #059669; background: rgba(5,150,105,0.08); border: 1px solid rgba(5,150,105,0.2); padding: 2px 8px; border-radius: 20px; margin-left: 10px; text-transform: uppercase; }
    .container { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
    .card { max-width: 480px; text-align: center; }
    .icon { width: 64px; height: 64px; border-radius: 50%; background: ${accent}; color: #fff; font-size: 28px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
    h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 12px; }
    p { font-size: 15px; color: #666; line-height: 1.7; }
    a { color: #059669; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    footer { padding: 28px 24px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #e5e5e5; }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-name">GiveReady</a>
    <span class="nav-tag">free</span>
  </nav>
  <div class="container">
    <div class="card">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </div>
  <footer>Open-source infrastructure for charitable giving. Built by <a href="https://testventures.net">TestVentures.net</a>. <a href="https://docs.giveready.org/introduction">About</a> · <a href="/privacy">Privacy</a></footer>
</body>
</html>`;
}
