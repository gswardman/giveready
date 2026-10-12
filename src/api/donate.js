/**
 * GiveReady — Donations: x402 USDC donate endpoint, donation history, outbound donate click tracker.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { logOnboardingEvent } from '../lib/funnel.js';
import { CORS_HEADERS, json, error } from '../lib/http.js';

// ============================================
// x402 DONATE ENDPOINT
// ============================================

// Solana mainnet USDC mint
export const USDC_MINT_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
// SOLANA_RPC is stored as a Wrangler secret (wrangler secret put SOLANA_RPC)

// --- Stripe Gateway (REMOVED) ---
// Previously held funds in GiveReady's Stripe account on behalf of nonprofits.
// Removed due to money transmission regulatory risk.
// Nonprofits without USDC wallets now redirect to their existing donation URL.
// Historical gateway_donations table preserved for any past records.

function encodeBase64(obj) {
  return btoa(JSON.stringify(obj));
}

function decodeBase64(str) {
  return JSON.parse(atob(str));
}

export async function handleDonate(db, env, request, slug) {
  // Look up the nonprofit
  const nonprofit = await db.prepare(
    `SELECT id, slug, name, usdc_wallet FROM nonprofits WHERE slug = ?1 AND verified = 1`
  ).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  // Parse donation amount from query string (default $1 USDC)
  const url = new URL(request.url);
  const amountUSDC = parseFloat(url.searchParams.get('amount') || '1');
  if (isNaN(amountUSDC) || amountUSDC <= 0 || amountUSDC > 10000) {
    return error('Amount must be between 0.01 and 10,000 USDC', 400);
  }
  const amountAtomic = Math.round(amountUSDC * 1_000_000); // 6 decimals

  // --- REDIRECT PATH ---
  // Nonprofit has no USDC wallet — redirect to their existing donation page.
  // Include GiveReady attribution so the charity sees where donors are coming from.
  if (!nonprofit.usdc_wallet) {
    // Look up the full nonprofit record for donation_url and website
    const full = await db.prepare(
      `SELECT donation_url, website, name FROM nonprofits WHERE id = ?1`
    ).bind(nonprofit.id).first();

    // Registration stamps donation_url with GiveReady's OWN donate page, so
    // sending a donor there is a loop: /api/donate/slug answers "go to
    // giveready.org/donate/slug", which answers the same thing again. Only
    // treat donation_url as off-site if it actually points off-site.
    const stamped = full?.donation_url || '';
    const offSite = stamped && !/^https?:\/\/(www\.)?giveready\.org\//i.test(stamped);
    const donationUrl = (offSite ? stamped : null) || full?.website || null;
    const attribution = encodeURIComponent('giveready.org');

    // Build redirect URL with attribution (utm params so the charity sees the source)
    let redirectUrl = null;
    if (donationUrl) {
      const separator = donationUrl.includes('?') ? '&' : '?';
      redirectUrl = `${donationUrl}${separator}utm_source=${attribution}&utm_medium=ai-agent&utm_campaign=giveready-directory`;
    }

    await logOnboardingEvent(db, 'donate_redirect', {
      nonprofit_id: nonprofit.id, slug: nonprofit.slug,
      user_agent: request.headers.get('user-agent') || null,
      reason: donationUrl ? 'sent to own donation page' : 'no donation url and no website',
    });

    return json({
      payment_method: 'redirect',
      message: `${nonprofit.name} accepts donations through their website. To donate with zero fees via USDC, ask them to claim their free page on GiveReady.`,
      nonprofit: nonprofit.name,
      slug: nonprofit.slug,
      donation_url: redirectUrl,
      website: full?.website || null,
      claim_prompt: `Know someone at ${nonprofit.name}? Tell them to claim their free page at https://giveready.org/onboard — donors can then give with zero fees via USDC.`,
      zero_fee_note: 'GiveReady offers zero-fee USDC donations for nonprofits that claim their page. No middleman, 100% goes to the charity.',
    });
  }

  // --- x402 SOLANA PATH (existing) ---
  // Nonprofit has a wallet — use direct x402 payment

  // Check for X-PAYMENT header
  const paymentHeader = request.headers.get('X-PAYMENT');

  if (!paymentHeader) {
    // No payment — return 402 with payment requirements
    const nonce = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const paymentRequirements = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: SOLANA_MAINNET,
          maxAmountRequired: String(amountAtomic),
          resource: `https://giveready.org/api/donate/${slug}`,
          description: `Donate $${amountUSDC} USDC to ${nonprofit.name}`,
          mimeType: 'application/json',
          payTo: nonprofit.usdc_wallet,
          maxTimeoutSeconds: 300,
          asset: `solana:${USDC_MINT_SOLANA}`,
          extra: {
            name: nonprofit.name,
            slug: nonprofit.slug,
            nonce: nonce,
          },
        },
      ],
    };

    // Log the attempt
    await db.prepare(
      `INSERT INTO donations (id, nonprofit_id, amount_usdc, amount_atomic, network, status)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`
    ).bind(nonce, nonprofit.id, amountUSDC, amountAtomic, SOLANA_MAINNET).run();

    await logOnboardingEvent(db, 'donate_quote', {
      nonprofit_id: nonprofit.id, slug: nonprofit.slug,
      user_agent: request.headers.get('user-agent') || null,
      reason: `$${amountUSDC} USDC quoted`,
    });

    return new Response(JSON.stringify({
      error: 'Payment required',
      nonprofit: nonprofit.name,
      amount: `$${amountUSDC} USDC`,
      message: `To donate, include an X-PAYMENT header with a signed x402 payment payload.`,
    }, null, 2), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT-REQUIRED': encodeBase64(paymentRequirements),
        ...CORS_HEADERS,
      },
    });
  }

  // Payment header present — verify and settle via facilitator
  let paymentPayload;
  try {
    paymentPayload = decodeBase64(paymentHeader);
  } catch (e) {
    return error('Invalid X-PAYMENT header — must be base64-encoded JSON', 400);
  }

  // Validate payload structure
  const txBase64 = paymentPayload?.payload?.transaction;
  if (!txBase64) {
    return error('Missing payload.transaction in X-PAYMENT', 400);
  }

  // Step 1: Broadcast the signed transaction directly to Solana
  let txHash;
  try {
    const rpcResponse = await fetch(env.SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          txBase64,
          {
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          },
        ],
      }),
    });

    const rpcResult = await rpcResponse.json();

    if (rpcResult.error) {
      return error(`Solana transaction failed: ${rpcResult.error.message}`, 402);
    }

    txHash = rpcResult.result;
  } catch (e) {
    return error(`Solana RPC unavailable: ${e.message}`, 502);
  }

  // Step 2: Confirm the transaction landed
  let confirmed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const confirmResponse = await fetch(env.SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignatureStatuses',
          params: [[txHash], { searchTransactionHistory: false }],
        }),
      });
      const confirmResult = await confirmResponse.json();
      const status = confirmResult?.result?.value?.[0];
      if (status && status.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        if (status.err) {
          return error(`Transaction confirmed but failed on-chain: ${JSON.stringify(status.err)}`, 402);
        }
        confirmed = true;
        break;
      }
    } catch (e) {
      // Retry
    }
  }

  if (!confirmed) {
    // Transaction sent but not yet confirmed — still log it
    console.log(`Transaction ${txHash} sent but not confirmed within timeout`);
  }

  // Step 3: Log the successful donation
  const donationId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO donations (id, nonprofit_id, amount_usdc, amount_atomic, network, tx_hash, sender_address, status, facilitator_response, settled_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'settled', ?8, datetime('now'))`
  ).bind(
    donationId,
    nonprofit.id,
    amountUSDC,
    amountAtomic,
    SOLANA_MAINNET,
    txHash,
    null,
    JSON.stringify({ txHash, confirmed, method: 'direct-solana' }),
  ).run();

  // Step 4: Return success
  const responseData = {
    success: true,
    donation: {
      id: donationId,
      nonprofit: nonprofit.name,
      slug: nonprofit.slug,
      amount_usdc: amountUSDC,
      network: 'Solana',
      tx_hash: txHash,
      confirmed,
      settled_at: new Date().toISOString(),
    },
    message: `$${amountUSDC} USDC donated to ${nonprofit.name}. Transaction ${confirmed ? 'confirmed' : 'sent'} on Solana.`,
  };

  return new Response(JSON.stringify(responseData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT-RESPONSE': encodeBase64({ txHash, confirmed }),
      ...CORS_HEADERS,
    },
  });
}

// Donation history for a nonprofit
export async function handleDonationHistory(db, slug) {
  const nonprofit = await db.prepare(
    `SELECT id, name FROM nonprofits WHERE slug = ?1 AND verified = 1`
  ).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  const donations = await db.prepare(
    `SELECT id, amount_usdc, network, tx_hash, status, source, created_at, settled_at
     FROM donations WHERE nonprofit_id = ?1 AND status = 'settled'
     ORDER BY settled_at DESC LIMIT 50`
  ).bind(nonprofit.id).all();

  const total = await db.prepare(
    `SELECT SUM(amount_usdc) as total, COUNT(*) as count
     FROM donations WHERE nonprofit_id = ?1 AND status = 'settled'`
  ).bind(nonprofit.id).first();

  return json({
    nonprofit: nonprofit.name,
    total_donated_usdc: total.total || 0,
    donation_count: total.count || 0,
    recent_donations: donations.results,
  });
}

// ---------------------------------------------------------------------------
// GET /out/<slug>?ref=guide-<slug>
// Outbound click tracker for charities with no USDC wallet, which is all 41,227.
//
// WHY THIS EXISTS (2026-09-07). The donate page rendered a bare anchor straight
// to the charity's own donation page with UTMs attached. A donor who clicked it
// left, and GiveReady learned nothing. So the funnel could report "51 donate-path
// views in 7d" and say nothing at all about whether a single person acted on them.
// Meanwhile the digest's "Donations: 9 total, $12.76, last 2026-04-12" line was
// measuring only the on-chain x402 rail, a rail with zero payable recipients,
// and reading to a human as "GiveReady has driven $12.76 of giving in its life".
// The path every actual donor takes was completely uninstrumented.
//
// This route captures the last event GiveReady can observe before the handoff.
// It is the difference between interest and intent, and unlike anything on the
// far side of the redirect it needs no cooperation from the charity.
//
// A 302 rather than a sendBeacon on the existing anchor, deliberately. A beacon
// leaves the user's path untouched, but it is blocked by privacy tooling and
// undercounts by an amount nobody can measure. Every metric failure on this
// project has been a number that was wrong invisibly: the write funnel counting
// crawlers, the Brave counter that could never fire, this. An unknowable
// undercount is the wrong trade here. The redirect catches every click.
//
// NOT AN OPEN REDIRECT. The destination is read from the database by slug and
// never from a query parameter. Do not add a `to=` or `url=` param to this route.
//
// Disallowed in robots.txt and marked noindex. A crawler following this link
// would manufacture click events, which is exactly the mistake the sitemap made
// by printing the enrich endpoint as a fetchable URL.
// ---------------------------------------------------------------------------
export async function handleOutboundDonate(db, request, url, slug) {
  const bounce = (to) => new Response(null, {
    status: 302,
    headers: {
      Location: to,
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });

  let row = null;
  try {
    row = await db.prepare(
      `SELECT id, name, slug, donation_url, website FROM nonprofits WHERE slug = ?1`
    ).bind(slug).first();
  } catch (e) {
    console.error(`[out] lookup failed for ${slug}: ${(e && e.message) || e}`);
  }
  // Unknown slug, or the lookup threw: send them somewhere useful rather than
  // erroring. A broken donate link is a worse outcome than a missing measurement.
  if (!row) return bounce('/nonprofits');

  // Same off-site guard as the API donate path. Registration stamps
  // donation_url with GiveReady's own donate page, and bouncing a donor there
  // would loop back into this route.
  const stamped = row.donation_url || '';
  const offSite = stamped && !/^https?:\/\/(www\.)?giveready\.org\//i.test(stamped);
  const dest = (offSite ? stamped : null) || row.website || null;
  if (!dest) return bounce(`/nonprofits/${encodeURIComponent(slug)}`);

  let target;
  try {
    target = new URL(dest);
  } catch (_e) {
    return bounce(`/nonprofits/${encodeURIComponent(slug)}`);
  }

  // utm_content carries the guide that produced the click. utm_campaign was a
  // constant, so a charity looking at its own analytics could see that
  // GiveReady sent someone and nothing more, and neither side could tell which
  // guide did the work. Validated against a strict pattern before it goes
  // anywhere near a URL.
  const rawRef = url.searchParams.get('ref') || '';
  const ref = /^guide-[a-z0-9-]{1,80}$/.test(rawRef) ? rawRef : null;

  target.searchParams.set('utm_source', 'giveready.org');
  target.searchParams.set('utm_medium', 'donor');
  target.searchParams.set('utm_campaign', 'giveready-directory');
  target.searchParams.set('utm_content', ref || 'direct');

  await logOnboardingEvent(db, 'donate_click_out', {
    nonprofit_id: row.id,
    slug: row.slug,
    user_agent: request.headers.get('user-agent') || null,
    reason: `ref=${ref || 'direct'} host=${target.hostname}`,
  });

  return bounce(target.toString());
}
