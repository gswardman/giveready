/**
 * GiveReady — POST /api/onboard: self-serve charity registration.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { logOnboardingEvent } from '../lib/funnel.js';
import { json, error } from '../lib/http.js';
import { bumpStatsCounter } from '../lib/stats-cache.js';
import {
  generateSlug,
  isValidEmail,
  isValidSolanaAddress,
  normaliseCountry,
} from '../lib/validation.js';

// ============================================
// NONPROFIT ONBOARDING & ADMIN
// ============================================

export async function handleOnboard(db, request) {
  const ua = request.headers.get('user-agent') || null;
  let body;
  try {
    body = await request.json();
  } catch {
    await logOnboardingEvent(db, 'register_attempt', { outcome: 'fail', reason: 'Invalid JSON', user_agent: ua });
    return error('Invalid JSON', 400);
  }

  // Support both naming conventions (camelCase from frontend, snake_case from API)
  const name = body.name || body.orgName;
  const email = body.email || body.contactEmail;
  const country = body.country;
  const mission = body.mission;
  const description = body.description;
  const city = body.city;
  const website = body.website;
  const founded_year = body.founded_year || body.foundedYear;
  const programmes = body.programmes;
  const beneficiaries_per_year = body.beneficiaries_per_year || body.beneficiaries;
  const causes = body.causes;
  const usdc_wallet = body.usdc_wallet || body.walletAddress;
  const registration_number = body.registration_number || body.registrationNumber;
  const registration_type = body.registration_type || body.walletType || 'nonprofit';
  const registration_country = body.registration_country || body.registrationCountry;
  const notes = body.notes;
  const wallet_signature = body.wallet_signature || body.walletSignature;
  const payment_method = body.payment_method;
  const donation_url_override = body.donation_url;

  // ─── CLAIM FLOW: existing nonprofit ───────────────────────────
  const claim_slug = body.claim_slug;
  if (claim_slug) {
    const existing = await db.prepare(
      `SELECT id, slug, name, verified, verification_status, claimed_by_email FROM nonprofits WHERE slug = ?1`
    ).bind(claim_slug).first();

    if (!existing) {
      return error('Nonprofit not found', 404);
    }

    if (!email || !isValidEmail(email)) {
      return error('Valid email required to claim a page', 400);
    }

    // A claim is unproven until the email link is clicked, so it can never
    // touch a page someone has already verified.
    if (existing.verified || (existing.verification_status && existing.verification_status !== 'unverified')) {
      return error('This page has already been claimed. Contact support if you believe this is an error.', 409);
    }

    // Update the nonprofit with enriched data from the claimant
    const updates = [];
    const params = [];
    let paramIdx = 1;

    // Record who is claiming. contact_email is only set once the claim is
    // verified (handleVerify), so an unproven claimant can't take over the
    // address donors and admins see.
    updates.push(`claimed_by_email = ?${paramIdx}`); params.push(email); paramIdx++;
    updates.push(`claimed_at = datetime('now')`);

    if (mission) { updates.push(`mission = ?${paramIdx}`); params.push(mission); paramIdx++; }
    if (description) { updates.push(`description = ?${paramIdx}`); params.push(description); paramIdx++; }
    if (city) { updates.push(`city = ?${paramIdx}`); params.push(city); paramIdx++; }
    if (founded_year) { updates.push(`founded_year = ?${paramIdx}`); params.push(parseInt(founded_year)); paramIdx++; }
    // website, donation_url and usdc_wallet decide where donors and agent
    // payments go. They are set from the charity dashboard after
    // verification (handleCharityProfilePatch), never from an unproven claim.

    updates.push(`updated_at = datetime('now')`);

    params.push(existing.id);
    await db.prepare(
      `UPDATE nonprofits SET ${updates.join(', ')} WHERE id = ?${paramIdx}`
    ).bind(...params).run();

    // Log the claim for admin review
    console.log(`[Claim] ${email} claiming ${claim_slug} (${existing.name}) — payment: ${payment_method || 'none'}`);

    return json({
      success: true,
      type: 'claim',
      id: existing.id,
      slug: existing.slug,
      preview_url: `https://giveready.org/api/nonprofits/${existing.slug}`,
      admin_message: `Claim submitted for ${existing.name}. We will verify your ownership via ${email} within 48 hours.`,
    }, 201);
  }

  // ─── NEW REGISTRATION FLOW ────────────────────────────────────

  await logOnboardingEvent(db, 'register_attempt', { email, user_agent: ua });

  // Validate required fields
  if (!name || !email || !country) {
    await logOnboardingEvent(db, 'register_fail', {
      email, user_agent: ua, outcome: 'fail',
      reason: `Missing required fields (name:${!!name} email:${!!email} country:${!!country})`,
    });
    return error('Missing required fields: name, email, country', 400);
  }

  // Validate email
  if (!isValidEmail(email)) {
    await logOnboardingEvent(db, 'register_fail', { email, user_agent: ua, outcome: 'fail', reason: 'Invalid email address' });
    return error('Invalid email address', 400);
  }

  // Match the country vocabulary the rest of the directory uses, otherwise
  // a self-registered charity never shows up under a country filter.
  const countryValue = normaliseCountry(country);

  // Optional wallet. Reject a malformed one loudly rather than storing it
  // and having donations quoted against an address that cannot receive.
  if (usdc_wallet && !isValidSolanaAddress(usdc_wallet)) {
    await logOnboardingEvent(db, 'register_fail', { email, user_agent: ua, outcome: 'fail', reason: 'Malformed usdc_wallet' });
    return error('usdc_wallet does not look like a Solana address (expected 32-44 base58 characters). Leave it blank to add it later from your dashboard.', 400);
  }

  // Generate slug
  let slug = generateSlug(name);

  // Check if slug exists and deduplicate
  let slugExists = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits WHERE slug = ?1`
  ).bind(slug).first();

  let counter = 2;
  let baseSlug = slug;
  while (slugExists.count > 0) {
    slug = `${baseSlug}-${counter}`;
    slugExists = await db.prepare(
      `SELECT COUNT(*) as count FROM nonprofits WHERE slug = ?1`
    ).bind(slug).first();
    counter++;
  }

  // Generate ID and URLs
  const id = crypto.randomUUID();
  // donation_url is where a donor is sent when there is no USDC wallet, so it
  // must point at the charity, never back at GiveReady — self-referencing
  // values made /api/donate answer with its own URL in a loop. Prefer an
  // explicit override, then their website, else leave it null and let the
  // donate handler fall back.
  const donation_url = donation_url_override || website || null;
  const now = new Date().toISOString();

  // mission and description are NOT NULL in the schema, but the lightweight
  // "Register new charity" form on /onboard only collects name, email and
  // country. Both arrived undefined, the INSERT hit the constraint, and the
  // thrown error surfaced to the user as a bare 500 / "Error registering.
  // Please try again." (reported by doobneek Inc., 2026-08-01).
  // Placeholders are replaced at admin review; they are never shown as
  // verified copy because new rows land with verified = 0.
  const missionValue = mission || description || `${name} — mission pending review.`;
  const descriptionValue =
    description || mission || `${name} registered via the GiveReady onboarding form. Profile details pending review.`;

  try {
    // Insert nonprofit
    await db.prepare(`
      INSERT INTO nonprofits (
        id, slug, name, contact_email, country, city, mission, description, website, founded_year,
        beneficiaries_per_year, usdc_wallet, donation_url, verified, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    `).bind(
      id, slug, name, email, countryValue, city || null, missionValue, descriptionValue,
      website || null, founded_year || null, beneficiaries_per_year || null, usdc_wallet || null,
      donation_url, 0, now, now
    ).run();

    // Insert causes if provided
    if (causes && Array.isArray(causes) && causes.length > 0) {
      for (const causeId of causes) {
        await db.prepare(`
          INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id)
          VALUES (?1, ?2)
        `).bind(id, causeId).run();
      }
    }

    // Insert registration if provided
    if (registration_number) {
      await db.prepare(`
        INSERT INTO registrations (id, nonprofit_id, country, type, registration_number)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(crypto.randomUUID(), id, normaliseCountry(registration_country) || countryValue, registration_type || 'nonprofit', registration_number).run();
    }

    // Bind the registering email to the new nonprofit so the person who
    // registered can actually sign in at /signin. Without this row,
    // handleAuthVerify finds no charity for the email and shows
    // "No dashboard access yet" — a dead end for every self-registration.
    // verified_at stays null: the magic link proves the email, admin review
    // still gates going live (nonprofits.verified = 0).
    await db.prepare(`
      INSERT OR IGNORE INTO charity_users (id, nonprofit_id, email, role)
      VALUES (?1, ?2, ?3, 'admin')
    `).bind(crypto.randomUUID(), id, email.trim().toLowerCase()).run();
  } catch (e) {
    // Never let a DB error escape as an opaque worker exception again — the
    // caller gets a readable reason and the failure is greppable in the tail.
    console.error(`[Onboard] Registration failed for "${name}" (${email}, ${country}): ${e && e.message}`);
    await logOnboardingEvent(db, 'register_fail', {
      email, slug, user_agent: ua, outcome: 'fail',
      reason: (e && e.message) || 'database error',
    });
    return error(`Registration failed: ${(e && e.message) || 'database error'}`, 500);
  }

  await logOnboardingEvent(db, 'register_success', {
    email, slug, nonprofit_id: id, user_agent: ua,
    reason: usdc_wallet ? 'with wallet' : 'no wallet',
  });

  // Keep /api/stats honest between daily recounts. Without this a charity that
  // registers at 09:00 is invisible in the public count until the cron runs,
  // which is the 2026-08-02 frozen-number bug in a new costume. Fire and forget:
  // a stats counter must never be able to fail a registration.
  bumpStatsCounter(db, 'nonprofit_count', 1);

  // Log wallet signature if provided (for future verification)
  if (wallet_signature) {
    console.log(`[Onboard] Wallet signature for ${slug}: ${wallet_signature}`);
  }

  return json({
    success: true,
    type: 'new',
    id,
    slug,
    preview_url: `https://giveready.org/donate/${slug}?preview=1`,
    signin_url: 'https://giveready.org/signin',
    admin_message: 'Your profile is pending review. You will receive an email when it goes live.',
    next_steps: [
      `Sign in at https://giveready.org/signin with ${email} to finish your profile.`,
      usdc_wallet
        ? 'Your USDC wallet is saved. Zero-fee agent donations switch on once your profile is verified.'
        : 'Add a Solana USDC wallet in your dashboard to accept zero-fee donations initiated by AI agents.',
    ],
  }, 201);
}
