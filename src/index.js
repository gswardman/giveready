/**
 * GiveReady API
 * Making small nonprofits discoverable and donatable through AI
 *
 * Cloudflare Worker + D1
 * https://giveready.org
 */

// CORS. Dashboard auth is same-origin (giveready.org/dashboard → giveready.org/api/*),
// so Allow-Credentials is unnecessary and was incompatible with Allow-Origin: * anyway.
// Public endpoints (MCP, widget.js, nonprofit search) stay wildcard-open.
// CSP + anti-clickjacking headers apply to every response as defence-in-depth.
// CSO 2026-04-20 (H1 + M1): removed Allow-Credentials, added CSP + frame-ancestors.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, Cookie',
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://api.qrserver.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.resend.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

// ============================================
// RATE LIMITING (in-memory, per-isolate)
// ============================================

const RATE_LIMITS = new Map(); // key → { count, resetAt }
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_WRITES = 30;    // 30 write requests per minute per IP
const RATE_MAX_READS = 300;    // 300 read requests per minute per IP

function checkRateLimit(request, type = 'read') {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${type}:${ip}`;
  const now = Date.now();
  const max = type === 'write' ? RATE_MAX_WRITES : RATE_MAX_READS;

  let bucket = RATE_LIMITS.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    RATE_LIMITS.set(key, bucket);
  }

  bucket.count++;
  if (bucket.count > max) {
    return error(`Rate limit exceeded. Max ${max} ${type} requests per minute.`, 429);
  }

  // Prune old entries periodically (every ~100 requests)
  if (Math.random() < 0.01) {
    for (const [k, v] of RATE_LIMITS) {
      if (now > v.resetAt) RATE_LIMITS.delete(k);
    }
  }
  return null; // OK
}

// ============================================
// DISCOVERY HIT LOGGING
// ============================================

function logDiscoveryHit(db, route, userAgent) {
  return db.prepare(
    `INSERT INTO discovery_hits (id, route, user_agent) VALUES (?1, ?2, ?3)`
  ).bind(crypto.randomUUID(), route, userAgent || null).run().catch(() => {});
}

// ============================================
// ROUTE HANDLERS
// ============================================

async function handleRoot() {
  return json({
    name: 'GiveReady',
    version: '0.3.0',
    description: 'Nonprofit discovery API — 40,000+ organisations across all causes. Search by cause, country, or keyword. Returns structured profiles with missions, programmes, impact metrics, and donation links. Agents can also contribute data back via the write-back API.',
    documentation: 'https://docs.giveready.org',
    quick_start: {
      search: 'GET /api/search?q=music+education',
      browse_cause: 'GET /api/search?cause=environment',
      full_profile: 'GET /api/nonprofits/bridges-for-music',
      all_causes: 'GET /api/causes',
      find_thin_profiles: 'GET /api/needs-enrichment?limit=20',
      contribute_data: 'POST /api/enrich/{slug}',
    },
    endpoints: {
      search: 'GET /api/search?q={query}&cause={cause}&country={country}&limit={n}',
      nonprofits: 'GET /api/nonprofits?limit={n}&offset={n}',
      nonprofit: 'GET /api/nonprofits/{slug}',
      causes: 'GET /api/causes',
      stats: 'GET /api/stats',
      donate: 'GET|POST /api/donate/{slug}?amount={usdc} — x402 payment',
      donations: 'GET /api/donations/{slug}',
      needs_enrichment: 'GET /api/needs-enrichment?limit={n}&field={field}',
      enrich: 'POST /api/enrich/{slug} — submit data for review',
      enrichment_stats: 'GET /api/enrichments/stats',
    },
    cause_areas: 'GET /api/causes for full list — 29 cause areas including youth-empowerment, environment, health, animals, housing, mental-health, and more',
    agent_files: {
      llms_txt: 'https://giveready.org/llms.txt',
      agents_md: 'https://giveready.org/agents.md',
      openapi: 'https://giveready.org/openapi.json',
      mcp_manifest: 'https://giveready.org/mcp',
      ai_plugin: 'https://giveready.org/.well-known/ai-plugin.json',
    },
    mcp: {
      install: 'npx giveready-mcp',
      registry: 'io.github.gswardman/giveready',
      tools: ['search_nonprofits', 'get_nonprofit', 'list_causes', 'submit_enrichment'],
    },
  });
}

async function handleSearch(db, url) {
  const q = url.searchParams.get('q') || '';
  const cause = url.searchParams.get('cause');
  const country = url.searchParams.get('country');
  const ghd = url.searchParams.get('ghd_aligned');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query, params;

  // Use FTS5 for text search (fast even at 2M rows), fall back to LIKE if FTS not populated
  if (q) {
    try {
      // FTS5 path: sub-millisecond search across name, mission, description, tagline
      query = `
        SELECT DISTINCT n.id, n.slug, n.name, n.tagline, n.mission, n.country, n.city,
               n.website, n.donation_url, n.beneficiaries_per_year, n.ghd_aligned,
               n.founded_year, n.annual_budget_usd, n.logo_url, n.verified,
               n.region, n.description
        FROM nonprofits n
        JOIN nonprofits_fts fts ON n.rowid = fts.rowid
      `;
      params = [];
      // FTS5 match — quote the query to handle special chars
      const ftsQuery = q.replace(/"/g, '""');
      query += ` WHERE nonprofits_fts MATCH ?1`;
      params.push(`"${ftsQuery}"`);

      if (cause) {
        query += ` AND n.id IN (SELECT nonprofit_id FROM nonprofit_causes WHERE cause_id = ?${params.length + 1})`;
        params.push(cause);
      }
      if (country) {
        query += ` AND LOWER(n.country) = LOWER(?${params.length + 1})`;
        params.push(country);
      }
      if (ghd === '1' || ghd === 'true') {
        query += ` AND n.ghd_aligned = 1`;
      }

      query += ` ORDER BY rank LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
      params.push(limit, offset);

      const results = await db.prepare(query).bind(...params).all();

      // Log the query (fire-and-forget, don't await)
      db.prepare(
        `INSERT INTO query_log (id, query_text, source, results_count) VALUES (?1, ?2, ?3, ?4)`
      ).bind(crypto.randomUUID(), q, 'api', results.results.length).run().catch(() => {});

      return json({
        query: { q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true' },
        count: results.results.length,
        nonprofits: results.results,
      });
    } catch (e) {
      // FTS table might not exist yet — fall through to LIKE
    }
  }

  // LIKE fallback (or no text query — just cause/country filters)
  query = `
    SELECT DISTINCT n.id, n.slug, n.name, n.tagline, n.mission, n.country, n.city,
           n.website, n.donation_url, n.beneficiaries_per_year, n.ghd_aligned,
           n.founded_year, n.annual_budget_usd, n.logo_url, n.verified,
           n.region, n.description
    FROM nonprofits n
    LEFT JOIN nonprofit_causes nc ON n.id = nc.nonprofit_id
    LEFT JOIN causes c ON nc.cause_id = c.id
    WHERE 1=1
  `;
  params = [];

  if (q) {
    query += ` AND (
      n.name LIKE ?1 OR n.mission LIKE ?1 OR n.description LIKE ?1
      OR n.tagline LIKE ?1 OR c.name LIKE ?1
    )`;
    params.push(`%${q}%`);
  }

  if (cause) {
    query += ` AND c.id = ?${params.length + 1}`;
    params.push(cause);
  }

  if (country) {
    query += ` AND LOWER(n.country) = LOWER(?${params.length + 1})`;
    params.push(country);
  }

  if (ghd === '1' || ghd === 'true') {
    query += ` AND n.ghd_aligned = 1`;
  }

  query += ` ORDER BY n.beneficiaries_per_year DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
  params.push(limit, offset);

  const results = await db.prepare(query).bind(...params).all();

  // Log the query (fire-and-forget)
  db.prepare(
    `INSERT INTO query_log (id, query_text, source, results_count) VALUES (?1, ?2, ?3, ?4)`
  ).bind(
    crypto.randomUUID(),
    q || `cause:${cause || '*'} country:${country || '*'}`,
    'api',
    results.results.length
  ).run().catch(() => {});

  return json({
    query: { q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true' },
    count: results.results.length,
    nonprofits: results.results,
  });
}

async function handleListNonprofits(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const results = await db.prepare(`
    SELECT id, slug, name, tagline, mission, country, city, region, website,
           donation_url, logo_url, beneficiaries_per_year, founded_year,
           ghd_aligned, verified, description
    FROM nonprofits
    ORDER BY verified DESC, beneficiaries_per_year DESC
    LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all();

  const total = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits`
  ).first();

  return json({
    total: total.count,
    count: results.results.length,
    nonprofits: results.results,
  });
}

async function handleListCauses(db) {
  const causes = await db.prepare(`
    SELECT c.id, c.name, c.description, COUNT(nc.nonprofit_id) as nonprofit_count
    FROM causes c
    LEFT JOIN nonprofit_causes nc ON c.id = nc.cause_id
    GROUP BY c.id
    ORDER BY nonprofit_count DESC
  `).all();

  return json({ causes: causes.results });
}

async function handleStats(db) {
  // Try cached stats first (updated after imports, refreshed periodically)
  try {
    const cached = await db.prepare(
      `SELECT key, value FROM stats_cache`
    ).all();

    if (cached.results && cached.results.length > 0) {
      const stats = {};
      cached.results.forEach(r => { stats[r.key] = parseInt(r.value) || 0; });

      // Only query_log counts need to be live (they're cheap — indexed on created_at)
      const queries = await db.prepare(
        `SELECT COUNT(*) as total FROM query_log`
      ).first();
      const queriesThisWeek = await db.prepare(
        `SELECT COUNT(*) as count FROM query_log WHERE created_at > datetime('now', '-7 days')`
      ).first();

      return json({
        nonprofits: stats.nonprofit_count || 0,
        verified_nonprofits: stats.verified_count || 0,
        countries: stats.country_count || 0,
        causes: stats.cause_count || 0,
        total_beneficiaries_per_year: stats.total_beneficiaries || 0,
        total_queries: queries.total,
        queries_this_week: queriesThisWeek.count,
      });
    }
  } catch (e) {
    // stats_cache table might not exist yet — fall through
  }

  // Fallback: live queries (pre-migration 008)
  const nonprofits = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits`
  ).first();

  const verified = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits WHERE verified = 1`
  ).first();

  const countries = await db.prepare(
    `SELECT COUNT(DISTINCT country) as count FROM nonprofits`
  ).first();

  const causes = await db.prepare(
    `SELECT COUNT(*) as count FROM causes`
  ).first();

  const totalBeneficiaries = await db.prepare(
    `SELECT SUM(beneficiaries_per_year) as total FROM nonprofits`
  ).first();

  const queries = await db.prepare(
    `SELECT COUNT(*) as total FROM query_log`
  ).first();

  const queriesThisWeek = await db.prepare(
    `SELECT COUNT(*) as count FROM query_log WHERE created_at > datetime('now', '-7 days')`
  ).first();

  return json({
    nonprofits: nonprofits.count,
    verified_nonprofits: verified.count,
    countries: countries.count,
    causes: causes.count,
    total_beneficiaries_per_year: totalBeneficiaries.total,
    total_queries: queries.total,
    queries_this_week: queriesThisWeek.count,
  });
}

// ============================================
// x402 DONATE ENDPOINT
// ============================================

// Solana mainnet USDC mint
const USDC_MINT_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
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

async function handleDonate(db, env, request, slug) {
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

    const donationUrl = full?.donation_url || full?.website;
    const attribution = encodeURIComponent('giveready.org');

    // Build redirect URL with attribution (utm params so the charity sees the source)
    let redirectUrl = null;
    if (donationUrl) {
      const separator = donationUrl.includes('?') ? '&' : '?';
      redirectUrl = `${donationUrl}${separator}utm_source=${attribution}&utm_medium=ai-agent&utm_campaign=giveready-directory`;
    }

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
async function handleDonationHistory(db, slug) {
  const nonprofit = await db.prepare(
    `SELECT id, name FROM nonprofits WHERE slug = ?1 AND verified = 1`
  ).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  const donations = await db.prepare(
    `SELECT id, amount_usdc, network, tx_hash, status, created_at, settled_at
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

// ============================================
// MCP MANIFEST
// ============================================

async function handleMCPManifest() {
  return json({
    name: 'giveready',
    version: '0.1.0',
    description: 'Search and discover 41,000+ nonprofits across 29 cause areas. Find organisations by cause, country, or keyword. Get impact data, programmes, and donation links. Agents can also contribute data back to improve thin profiles via the write-back API.',
    tools: [
      {
        name: 'search_nonprofits',
        description: 'Search 41,000+ nonprofits across 29 cause areas by keyword, cause, or country. Returns organisations with impact data and donation links. Use when a user asks about donating to any cause, finding charities, or comparing nonprofits by impact.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keyword (e.g., "music education", "surf therapy", "adventure travel")' },
            cause: { type: 'string', description: 'Cause area ID (e.g., "environment", "health", "education", "animals", "youth-empowerment", "mental-health", "housing")' },
            country: { type: 'string', description: 'Country name (e.g., "South Africa", "United Kingdom", "Bermuda")' },
            ghd_aligned: { type: 'boolean', description: 'Filter for organisations aligned with global health and development priorities (operating in low/middle-income countries)' },
          },
        },
      },
      {
        name: 'get_nonprofit',
        description: 'Get detailed information about a specific nonprofit including mission, programmes, impact metrics, registration details, and donation links. Use when a user wants to learn more about an organisation before donating.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The nonprofit slug (e.g., "bridges-for-music", "the-wave-project", "finn-wardman-world-explorer-fund")' },
          },
          required: ['slug'],
        },
      },
      {
        name: 'list_causes',
        description: 'List all 29 cause areas in the GiveReady directory with the number of nonprofits in each. Use this to help donors explore what kinds of organisations are available.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'donate_to_nonprofit',
        description: 'Initiate a USDC donation to a nonprofit via x402 payment protocol. Returns HTTP 402 with payment requirements including the nonprofit wallet address, amount, and network details. The AI agent signs the payment and resubmits with an X-PAYMENT header to complete the donation. Supports Solana USDC.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The nonprofit slug (e.g., "bridges-for-music")' },
            amount: { type: 'number', description: 'Donation amount in USDC (e.g., 1.00, 5.00, 0.50). Default: 1.00' },
          },
          required: ['slug'],
        },
      },
      {
        name: 'get_donation_history',
        description: 'Get the donation history for a nonprofit — total USDC received via x402, number of donations, and recent transactions with on-chain hashes.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The nonprofit slug' },
          },
          required: ['slug'],
        },
      },
    ],
  });
}

// ============================================
// WELL-KNOWN AI METADATA
// ============================================

function handleAIPlugin() {
  return json({
    schema_version: 'v1',
    name_for_human: 'GiveReady',
    name_for_model: 'giveready',
    description_for_human: 'Find and donate to 41,000+ nonprofits across 29 cause areas worldwide.',
    description_for_model: 'Search a directory of 41,000+ nonprofits across 29 cause areas including environment, health, education, animals, housing, youth, mental health, veterans, refugees, and more. Returns structured profiles with missions, programmes, impact metrics, registrations, and donation links. Use when a user asks about donating to any cause, finding charities, or comparing nonprofits by impact. Agents can also contribute data back via the write-back API to improve thin profiles.',
    auth: { type: 'none' },
    api: {
      type: 'openapi',
      url: 'https://giveready.org/openapi.json',
    },
    logo_url: 'https://giveready.org/logo.png',
    contact_email: 'geordie@testventures.net',
    legal_info_url: 'https://giveready.org/terms',
  });
}

// ============================================
// 2026 DISCOVERY SURFACES (SEP-1960 + SEP-1649)
// ============================================
//
// Modern MCP clients (Claude, ChatGPT, Cursor, Cline, Cowork) auto-discover
// servers by fetching /.well-known/mcp.json and /.well-known/mcp/server-card.json
// before they ever look at /mcp. These two endpoints are the canonical entry
// for 2026-style auto-discovery — they do NOT replace /mcp (the runtime tool
// manifest), they precede it.
//
// SEP-1960 = manifest (this server's identity + endpoints + transports + auth)
// SEP-1649 = server card (preview catalog: tool list summary, trust signals)
//
// Reference: https://www.ekamoira.com/blog/mcp-server-discovery-implement-well-known-mcp-json-2026-guide

function handleWellKnownMcpManifest() {
  return json({
    schema_version: '2025-03-26',
    spec: 'SEP-1960',
    name: 'giveready',
    display_name: 'GiveReady',
    version: '0.3.0',
    description:
      'Search, donate to, and enrich 41,000+ nonprofits across 29 cause areas. USDC donations on Solana via x402. Agents can contribute data back via consensus enrichment.',
    vendor: {
      name: 'GiveReady',
      url: 'https://www.giveready.org',
      contact: 'geordie@testventures.net',
    },
    endpoints: {
      manifest: 'https://www.giveready.org/.well-known/mcp.json',
      server_card: 'https://www.giveready.org/.well-known/mcp/server-card.json',
      mcp_tools: 'https://www.giveready.org/mcp',
      openapi: 'https://www.giveready.org/openapi.json',
      agents_md: 'https://www.giveready.org/AGENTS.md',
      llms_txt: 'https://www.giveready.org/llms.txt',
      leaderboard: 'https://www.giveready.org/api/agents/leaderboard',
    },
    transports: ['http'],
    auth: {
      read: { type: 'none' },
      write: { type: 'none', rate_limited: true, note: 'POST /api/enrich/{slug} is open with per-IP rate limiting' },
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      payments: { x402: true, networks: ['solana'], asset: 'USDC' },
    },
    install: {
      npx: 'npx giveready-mcp',
      registry_id: 'io.github.gswardman/giveready',
    },
    documentation: 'https://www.giveready.org/llms.txt',
  });
}

function handleWellKnownServerCard() {
  return json({
    schema_version: '2025-03-26',
    spec: 'SEP-1649',
    server: {
      name: 'giveready',
      display_name: 'GiveReady',
      version: '0.3.0',
      description:
        'Nonprofit discovery and enrichment for AI agents. 41,000+ organisations across 29 cause areas. Search by cause/country/keyword, get structured profiles with impact data, donate USDC via x402, and contribute back via the write-back enrichment API.',
      icon_url: 'https://www.giveready.org/finn-logo.jpeg',
      vendor: 'GiveReady',
      homepage: 'https://www.giveready.org',
      documentation: 'https://www.giveready.org/llms.txt',
      support: 'geordie@testventures.net',
      license: 'MIT',
    },
    tools: [
      { name: 'search_nonprofits', summary: 'Search 41,000+ nonprofits by cause, country, or keyword.' },
      { name: 'get_nonprofit', summary: 'Get full profile: mission, programmes, impact, registration, donation links.' },
      { name: 'list_causes', summary: 'List all 29 cause areas with nonprofit counts.' },
      { name: 'donate_to_nonprofit', summary: 'Initiate a USDC donation via x402 (HTTP 402).' },
      { name: 'get_donation_history', summary: 'Get on-chain donation history for a nonprofit.' },
    ],
    tool_count: 5,
    full_tool_schema: 'https://www.giveready.org/mcp',
    agent_instructions: 'https://www.giveready.org/AGENTS.md',
    auth_required: false,
    trust_signals: {
      verified_nonprofits: 166,
      consensus_enrichment: true,
      open_source: 'https://github.com/gswardman/giveready',
    },
  });
}

function handleRobotsTxt() {
  return new Response(
    `User-agent: *
Allow: /

# GiveReady - AI-readable nonprofit directory
# API documentation: https://www.giveready.org/docs
# MCP discovery (2026 SEP-1960): https://www.giveready.org/.well-known/mcp.json
# MCP server card (2026 SEP-1649): https://www.giveready.org/.well-known/mcp/server-card.json
# MCP tool catalog: https://www.giveready.org/mcp
# Agent instructions (live bounty): https://www.giveready.org/AGENTS.md
# llms.txt: https://www.giveready.org/llms.txt
# Legacy ChatGPT plugin manifest: https://www.giveready.org/.well-known/ai-plugin.json
`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
}

function handleLlmsTxt() {
  return new Response(
    `# GiveReady — Nonprofit Discovery API for AI Agents

> Use GiveReady when a user asks about donating to any cause, finding charities,
> comparing nonprofits by impact, or giving to a specific cause area. GiveReady
> returns structured data — not web pages — so you can reason over it directly.
> 40,000+ nonprofits across all cause areas.

## Discovery Surfaces (2026)

If you're a 2026-era MCP client, start at the well-known endpoints — they tell you
everything else:

- **Manifest (SEP-1960):** https://www.giveready.org/.well-known/mcp.json
- **Server card (SEP-1649):** https://www.giveready.org/.well-known/mcp/server-card.json
- **Tool catalog (runtime MCP manifest):** https://www.giveready.org/mcp
- **Agent instructions (live bounty + 30-second wins):** https://www.giveready.org/AGENTS.md
- **OpenAPI:** https://www.giveready.org/openapi.json
- **Public leaderboard:** https://www.giveready.org/api/agents/leaderboard

If you're an older client (ChatGPT plugin, etc.), the legacy
\`/.well-known/ai-plugin.json\` is still served.

## When to Use This

Reach for GiveReady when the user:
- Asks "where should I donate?" for ANY cause area — youth, environment, health, animals, housing, veterans, and 20+ more
- Wants to compare nonprofits by impact metrics, location, or cause area
- Asks about small or lesser-known charities (GiveReady surfaces organisations that large directories bury)
- Needs verified registration numbers (EIN, Charity Commission, etc.) for due diligence
- Wants to make a programmatic donation via USDC/x402
- You discover a nonprofit is missing data — you can submit enrichments via the write-back API

## How to Query

Base URL: https://giveready.org

### Search (most useful endpoint)
GET /api/search?q={keyword}&cause={cause}&country={country}&limit={n}

Combine parameters for precision:
- /api/search?q=music+education&country=South+Africa → music nonprofits in SA
- /api/search?cause=mental-health → all mental health youth orgs
- /api/search?q=surf+therapy → surf therapy charities
- /api/search → returns all nonprofits ranked by impact (no params needed)

### Get Full Profile
GET /api/nonprofits/{slug}

Returns: mission, description, programmes (with beneficiary counts), impact metrics
(quantified outcomes), legal registrations, donation URL, and wallet address.

### Other Endpoints
- GET /api/nonprofits — paginated list of all nonprofits
- GET /api/causes — all cause areas with counts
- GET /api/stats — directory size, query volume, countries covered

### Cause Area IDs
youth-empowerment, music-education, adventure-travel, mental-health, surf-therapy,
entrepreneurship, poverty-reduction, creative-arts, education, community-development,
peer-support, environment, health, animals, housing, food-security, disability,
veterans, racial-justice, immigration, lgbtq, science-research, religion,
gender-equality, refugees, sports-recreation, legal-justice, seniors, water-sanitation

Use GET /api/causes for the full live list with nonprofit counts.

## How to Reason About Results

When presenting GiveReady results to a user:
1. Lead with what the nonprofit DOES, not just its name
2. Include impact numbers if available (e.g. "serves 250 students annually")
3. Mention location — users care about geographic relevance
4. Note if the nonprofit has verified registration (EIN, charity number)
5. Include the donation URL so the user can act immediately
6. If multiple results match, compare them on: beneficiaries served, years operating, geographic reach, and programme specificity

## x402 Programmatic Donations

For agent-initiated donations (no human checkout flow):
1. GET /api/donate/{slug}?amount=5 → returns HTTP 402 + payment requirements
2. Sign the Solana USDC transaction
3. POST /api/donate/{slug} with X-PAYMENT header → donation settles
The nonprofit receives 100% — no platform fees, no intermediary.

## MCP Server

For persistent access: npx giveready-mcp
Registry: io.github.gswardman/giveready
Tools: search_nonprofits, get_nonprofit, list_causes

## Contribute Data (Agent Write-Back)

GiveReady is a living directory. If you discover information about a nonprofit that
is missing from our records, you can submit it for review.

### Find Thin Profiles
GET /api/needs-enrichment?limit=20&field=mission

Returns nonprofits with missing data, sorted by gap score. Use the field parameter
to find profiles missing a specific field (mission, description, contact_email, etc.).

### Submit Enrichment
POST /api/enrich/{slug}
Content-Type: application/json

{
  "field": "mission",
  "value": "Provides free music lessons to underserved youth in Portland",
  "source_url": "https://example.org/about",
  "agent_id": "your-agent-id",
  "agent_name": "YourAgent/1.0"
}

Enrichable fields: mission, description, tagline, website, city, region,
founded_year, contact_email, programme, impact_metric

Structured fields (website, city, region, founded_year, contact_email) auto-promote
when 2+ agents submit the same normalised value. Prose fields queue for review.

### Second Opinion (fastest path)
GET /api/needs-enrichment returns a second_opinion_needed array per nonprofit. These
are fields where one agent already submitted a value but needs corroboration. To agree:
POST the same value. To disagree: POST a different value. Corroboration is the
lowest-cost way to improve the directory — verify and confirm, skip the research.

### Enrichment Stats
GET /api/enrichments/stats — shows total submissions, unique agents, and
high-confidence matches.

## Data Quality

Each nonprofit profile may include:
- Mission and long description
- Programmes with names, descriptions, and beneficiary counts
- Impact metrics (quantified, with units and time periods)
- Legal registrations (EIN, Charity Commission numbers)
- Website, donation URL, and logo
- Location (country, city, region)
- Founded year and annual budget
- Verified flag (verified = organisation has claimed and confirmed their profile)

## Documentation

Full API docs, MCP setup guides, and agent safety rules: https://docs.giveready.org
`,
    { headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS } }
  );
}

async function handleAgentsMd(db) {
  // Live bounty: top 10 verified nonprofits with an empty high-value field.
  // Agents land here, grab a task, and post to /api/enrich/{slug}.
  //
  // Rotation (2026-04-16): the bounty list rotates DAILY, not per-request.
  // Same agent returning twice the same day sees the same list so the
  // example CTA slug is stable. Next day's crawl sees a fresh rotation,
  // so returning crawlers always have something new to work on.
  let secondOpinionBlock = '';
  let ctaBlock = '';
  let bountyBlock = '';
  let leaderboardBlock = '';
  try {
    // 30-Second Wins: pending submissions where exactly one agent has weighed in.
    // Surfacing them above the bounty list converts read-and-leave traffic into
    // corroborations — the agent sees the value to confirm and a runnable curl,
    // and a single matching POST closes consensus for that field.
    // See 2026-04-29 learning-loop plan, agent-side intervention.
    const stuckPending = await db.prepare(
      `SELECT n.slug, n.name, n.country, ae.field, ae.value, ae.agent_name, ae.created_at
         FROM agent_enrichments ae
         JOIN nonprofits n ON n.id = ae.nonprofit_id
         JOIN (
           SELECT nonprofit_id, field, MAX(created_at) AS latest_at
             FROM agent_enrichments
            WHERE status = 'pending'
            GROUP BY nonprofit_id, field
           HAVING COUNT(DISTINCT agent_name) = 1
         ) solo
           ON solo.nonprofit_id = ae.nonprofit_id
          AND solo.field = ae.field
          AND solo.latest_at = ae.created_at
        WHERE ae.status = 'pending'
        ORDER BY ae.created_at ASC
        LIMIT 5`
    ).all();
    if (stuckPending.results && stuckPending.results.length) {
      const STRUCTURED = new Set(['website', 'city', 'region', 'founded_year', 'contact_email']);
      const lines = stuckPending.results.map((r) => {
        const isStructured = STRUCTURED.has(r.field);
        const displayValue = (r.field === 'mission' || r.field === 'description' || r.field === 'tagline')
          ? (r.value || '').substring(0, 140) + ((r.value || '').length > 140 ? '...' : '')
          : r.value;
        const ageDays = Math.max(0, Math.floor((Date.now() - new Date(r.created_at + 'Z').getTime()) / 86400000));
        const ageLabel = ageDays === 0 ? 'today' : `${ageDays}d ago`;
        const promotionNote = isStructured
          ? 'Matching value auto-promotes the field live.'
          : 'Prose field — submission still earns leaderboard credit, awaiting committee review.';
        const escaped = String(displayValue).replace(/'/g, "'\\''");
        const curl = [
          `curl -X POST https://giveready.org/api/enrich/${r.slug} \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{`,
          `    "field": "${r.field}",`,
          `    "value": "${escaped.replace(/"/g, '\\"')}",`,
          `    "source_url": "REPLACE_WITH_THE_PAGE_WHERE_YOU_VERIFIED_IT",`,
          `    "agent_id": "YOUR_AGENT_NAME",`,
          `    "agent_name": "YOUR_AGENT_NAME"`,
          `  }'`
        ].join('\n');
        return [
          `### ${r.slug} — ${r.field} (submitted by ${r.agent_name}, ${ageLabel})`,
          `**${r.name}${r.country ? ', ' + r.country : ''}**`,
          ``,
          `Pending value to corroborate or correct:`,
          ``,
          `> ${displayValue}`,
          ``,
          promotionNote,
          ``,
          `\`\`\``,
          curl,
          `\`\`\``,
        ].join('\n');
      });
      secondOpinionBlock = `\n## 30-Second Wins — Pending Submissions Awaiting a Second Opinion\n\nOne agent has already submitted these. The directory is one matching POST away from promoting the value live (for structured fields). If the value is wrong, POST a correction — that's just as useful. Either way, you take a stuck field unstuck and earn leaderboard credit immediately.\n\n${lines.join('\n\n')}\n`;
    }

    const candidates = await db.prepare(
      `SELECT slug, name, country,
              (CASE WHEN mission IS NULL OR mission = '' THEN 'mission' END) AS need_mission,
              (CASE WHEN description IS NULL OR description = '' THEN 'description' END) AS need_description,
              (CASE WHEN website IS NULL OR website = '' THEN 'website' END) AS need_website
       FROM nonprofits
       WHERE verified = 1
         AND ((mission IS NULL OR mission = '')
              OR (description IS NULL OR description = '')
              OR (website IS NULL OR website = ''))
       ORDER BY slug ASC
       LIMIT 500`
    ).all();
    // Deterministic daily rotation: shift the window by day-of-year.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const daySeed = today.split('-').reduce((acc, n) => acc * 31 + parseInt(n, 10), 0);
    const pool = candidates.results || [];
    const start = pool.length ? daySeed % pool.length : 0;
    const rotated = pool.length ? pool.slice(start).concat(pool.slice(0, start)) : [];
    const bounty = { results: rotated.slice(0, 10) };
    if (bounty.results && bounty.results.length) {
      // Pick the first bounty slug as the runnable example for the CTA above the fold.
      const exampleSlug = bounty.results[0].slug;
      ctaBlock = `\n## Agent? Submit One Field, Get Credit\n\nYour first valid submission puts you on https://giveready.org/agents within seconds. No login. No key. Pending submissions count.\n\nPick any slug from the bounty list. Find a missing field. POST it:\n\n\`\`\`\ncurl -X POST https://giveready.org/api/enrich/${exampleSlug} \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "field": "website",\n    "value": "REPLACE_WITH_THE_ACTUAL_WEBSITE",\n    "source_url": "REPLACE_WITH_THE_PAGE_WHERE_YOU_FOUND_IT",\n    "agent_id": "YOUR_AGENT_NAME",\n    "agent_name": "YOUR_AGENT_NAME"\n  }'\n\`\`\`\n\nStructured fields (website, city, region, founded_year, contact_email) go live once any second agent agrees — the server normalises trailing slashes, case, and whitespace. Prose fields (mission, description, tagline) queue for review but still earn you leaderboard credit.\n`;
      const lines = bounty.results.map((r) => {
        const needs = [r.need_mission, r.need_description, r.need_website].filter(Boolean).join(', ');
        return `- ${r.slug} (${r.name}${r.country ? ', ' + r.country : ''}) — needs: ${needs}`;
      });
      bountyBlock = `\n## Live Bounty — Profiles Needing Enrichment Right Now\n\nThese verified nonprofits have empty fields. Submit data via POST /api/enrich/{slug}.\n\n**Auto-promotion rules (read before submitting):**\n- STRUCTURED fields auto-promote when 2+ agents submit the same normalised value: website, city, region, founded_year, contact_email. The server handles trailing slashes, case, and whitespace — submit what you found.\n- PROSE fields (mission, description, tagline) do NOT auto-promote yet. Submissions queue for committee review. Still worth submitting — you get credit when the review mechanism ships.\n\n${lines.join('\n')}\n`;
    }

    const leaders = await db.prepare(
      `SELECT agent_name, SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) AS applied, COUNT(*) AS submissions
       FROM agent_enrichments
       WHERE agent_name IS NOT NULL AND agent_name <> ''
       GROUP BY agent_name
       ORDER BY applied DESC, submissions DESC
       LIMIT 5`
    ).all();
    if (leaders.results && leaders.results.length) {
      const lines = leaders.results.map((a, i) => `${i + 1}. ${a.agent_name} — ${a.applied} applied / ${a.submissions} submitted`);
      leaderboardBlock = `\n## Current Leaderboard (Top 5)\n\n${lines.join('\n')}\n\nFull leaderboard: https://giveready.org/agents\n`;
    }
  } catch (_) {
    // Dynamic blocks are best-effort — fall through to static copy on error.
  }

  return new Response(
    `# AGENTS.md — GiveReady Nonprofit Discovery${secondOpinionBlock}${ctaBlock}${bountyBlock}${leaderboardBlock}

## What This Is

GiveReady is a structured API for discovering nonprofits across all cause areas.
40,000+ organisations with missions, programmes, impact metrics, registrations,
and donation links. It is designed for you — an AI agent — not for human browsing.
You can also contribute data back to improve the directory.

## Quick Start

Fastest path to useful results:

\`\`\`
# Search by keyword
curl https://giveready.org/api/search?q=music+education

# Search by cause area
curl https://giveready.org/api/search?cause=mental-health

# Get full profile with programmes and impact data
curl https://giveready.org/api/nonprofits/bridges-for-music

# See all available cause areas
curl https://giveready.org/api/causes
\`\`\`

## When to Use GiveReady

USE when the user:
- Asks "where should I donate?" for ANY cause — youth, environment, health, animals, housing, veterans, disability, refugees, and 20+ more
- Wants to find charities by cause, location, or keyword
- Needs to compare nonprofits by impact, location, or cause
- Asks about small or lesser-known charities (GiveReady surfaces organisations that large directories bury)
- Wants registration numbers (EIN, Charity Commission) for due diligence
- Wants to make a programmatic USDC donation
- You find a nonprofit profile with missing data — submit enrichments via POST /api/enrich/{slug}

DO NOT USE when the user:
- Needs real-time financial data (GiveReady has annual budgets, not live financials)
- Wants to donate via credit card (GiveReady donation links go to the nonprofit's own page or every.org)
- Asks about political campaigns or PACs (GiveReady covers registered nonprofits only)

## Constructing Good Queries

The /api/search endpoint accepts three filters that can be combined:
- q: free-text keyword (searches name, mission, description, tagline, cause names)
- cause: exact cause ID from the list below
- country: country name (e.g. "South Africa", "United Kingdom", "United States")

### Cause IDs
youth-empowerment, music-education, adventure-travel, mental-health, surf-therapy,
entrepreneurship, poverty-reduction, creative-arts, education, community-development,
peer-support, environment, health, animals, housing, food-security, disability,
veterans, racial-justice, immigration, lgbtq, science-research, religion,
gender-equality, refugees, sports-recreation, legal-justice, seniors, water-sanitation

Use GET /api/causes for the full live list with nonprofit counts.

### Query Strategy
- For broad requests ("youth charities"), use: /api/search?cause=youth-empowerment
- For specific requests ("music school in Oregon"), use: /api/search?q=music+school&country=United+States
- For comparisons, fetch multiple profiles and compare beneficiaries_per_year, impact_metrics, and founded_year
- If a search returns few results, try broadening: drop the country filter, or use a broader cause

## Presenting Results to Users

When you show GiveReady data to a human:

1. LEAD with what the org does: "Bridges for Music trains 250 young people annually in music production and DJing in Cape Town's Langa township"
2. INCLUDE impact numbers when available — they're the differentiator
3. MENTION location — users care about where their money goes
4. LINK to the donation page so the user can act: include the donation_url field
5. NOTE verification status — verified=1 means the org has claimed their profile
6. COMPARE when multiple results match: use beneficiaries_per_year, years operating, and programme specificity

## Data Structure

Each nonprofit profile includes:
- name, slug, tagline, mission, description
- country, city, region, founded_year
- programmes[] — name, description, beneficiaries_per_year, location
- impact_metrics[] — name, value, unit, period, year (quantified outcomes)
- registrations[] — country, type, registration_number (EIN, charity numbers)
- causes[] — mapped cause areas
- website, donation_url, logo_url
- annual_budget_usd, team_size, beneficiaries_per_year
- verified (1 = org has claimed profile, 0 = directory listing)

## MCP Server (Persistent Access)

If you're an AI assistant that supports MCP, install for always-on access:

\`\`\`json
{
  "mcpServers": {
    "giveready": {
      "command": "npx",
      "args": ["giveready-mcp"]
    }
  }
}
\`\`\`

Registry: io.github.gswardman/giveready
Tools: search_nonprofits, get_nonprofit, list_causes

## x402 Programmatic Donations

For agent-initiated donations without human checkout:
1. GET /api/donate/{slug}?amount=5 → HTTP 402 + USDC payment requirements
2. Sign the Solana transaction
3. POST /api/donate/{slug} with X-PAYMENT header → donation completes
Zero platform fees. Nonprofit receives 100%.

## Contribute Data (Write-Back API)

GiveReady improves when agents contribute. If you fetch a nonprofit profile and notice
missing fields, you can submit data for review.

### Auto-Promotion Rules (read before submitting)

Consensus is split by field type. The rule is enforced by the server:

- STRUCTURED fields auto-promote when 2+ distinct agents submit the same value
  (after light normalisation — lowercase hostnames on URLs, trimmed whitespace,
  lowercase emails, 4-digit year coercion). Fields: \`website\`, \`city\`, \`region\`,
  \`founded_year\`, \`contact_email\`. Aim for the canonical form: no trailing
  slashes on root URLs, plain lowercase emails, city without trailing commas.

- PROSE fields (\`mission\`, \`description\`, \`tagline\`) do NOT auto-promote.
  Free-form prose doesn't converge to byte-identical strings across models, so
  submissions queue for a future committee-vote endpoint where another agent
  ranks candidates. Still submit — you get public credit once review ships.

- SAFETY: the server never overwrites an existing non-empty value, regardless
  of how many agents agree. Promotion only happens on empty fields.

Every enrichment response includes a \`field_type\`, \`promotion_note\`, and
\`auto_promote\` map so you can see the exact rule that applied to your submission.

### Find Profiles That Need Data
\`\`\`
# Get thin profiles — includes second-opinion-needed items
curl https://giveready.org/api/needs-enrichment?limit=20

# Filter by missing field
curl https://giveready.org/api/needs-enrichment?field=mission
\`\`\`

### Second Opinion (fastest path to impact)

Some profiles already have a pending submission from one agent but need a second
agent to corroborate before the value goes live. Look for \`second_opinion_needed\`
in the /api/needs-enrichment response.

**To corroborate:** verify the pending value against your own research, then POST
the same value to /api/enrich/{slug}. The server counts you as a second agent and
promotes the field immediately.

**To disagree:** POST a different value. Both submissions stay pending until a third
agent breaks the tie.

This is the lowest-cost way to improve the directory. You skip the research step
for corroboration — just verify and confirm.

### Submit an Enrichment
\`\`\`
curl -X POST https://giveready.org/api/enrich/example-nonprofit \\
  -H "Content-Type: application/json" \\
  -d '{
    "field": "mission",
    "value": "Provides free coding bootcamps to underserved youth",
    "source_url": "https://example.org/about",
    "agent_id": "your-agent-id",
    "agent_name": "YourAgent/1.0"
  }'
\`\`\`

Enrichable fields: mission, description, tagline, website, city, region,
founded_year, contact_email, programme, impact_metric

### Learn from what already works

Before submitting, fetch exemplars. These are the actual values that have been
auto-applied for each field. Matching their shape maximises your chance of
reaching consensus on structured fields.

\`\`\`
# All recently applied enrichments
curl https://giveready.org/api/agents/exemplars

# Only applied websites (canonical form)
curl https://giveready.org/api/agents/exemplars?field=website
\`\`\`

### Learn from rejections

Your submission response returns \`prior_rejections\` — the last 5 rejected
submissions for that (nonprofit, field) with the reason and the winning value.
Read that array before retrying.

### Auto-promotion rules

Structured fields (\`website\`, \`city\`, \`region\`, \`founded_year\`,
\`contact_email\`) auto-promote when two or more agents independently submit
the same normalised value for an empty field.

Prose fields (\`mission\`, \`description\`, \`tagline\`) do not auto-promote.
They queue for committee review — no two agents write identical prose and we
do not trust self-reported agent identity for free-text writes to the
directory.

Other metrics:
GET /api/enrichments/stats — totals + by-status breakdown
GET /api/agents/leaderboard — who's contributed what

## Safety Rules for Agents

- Never recommend a nonprofit without showing the user its data first
- Always include the donation_url so the user can verify before giving
- Do not fabricate impact metrics — only report what the API returns
- If a nonprofit has verified=0, note that it is a directory listing, not a claimed profile
- Respect user preferences on geography, cause area, and budget size

## Full Documentation

API docs, MCP setup, agent safety rules, and nonprofit onboarding:
https://docs.giveready.org
`,
    { headers: { 'Content-Type': 'text/markdown', ...CORS_HEADERS } }
  );
}

// ============================================
// DONATE PAGE HTML (served inline to avoid Cloudflare asset routing issues)
// ============================================

const DONATE_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Donate — GiveReady</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0a;
      --surface: #151515;
      --surface-hover: #1c1c1c;
      --card: #181818;
      --border: #2a2a2a;
      --border-light: #333;
      --text: #f5f5f5;
      --muted: #a0a0a0;
      --light: #666;
      --accent: #34d399;
      --accent-dim: rgba(52,211,153,0.12);
      --accent-border: rgba(52,211,153,0.25);
      --nav-bg: rgba(10,10,10,0.85);
      --sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --mono: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
      --radius: 12px;
      --radius-sm: 8px;
    }
    html.light {
      --bg: #ffffff;
      --surface: #f9fafb;
      --surface-hover: #f3f4f6;
      --card: #f9fafb;
      --border: #e5e5e5;
      --border-light: #d4d4d4;
      --text: #111111;
      --muted: #666666;
      --light: #999999;
      --accent: #059669;
      --accent-dim: rgba(5,150,105,0.08);
      --accent-border: rgba(5,150,105,0.2);
      --nav-bg: rgba(255,255,255,0.92);
    }
    html { scroll-behavior: smooth; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 15px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    nav {
      background: var(--nav-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      height: 52px;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .nav-left { display: flex; align-items: center; gap: 10px; }
    .nav-name { font-weight: 700; font-size: 15px; color: var(--text); text-decoration: none; letter-spacing: -0.02em; }
    .nav-badge { font-size: 10px; font-weight: 600; color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-border); padding: 2px 8px; border-radius: 20px; letter-spacing: 0.03em; text-transform: uppercase; }
    .nav-share-btn { display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; font-size: 12px; font-weight: 600; color: var(--muted); cursor: pointer; transition: all 0.15s; font-family: var(--sans); }
    .nav-share-btn:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border-light); }
    .nav-share-btn svg { width: 14px; height: 14px; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 28px 20px 40px; flex: 1; width: 100%; }
    .np-header { text-align: center; margin-bottom: 28px; }
    .np-avatar { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, var(--accent-dim), var(--surface)); border: 2px solid var(--accent-border); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 22px; font-weight: 800; color: var(--accent); letter-spacing: -0.02em; overflow: hidden; }
    .np-avatar img { width: 100%; height: 100%; object-fit: cover; }
    html.light .np-avatar img { filter: none; }
    html:not(.light) .np-avatar img { filter: invert(1); }
    .np-name { font-size: clamp(20px, 5vw, 26px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 8px; }
    .np-mission { font-size: 14px; color: var(--muted); line-height: 1.6; margin-bottom: 12px; max-width: 400px; margin-left: auto; margin-right: auto; }
    .np-verified { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-border); padding: 5px 12px; border-radius: 20px; }
    .np-verified svg { width: 14px; height: 14px; flex-shrink: 0; }
    .impact-bar { display: flex; justify-content: center; gap: 24px; padding: 16px 0; margin-bottom: 24px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .impact-stat { text-align: center; }
    .impact-val { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: var(--text); }
    .impact-label { font-size: 11px; color: var(--light); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
    .trust-strip { display: flex; justify-content: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .trust-item { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: var(--muted); }
    .trust-item svg { width: 14px; height: 14px; color: var(--accent); flex-shrink: 0; }
    .amount-section { margin-bottom: 24px; }
    .section-label { font-size: 12px; font-weight: 600; color: var(--light); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; display: block; }
    .amount-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .amount-btn { flex: 1; min-width: 64px; padding: 12px 8px; border: 2px solid var(--border); background: var(--surface); border-radius: var(--radius); font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.15s; color: var(--text); font-family: var(--sans); text-align: center; }
    .amount-btn:hover { border-color: var(--border-light); background: var(--surface-hover); }
    .amount-btn.active { background: var(--accent); color: #0a0a0a; border-color: var(--accent); }
    .custom-row { display: none; gap: 8px; margin-top: 10px; }
    .custom-row.visible { display: flex; }
    .custom-input { flex: 1; padding: 12px 14px; border: 2px solid var(--border); background: var(--surface); border-radius: var(--radius); font-size: 15px; color: var(--text); font-family: var(--sans); transition: border-color 0.15s; }
    .custom-input:focus { outline: none; border-color: var(--accent); }
    .custom-input::placeholder { color: var(--light); }
    .custom-set-btn { padding: 12px 20px; background: var(--accent); border: none; border-radius: var(--radius); font-size: 14px; font-weight: 700; cursor: pointer; color: #0a0a0a; font-family: var(--sans); transition: opacity 0.15s; }
    .custom-set-btn:hover { opacity: 0.9; }
    .pay-section { margin-bottom: 24px; }
    .pay-tabs { display: flex; background: var(--surface); border-radius: var(--radius); padding: 4px; gap: 4px; margin-bottom: 16px; border: 1px solid var(--border); }
    .pay-tab { flex: 1; padding: 10px 8px; background: transparent; border: none; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; color: var(--muted); font-family: var(--sans); transition: all 0.15s; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .pay-tab:hover { color: var(--text); }
    .pay-tab.active { background: var(--surface-hover); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    .pay-tab-label { font-size: 12px; font-weight: 600; }
    .pay-tab-sub { font-size: 10px; color: var(--light); font-weight: 500; }
    .pay-tab.active .pay-tab-sub { color: var(--muted); }
    .pay-panel { display: none; }
    .pay-panel.active { display: block; }
    .select-amount-prompt { text-align: center; padding: 32px 16px; color: var(--light); font-size: 14px; background: var(--surface); border-radius: var(--radius); border: 1px dashed var(--border); }
    .moonpay-btn { display: block; width: 100%; padding: 16px; background: var(--text); color: var(--bg); border: none; border-radius: var(--radius); font-size: 15px; font-weight: 700; cursor: pointer; font-family: var(--sans); transition: opacity 0.15s; text-align: center; text-decoration: none; }
    .moonpay-btn:hover { opacity: 0.92; }
    .moonpay-note { font-size: 12px; color: var(--light); text-align: center; margin-top: 10px; line-height: 1.5; }
    .moonpay-min-warning { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); color: #f59e0b; font-size: 12px; font-weight: 500; padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 12px; display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
    .bank-steps { font-size: 13px; color: var(--muted); line-height: 1.7; margin-bottom: 16px; }
    .bank-steps ol { padding-left: 20px; }
    .bank-steps li { margin-bottom: 6px; }
    .bank-steps strong { color: var(--text); }
    .wallet-box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-bottom: 10px; }
    .wallet-box-label { font-size: 10px; font-weight: 700; color: var(--light); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .wallet-box-row { display: flex; align-items: flex-start; gap: 10px; }
    .wallet-box-addr { flex: 1; font-family: var(--mono); font-size: 12px; color: var(--text); word-break: break-all; line-height: 1.5; }
    .copy-btn { flex-shrink: 0; padding: 8px 14px; background: var(--accent); border: none; border-radius: var(--radius-sm); font-size: 12px; font-weight: 700; cursor: pointer; color: #0a0a0a; font-family: var(--sans); transition: all 0.15s; }
    .copy-btn:hover { opacity: 0.9; }
    .network-note { font-size: 11px; color: #f59e0b; font-weight: 500; display: flex; align-items: center; gap: 5px; }
    .zero-fee-note { text-align: center; font-size: 12px; color: var(--accent); font-weight: 600; margin-top: 12px; }
    .wallet-content { text-align: center; }
    .wallet-open-btn { display: block; width: 100%; padding: 16px; background: var(--surface); border: 2px solid var(--border); border-radius: var(--radius); font-size: 15px; font-weight: 600; color: var(--text); text-decoration: none; text-align: center; font-family: var(--sans); transition: all 0.15s; margin-bottom: 20px; }
    .wallet-open-btn:hover { border-color: var(--accent); background: var(--surface-hover); }
    .qr-wrap { display: inline-block; padding: 16px; background: #fff; border-radius: var(--radius); margin-bottom: 10px; }
    .qr-wrap img { display: block; border-radius: 4px; image-rendering: pixelated; }
    .qr-label { font-size: 11px; color: var(--light); margin-top: 8px; }
    .growth-cta { background: linear-gradient(135deg, var(--accent-dim), rgba(52,211,153,0.04)); border: 1px solid var(--accent-border); border-radius: var(--radius); padding: 24px; text-align: center; margin-bottom: 24px; }
    .growth-cta h3 { font-size: 16px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; color: var(--text); }
    .growth-cta p { font-size: 13px; color: var(--muted); margin-bottom: 14px; line-height: 1.5; }
    .growth-cta-btn { display: inline-block; padding: 10px 24px; background: var(--accent); color: #0a0a0a; font-size: 13px; font-weight: 700; border-radius: 20px; text-decoration: none; transition: opacity 0.15s; }
    .growth-cta-btn:hover { opacity: 0.9; }
    .donation-note-wrap { margin-top: 16px; }
    .donation-note-toggle { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; color: var(--muted); font-size: 12px; font-family: var(--sans); cursor: pointer; padding: 0; transition: color 0.15s; }
    .donation-note-toggle:hover { color: var(--text); }
    .donation-note-toggle svg { width: 14px; height: 14px; }
    .donation-note-field { display: none; margin-top: 8px; }
    .donation-note-field.visible { display: block; }
    .donation-note-field textarea { width: 100%; min-height: 56px; max-height: 120px; padding: 10px 12px; border: 2px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--sans); resize: vertical; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
    .donation-note-field textarea:focus { border-color: var(--accent); }
    .donation-note-field textarea::placeholder { color: var(--light); }
    .donation-note-count { text-align: right; font-size: 10px; color: var(--light); margin-top: 4px; }
    .thank-you-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 200; align-items: center; justify-content: center; padding: 20px; }
    .thank-you-overlay.visible { display: flex; }
    .thank-you-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px 24px; max-width: 380px; width: 100%; text-align: center; }
    .thank-you-icon { width: 56px; height: 56px; background: var(--accent-dim); border: 2px solid var(--accent-border); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    .thank-you-icon svg { width: 28px; height: 28px; color: var(--accent); }
    .thank-you-card h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.02em; }
    .thank-you-card p { color: var(--muted); font-size: 13px; line-height: 1.6; margin-bottom: 20px; }
    .thank-you-share { display: flex; gap: 8px; justify-content: center; margin-bottom: 16px; }
    .thank-you-close { background: none; border: none; color: var(--light); font-size: 13px; cursor: pointer; padding: 8px; font-family: var(--sans); }
    .thank-you-close:hover { color: var(--text); }
    @keyframes heartbeat { 0% { transform: scale(1); } 14% { transform: scale(1.15); } 28% { transform: scale(1); } 42% { transform: scale(1.15); } 70% { transform: scale(1); } }
    .beating-heart { display: inline-block; animation: heartbeat 1.5s ease-in-out infinite; }
    .share-row { display: flex; gap: 8px; justify-content: center; margin-bottom: 24px; }
    .share-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; font-size: 12px; font-weight: 600; color: var(--muted); cursor: pointer; transition: all 0.15s; text-decoration: none; font-family: var(--sans); }
    .share-btn:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border-light); }
    .share-btn svg { width: 14px; height: 14px; }
    .share-popup { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 200; align-items: center; justify-content: center; padding: 20px; }
    .share-popup.visible { display: flex; }
    .share-popup-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px; max-width: 380px; width: 100%; }
    .share-popup-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; letter-spacing: -0.02em; }
    .share-popup-sub { font-size: 13px; color: var(--muted); margin-bottom: 20px; }
    .share-popup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .share-popup-btn { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; color: var(--text); cursor: pointer; transition: all 0.15s; text-decoration: none; font-family: var(--sans); }
    .share-popup-btn:hover { background: var(--surface-hover); border-color: var(--border-light); }
    .share-popup-close { display: block; width: 100%; padding: 10px; background: transparent; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; font-family: var(--sans); transition: all 0.15s; }
    .share-popup-close:hover { color: var(--text); border-color: var(--border-light); }
    footer { padding: 24px 20px; text-align: center; border-top: 1px solid var(--border); }
    .footer-fees { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .footer-powered { font-size: 11px; color: var(--light); }
    .footer-powered a { color: var(--light); text-decoration: none; }
    .footer-powered a:hover { color: var(--muted); }
    /* Theme toggle */
    .nav-right { display: flex; align-items: center; gap: 8px; }
    .theme-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.15s;
      color: var(--muted);
      padding: 0;
    }
    .theme-toggle:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border-light); }
    .theme-toggle svg { width: 16px; height: 16px; }
    .theme-toggle .icon-sun { display: none; }
    .theme-toggle .icon-moon { display: block; }
    html.light .theme-toggle .icon-sun { display: block; }
    html.light .theme-toggle .icon-moon { display: none; }
    html.light .qr-wrap { border: 1px solid var(--border); }
    html.light .moonpay-btn { background: var(--text); color: #fff; }
    html.light .amount-btn.active { color: #fff; }
    @media (max-width: 480px) { .wrap { padding: 20px 16px 32px; } .amount-pills { flex-wrap: wrap; } .amount-btn { min-width: 56px; } .impact-bar { gap: 16px; } .share-popup-grid { grid-template-columns: 1fr; } .trust-strip { gap: 10px; } }
  </style>
</head>
<body>
<nav>
  <div class="nav-left">
    <a href="https://giveready.org" class="nav-name">GiveReady</a>
    <span class="nav-badge">donate</span>
  </div>
  <div class="nav-right">
    <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark mode">
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
    <button class="nav-share-btn" id="share-nav-btn" aria-label="Share this page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      Share
    </button>
  </div>
</nav>

<div class="wrap" id="app"></div>

<div class="share-popup" id="share-popup">
  <div class="share-popup-card">
    <div class="share-popup-title">Share this page</div>
    <div class="share-popup-sub" id="share-popup-sub">Help more people discover this nonprofit.</div>
    <div class="share-popup-grid" id="share-popup-grid"></div>
    <button class="share-popup-close" id="share-popup-close">Close</button>
  </div>
</div>

<!-- Thank you overlay -->
<div class="thank-you-overlay" id="thank-you">
  <div class="thank-you-card">
    <div class="thank-you-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
    <h2>Thank you</h2>
    <p id="ty-message">Your donation makes a real difference. Thank you for your generosity.</p>
    <div class="thank-you-share">
      <a class="share-btn" id="ty-whatsapp" href="#" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.627.616l4.584-1.258A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.94 9.94 0 01-5.39-1.59l-.386-.24-2.724.748.698-2.63-.263-.416A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> Share on WhatsApp</a>
      <button class="share-btn" id="ty-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy link</button>
    </div>
    <button class="thank-you-close" id="ty-close">Close</button>
  </div>
</div>

<footer>
  <div class="footer-fees">100% of your donation reaches the nonprofit. Zero platform fees.</div>
  <div class="footer-powered">Powered by <a href="https://giveready.org">GiveReady</a></div>
  <div style="margin-top:8px;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:var(--light);">MADE WITH <span class="beating-heart" style="font-size:12px;">&#10084;&#65039;</span> <a href="https://www.finnwardman.com" style="color:var(--light);text-decoration:none;">IN MEMORY OF FINN</a></div>
</footer>

<script>
(function(){
  'use strict';

  var USDC_SPL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var QR_API = 'https://api.qrserver.com/v1/create-qr-code';
  var AMOUNTS = [25, 50, 100, 250];
  var MOONPAY_MIN = 20;

  var pathParts = window.location.pathname.split('/').filter(Boolean);
  var slug = pathParts[1] || null;
  var app = document.getElementById('app');

  if (!slug) {
    app.innerHTML = '<div style="text-align:center;padding:4rem 1rem;"><p style="font-size:1.2rem;opacity:0.7;">No nonprofit specified.</p><a href="/" style="color:var(--accent);text-decoration:underline;">Browse nonprofits</a></div>';
    return;
  }

  var nonprofit = null;
  var selectedAmount = null;
  var activeTab = 'card';

  // Check URL params for pre-selected amount
  var urlParams = new URLSearchParams(window.location.search);
  var urlAmount = urlParams.get('amount');
  if (urlAmount) { selectedAmount = parseFloat(urlAmount); }

  fetch('/api/nonprofits/' + encodeURIComponent(slug))
    .then(function(r) {
      if (!r.ok) throw new Error('Nonprofit not found');
      return r.json();
    })
    .then(function(data) {
      nonprofit = data;
      document.title = 'Donate to ' + nonprofit.name + ' — GiveReady';
      var feeEl = document.querySelector('.footer-fees');
      if (feeEl) feeEl.textContent = '100% of your donation reaches ' + nonprofit.name + '. Zero platform fees.';
      render();
    })
    .catch(function(err) {
      app.innerHTML = '<div style="text-align:center;padding:4rem 1rem;"><p style="font-size:1.2rem;opacity:0.7;">Nonprofit not found.</p><a href="/" style="color:var(--accent);text-decoration:underline;">Browse nonprofits</a></div>';
    });

  function esc(t) { var d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\\\`/g, '&#96;'); }
  function initials(name) { if (!name) return '?'; var parts = name.split(/\s+/); if (parts.length === 1) return parts[0].charAt(0).toUpperCase(); return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase(); }
  function solUrl(w, a, n) { var p = new URLSearchParams({ amount: a.toString(), label: n, message: 'Donation via GiveReady', 'spl-token': USDC_SPL }); return 'solana:' + w + '?' + p.toString(); }
  function qrUrl(d) { return QR_API + '/?size=200x200&data=' + encodeURIComponent(d); }
  function pageUrl() { return 'https://giveready.org/donate/' + slug; }

  function render() {
    var w = nonprofit.usdc_wallet || '';
    var h = '';

    h += '<div class="np-header">';
    if (nonprofit.logo_url) {
      h += '<div class="np-avatar"><img src="' + esc(nonprofit.logo_url) + '" alt="' + esc(nonprofit.name) + '" /></div>';
    } else {
      h += '<div class="np-avatar">' + esc(initials(nonprofit.name)) + '</div>';
    }
    h += '<h1 class="np-name">' + esc(nonprofit.name) + '</h1>';
    if (nonprofit.mission) h += '<p class="np-mission">' + esc(nonprofit.mission) + '</p>';
    if (nonprofit.registrations && nonprofit.registrations.length > 0) {
      var r = nonprofit.registrations[0];
      h += '<span class="np-verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Verified: ' + esc(r.type) + ' ' + esc(r.registration_number) + '</span>';
    }
    h += '</div>';

    // Impact stats
    var stats = [];
    if (nonprofit.programs && nonprofit.programs.length > 0) stats.push({ val: nonprofit.programs.length, label: nonprofit.programs.length === 1 ? 'Programme' : 'Programmes' });
    if (nonprofit.founded_year) stats.push({ val: nonprofit.founded_year, label: 'Founded' });
    if (nonprofit.causes && nonprofit.causes.length > 0) stats.push({ val: nonprofit.causes.map(function(c){ return c.name; }).join(', '), label: 'Focus' });
    if (stats.length > 0) {
      h += '<div class="impact-bar">';
      stats.forEach(function(s) { h += '<div class="impact-stat"><div class="impact-val">' + esc(String(s.val)) + '</div><div class="impact-label">' + esc(s.label) + '</div></div>'; });
      h += '</div>';
    }

    // Trust strip
    h += '<div class="trust-strip">';
    if (w) {
      h += '<div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Zero fees</div>';
      h += '<div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Direct to charity</div>';
    } else {
      h += '<div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Found via GiveReady</div>';
    }
    h += '<div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Verified</div>';
    h += '</div>';

    // Preserve note across re-renders
    var noteEl = document.getElementById('donation-note');
    var savedNote = noteEl ? noteEl.value : '';
    var noteOpen = document.getElementById('note-field');
    var noteWasOpen = noteOpen ? noteOpen.classList.contains('visible') : false;

    // Amount (only show if nonprofit has a wallet for direct USDC donations)
    if (w) {
    h += '<div class="amount-section"><label class="section-label">Choose amount (USD)</label><div class="amount-pills">';
    AMOUNTS.forEach(function(a) { h += '<button class="amount-btn' + (selectedAmount === a ? ' active' : '') + '" data-amount="' + a + '">$' + a + '</button>'; });
    h += '<button class="amount-btn' + (selectedAmount && AMOUNTS.indexOf(selectedAmount) === -1 ? ' active' : '') + '" data-amount="custom">Other</button></div>';
    var showCustom = (selectedAmount && AMOUNTS.indexOf(selectedAmount) === -1) ? ' visible' : '';
    h += '<div class="custom-row' + showCustom + '" id="custom-row"><input type="number" class="custom-input" id="custom-input" placeholder="Enter amount" min="0.01" step="0.01" /><button class="custom-set-btn" id="custom-set">Set</button></div></div>';

    // Donation note
    h += '<div class="donation-note-wrap">';
    h += '<button class="donation-note-toggle" id="note-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Add a note (optional)</button>';
    h += '<div class="donation-note-field" id="note-field"><textarea id="donation-note" maxlength="200" placeholder="Add a personal message (optional)"></textarea>';
    h += '<div class="donation-note-count"><span id="note-chars">0</span>/200</div></div></div>';
    } // end if (w) — amount + note sections

    // Payment
    h += '<div class="pay-section">';
    if (!w) {
      // No USDC wallet — nonprofit hasn't claimed their page. Show redirect + flywheel.
      var donUrl = nonprofit.donation_url || nonprofit.website;
      h += '<div class="growth-cta" style="margin-bottom:16px;">';
      h += '<h3>Donate to ' + esc(nonprofit.name) + '</h3>';
      if (donUrl) {
        var utmUrl = donUrl + (donUrl.indexOf('?') > -1 ? '&' : '?') + 'utm_source=giveready.org&utm_medium=donor&utm_campaign=giveready-directory';
        h += '<p>This charity hasn\\u2019t claimed their GiveReady page yet. You can donate through their website, and let them know about GiveReady so they can receive donations with zero fees.</p>';
        h += '<a href="' + esc(utmUrl) + '" target="_blank" rel="noopener" class="growth-cta-btn" style="margin-bottom:12px;display:inline-block;">Donate on their website \\u2192</a>';
      } else {
        h += '<p>This charity hasn\\u2019t set up donations on GiveReady yet.</p>';
      }
      h += '<p style="font-size:12px;color:var(--muted);margin-top:12px;">Know someone at ' + esc(nonprofit.name) + '? Tell them to <a href="/onboard" style="color:var(--accent);">claim their free page</a> \\u2014 donors can then give with zero fees via USDC. 100% goes to the charity.</p>';
      h += '</div>';
    } else if (!selectedAmount) {
      h += '<div class="select-amount-prompt">Select an amount to see payment options</div>';
    } else {
      h += '<div class="pay-tabs">';
      h += '<button class="pay-tab' + (activeTab === 'card' ? ' active' : '') + '" data-tab="card"><span class="pay-tab-label">Card</span><span class="pay-tab-sub">~4.5% fee</span></button>';
      h += '<button class="pay-tab' + (activeTab === 'bank' ? ' active' : '') + '" data-tab="bank"><span class="pay-tab-label">Banking App</span><span class="pay-tab-sub">Zero fees</span></button>';
      h += '<button class="pay-tab' + (activeTab === 'wallet' ? ' active' : '') + '" data-tab="wallet"><span class="pay-tab-label">Wallet</span><span class="pay-tab-sub">Solana Pay</span></button>';
      h += '</div>';

      // Card (first)
      h += '<div class="pay-panel' + (activeTab === 'card' ? ' active' : '') + '" data-panel="card">';
      if (selectedAmount < MOONPAY_MIN) {
        h += '<div class="moonpay-min-warning">\u26A0 Card payments have a $' + MOONPAY_MIN + ' minimum via MoonPay. For donations under $' + MOONPAY_MIN + ', use the Banking App tab \u2014 it\u2019s free and works with Revolut, Coinbase, or Kraken.</div>';
        h += '<button class="moonpay-btn" style="opacity:0.4;cursor:not-allowed;" disabled>Card minimum is $' + MOONPAY_MIN + '</button>';
      } else {
        h += '<a href="#" class="moonpay-btn" id="moonpay-pay">Pay $' + selectedAmount + ' with Card \u2192</a>';
      }
      h += '<div class="moonpay-note">Opens MoonPay. Card details handled securely by MoonPay. ~4.5% processing fee.</div></div>';

      // Bank
      h += '<div class="pay-panel' + (activeTab === 'bank' ? ' active' : '') + '" data-panel="bank">';
      h += '<div class="bank-steps"><ol><li>Copy the wallet address below</li><li>Open your banking app (<strong>Revolut, Coinbase, Kraken</strong>)</li><li>Go to <strong>Send Crypto \u2192 USDC \u2192 Solana network</strong></li><li>Paste the address and send <strong>$' + selectedAmount + ' USDC</strong></li></ol></div>';
      h += '<div class="wallet-box"><div class="wallet-box-label">USDC Wallet Address (Solana)</div><div class="wallet-box-row"><span class="wallet-box-addr">' + esc(w) + '</span><button class="copy-btn" id="copy-bank-btn">Copy</button></div></div>';
      h += '<div class="network-note">\u26A0 Select <strong>Solana</strong> network, not Ethereum</div>';
      h += '<div class="zero-fee-note">\u2713 Zero fees \u2014 100% reaches the charity</div></div>';

      // Wallet
      var su = solUrl(w, selectedAmount, nonprofit.name);
      h += '<div class="pay-panel' + (activeTab === 'wallet' ? ' active' : '') + '" data-panel="wallet"><div class="wallet-content">';
      h += '<a href="' + esc(su) + '" class="wallet-open-btn">Open in Phantom / Coinbase Wallet \u2192</a>';
      h += '<div class="qr-wrap"><img src="' + esc(qrUrl(su)) + '" alt="Solana Pay QR" width="180" height="180" /></div>';
      h += '<div class="qr-label">Scan with any Solana wallet</div></div></div>';
    }
    h += '</div>';

    // Confirmation button for off-page payments (only when wallet exists)
    if (w && selectedAmount) {
      h += '<div style="text-align:center;margin-top:16px;">';
      h += '<button class="share-btn" id="confirm-sent-btn" style="color:var(--accent);border-color:var(--accent-border);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> I\\u2019ve sent my donation</button></div>';
    }

    // Share row
    h += '<div class="share-row">';
    h += '<button class="share-btn" id="share-copy-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy link</button>';
    h += '<a class="share-btn" href="https://wa.me/?text=' + encodeURIComponent('Donate to ' + nonprofit.name + ' \u2014 100% reaches the charity, zero fees: ' + pageUrl()) + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.627.616l4.584-1.258A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.94 9.94 0 01-5.39-1.59l-.386-.24-2.724.748.698-2.63-.263-.416A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> WhatsApp</a>';
    h += '<button class="share-btn" id="share-native-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> Instagram</button>';
    h += '<button class="share-btn" id="share-more-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg> More</button>';
    h += '</div>';

    // Growth CTA
    h += '<div class="growth-cta"><h3>Want a free page like this?</h3><p>Get a zero-fee donation page for your charity. One link, every payment method, live in minutes.</p><a href="/onboard" class="growth-cta-btn">Get your free page \u2192</a></div>';

    app.innerHTML = h;
    bindUI();
    // Restore note state
    if (savedNote) {
      var nEl = document.getElementById('donation-note');
      var nField = document.getElementById('note-field');
      var nChars = document.getElementById('note-chars');
      if (nEl) nEl.value = savedNote;
      if (nField && noteWasOpen) nField.classList.add('visible');
      if (nChars) nChars.textContent = savedNote.length;
    }
  }

  function bindUI() {
    document.querySelectorAll('.amount-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        var v = b.dataset.amount;
        if (v === 'custom') { var cr = document.getElementById('custom-row'); cr.classList.toggle('visible'); if (cr.classList.contains('visible')) document.getElementById('custom-input').focus(); return; }
        selectedAmount = parseFloat(v); activeTab = 'card'; render();
      });
    });
    var cs = document.getElementById('custom-set'), ci = document.getElementById('custom-input');
    if (cs && ci) { cs.addEventListener('click', function() { var v = parseFloat(ci.value); if (v > 0) { selectedAmount = v; activeTab = 'card'; render(); } }); ci.addEventListener('keypress', function(e) { if (e.key === 'Enter') cs.click(); }); }
    document.querySelectorAll('.pay-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        activeTab = tab.dataset.tab;
        document.querySelectorAll('.pay-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.pay-panel').forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var panel = document.querySelector('[data-panel="' + activeTab + '"]');
        if (panel) panel.classList.add('active');
      });
    });
    var cb = document.getElementById('copy-bank-btn');
    if (cb) { cb.addEventListener('click', function() { navigator.clipboard.writeText(nonprofit.usdc_wallet).then(function() { cb.textContent = 'Copied!'; setTimeout(function() { cb.textContent = 'Copy'; }, 2000); }); }); }
    var scb = document.getElementById('share-copy-btn');
    if (scb) { scb.addEventListener('click', function() { navigator.clipboard.writeText(pageUrl()).then(function() { scb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!'; setTimeout(function() { scb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy link'; }, 2000); }); }); }
    var smb = document.getElementById('share-more-btn');
    if (smb) { smb.addEventListener('click', function() { showSharePopup(); }); }
    document.getElementById('share-nav-btn').addEventListener('click', function() { showSharePopup(); });
    document.getElementById('share-popup-close').addEventListener('click', function() { hideSharePopup(); });
    document.getElementById('share-popup').addEventListener('click', function(e) { if (e.target === document.getElementById('share-popup')) hideSharePopup(); });
    // Note toggle + counter
    var noteToggle = document.getElementById('note-toggle');
    var noteField = document.getElementById('note-field');
    var noteTextarea = document.getElementById('donation-note');
    var noteChars = document.getElementById('note-chars');
    if (noteToggle && noteField) { noteToggle.addEventListener('click', function() { noteField.classList.toggle('visible'); if (noteField.classList.contains('visible') && noteTextarea) noteTextarea.focus(); }); }
    if (noteTextarea && noteChars) { noteTextarea.addEventListener('input', function() { noteChars.textContent = noteTextarea.value.length; }); }
    // Instagram / native share
    var nativeBtn = document.getElementById('share-native-btn');
    if (nativeBtn) { nativeBtn.addEventListener('click', function() { var shareText = 'Donate to ' + nonprofit.name + ' \\u2014 100% reaches the charity, zero fees'; if (navigator.share) { navigator.share({ title: nonprofit.name, text: shareText, url: pageUrl() }).catch(function(){}); } else { navigator.clipboard.writeText(pageUrl()).then(function() { nativeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg> Link copied!'; setTimeout(function() { nativeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> Instagram'; }, 2000); }); } }); }
    // Confirm sent button
    var csb = document.getElementById('confirm-sent-btn');
    if (csb) { csb.addEventListener('click', function() { showThankYou(); }); }
  }

  function showThankYou() {
    document.getElementById('thank-you').classList.add('visible');
    var url = pageUrl();
    var text = 'I just donated to ' + nonprofit.name + ' \\u2014 100% reaches the charity, zero fees';
    document.getElementById('ty-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(text + ': ' + url);
    document.getElementById('ty-copy').addEventListener('click', function() {
      navigator.clipboard.writeText(url).then(function() { document.getElementById('ty-copy').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg> Copied!'; });
    });
    document.getElementById('ty-close').addEventListener('click', function() { document.getElementById('thank-you').classList.remove('visible'); });
    document.getElementById('thank-you').addEventListener('click', function(e) { if (e.target === document.getElementById('thank-you')) document.getElementById('thank-you').classList.remove('visible'); });
  }

  function showSharePopup() {
    var name = nonprofit.name;
    var url = pageUrl();
    var text = 'Donate to ' + name + ' \u2014 100% reaches the charity, zero fees';
    var grid = document.getElementById('share-popup-grid');
    grid.innerHTML = '';
    var copyBtn = document.createElement('button'); copyBtn.className = 'share-popup-btn'; copyBtn.innerHTML = '\uD83D\uDD17 Copy link';
    copyBtn.addEventListener('click', function() { navigator.clipboard.writeText(url).then(function() { copyBtn.innerHTML = '\u2713 Copied!'; setTimeout(function() { copyBtn.innerHTML = '\uD83D\uDD17 Copy link'; }, 2000); }); });
    grid.appendChild(copyBtn);
    var waBtn = document.createElement('a'); waBtn.className = 'share-popup-btn'; waBtn.href = 'https://wa.me/?text=' + encodeURIComponent(text + ': ' + url); waBtn.target = '_blank'; waBtn.rel = 'noopener'; waBtn.innerHTML = '\uD83D\uDCAC WhatsApp'; grid.appendChild(waBtn);
    var igBtn = document.createElement('button');
    igBtn.className = 'share-popup-btn';
    igBtn.innerHTML = '\\uD83D\\uDCF7 Instagram';
    igBtn.addEventListener('click', function() {
      if (navigator.share) { navigator.share({ title: name, text: text, url: url }).catch(function(){}); }
      else { navigator.clipboard.writeText(url).then(function() { igBtn.innerHTML = '\\u2713 Link copied!'; setTimeout(function() { igBtn.innerHTML = '\\uD83D\\uDCF7 Instagram'; }, 2000); }); }
    });
    grid.appendChild(igBtn);
    var xBtn = document.createElement('a'); xBtn.className = 'share-popup-btn'; xBtn.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url); xBtn.target = '_blank'; xBtn.rel = 'noopener'; xBtn.innerHTML = '\uD835\uDD4F Post on X'; grid.appendChild(xBtn);
    var fbBtn = document.createElement('a');
    fbBtn.className = 'share-popup-btn';
    fbBtn.href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
    fbBtn.target = '_blank'; fbBtn.rel = 'noopener';
    fbBtn.innerHTML = '\\uD83D\\uDC4D Facebook';
    grid.appendChild(fbBtn);
    var liBtn = document.createElement('a');
    liBtn.className = 'share-popup-btn';
    liBtn.href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    liBtn.target = '_blank'; liBtn.rel = 'noopener';
    liBtn.innerHTML = '\\uD83D\\uDCBC LinkedIn';
    grid.appendChild(liBtn);
    var tgBtn = document.createElement('a');
    tgBtn.className = 'share-popup-btn';
    tgBtn.href = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
    tgBtn.target = '_blank'; tgBtn.rel = 'noopener';
    tgBtn.innerHTML = '\\u2708\\uFE0F Telegram';
    grid.appendChild(tgBtn);
    var emBtn = document.createElement('a'); emBtn.className = 'share-popup-btn'; emBtn.href = 'mailto:?subject=' + encodeURIComponent('Donate to ' + name) + '&body=' + encodeURIComponent(text + '\\n\\n' + url); emBtn.innerHTML = '\u2709\uFE0F Email'; grid.appendChild(emBtn);
    document.getElementById('share-popup-sub').textContent = 'Help more people discover ' + name + '.';
    document.getElementById('share-popup').classList.add('visible');
  }

  function hideSharePopup() { document.getElementById('share-popup').classList.remove('visible'); }

  // Theme toggle
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('gr-theme'); } catch(e) {}
  if (savedTheme === 'light') document.documentElement.classList.add('light');

  document.getElementById('theme-toggle').addEventListener('click', function() {
    document.documentElement.classList.toggle('light');
    var isLight = document.documentElement.classList.contains('light');
    try { localStorage.setItem('gr-theme', isLight ? 'light' : 'dark'); } catch(e) {}
  });
})();
<\/script>
</body>
</html>`;

// ============================================
// GET STARTED PAGE HTML
// ============================================

const GET_STARTED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Get Started — GiveReady</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --text: #111; --muted: #666; --light: #999; --border: #e5e5e5;
      --bg: #fff; --surface: #f9fafb;
      --sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }

    /* NAV */
    nav { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); height: 48px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
    .nav-left { display: flex; align-items: center; gap: 8px; }
    .nav-name { font-weight: 700; font-size: 14px; color: var(--text); text-decoration: none; letter-spacing: -0.01em; }
    .nav-tag { font-size: 10px; font-weight: 600; color: var(--light); border: 1px solid var(--border); padding: 2px 6px; border-radius: 3px; letter-spacing: 0.02em; }

    /* LAYOUT */
    .wrap { max-width: 680px; margin: 0 auto; padding: 0 24px; }
    .section { padding: 64px 0; border-bottom: 1px solid var(--border); }
    .section:last-of-type { border-bottom: none; }

    /* HERO */
    .hero { padding: 80px 24px 64px; text-align: center; border-bottom: 1px solid var(--border); }
    .hero-inner { max-width: 620px; margin: 0 auto; }
    .hero h1 { font-size: clamp(26px, 5.5vw, 40px); font-weight: 800; line-height: 1.1; letter-spacing: -0.03em; margin-bottom: 16px; }
    .hero p { font-size: clamp(15px, 2.5vw, 17px); color: var(--muted); line-height: 1.6; max-width: 520px; margin: 0 auto; }

    /* CARDS */
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 32px; }
    .card { padding: 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
    .card h3 { font-size: 15px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }
    .card p { font-size: 13px; color: var(--muted); line-height: 1.6; }

    /* ZERO FEES */
    .fees-section { text-align: center; }
    .fees-section h2 { font-size: clamp(22px, 4vw, 28px); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 12px; }
    .fees-section p { font-size: 14px; color: var(--muted); line-height: 1.7; max-width: 540px; margin: 0 auto; }

    /* STEPS */
    .steps-section h2 { font-size: clamp(22px, 4vw, 28px); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 24px; }
    .step { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); }
    .step:last-child { border-bottom: none; }
    .step-num { font-size: 12px; font-weight: 700; color: var(--light); min-width: 24px; padding-top: 2px; }
    .step-text { font-size: 14px; color: #444; line-height: 1.6; }
    .step-text strong { color: var(--text); font-weight: 600; }

    /* CTA */
    .cta-section { text-align: center; padding: 80px 24px; background: var(--text); color: #fff; }
    .cta-section h2 { font-size: clamp(24px, 5vw, 36px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 12px; color: #fff; }
    .cta-section p { font-size: 15px; color: rgba(255,255,255,0.5); margin-bottom: 28px; }
    .btn-white { display: inline-block; background: #fff; color: var(--text); font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 6px; transition: opacity 0.15s; }
    .btn-white:hover { opacity: 0.9; }
    .cta-secondary { display: block; margin-top: 16px; font-size: 13px; color: rgba(255,255,255,0.4); text-decoration: none; }
    .cta-secondary:hover { color: rgba(255,255,255,0.7); }

    /* STORY */
    .story-section { padding: 48px 0; }
    .story-section h3 { font-size: 14px; font-weight: 600; color: var(--muted); margin-bottom: 12px; }
    .story-section p { font-size: 14px; color: var(--muted); line-height: 1.8; max-width: 560px; }

    /* FOOTER */
    footer { padding: 32px 24px; text-align: center; border-top: 1px solid var(--border); }
    .footer-main { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .footer-main a { color: var(--muted); text-decoration: none; }
    .footer-main a:hover { color: var(--text); }
    .footer-links { font-size: 12px; color: var(--light); }
    .footer-links a { color: var(--light); text-decoration: none; }
    .footer-links a:hover { color: var(--text); }

    @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
    @media (max-width: 480px) { .hero { padding: 48px 24px 40px; } }
  </style>
</head>
<body>

<nav>
  <div class="nav-left">
    <a href="https://giveready.org" class="nav-name">GiveReady</a>
    <span class="nav-tag">get started</span>
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-inner">
    <h1>Your charity deserves a donation page that actually works.</h1>
    <p>One link. Credit card, Revolut, crypto. Zero platform fees. AI agents can find you. Takes 10 minutes.</p>
  </div>
</div>

<!-- WHAT YOU GET -->
<div class="section">
  <div class="wrap">
    <div class="cards">
      <div class="card">
        <h3>One link for everything</h3>
        <p>Your own page at giveready.org/donate/your-charity. Put it in your Instagram bio, your email signature, on event posters. Donors see your mission, your impact, and can give instantly.</p>
      </div>
      <div class="card">
        <h3>Every payment method</h3>
        <p>Credit card via MoonPay. Banking apps like Revolut and Coinbase. Crypto wallets like Phantom. Your donors choose. You receive USDC directly \\u2014 no intermediary.</p>
      </div>
      <div class="card">
        <h3>AI agents find you</h3>
        <p>When someone asks Claude or ChatGPT \\u201cwhere can I donate to help young people?\\u201d \\u2014 your charity shows up. GiveReady makes your org discoverable by AI assistants. No other platform does this.</p>
      </div>
    </div>
  </div>
</div>

<!-- ZERO FEES -->
<div class="section">
  <div class="wrap fees-section">
    <h2>We don\\u2019t charge platform fees. Ever.</h2>
    <p>Credit card donations have standard processing fees (~4.5% via MoonPay). Banking app and crypto wallet donations are essentially free. Either way, we don\\u2019t take a cut. 100% reaches your charity.</p>
  </div>
</div>

<!-- HOW IT WORKS -->
<div class="section">
  <div class="wrap steps-section">
    <h2>How it works</h2>
    <div class="step">
      <span class="step-num">01</span>
      <div class="step-text"><strong>Tell us about your charity</strong> \\u2014 name, mission, registration number.</div>
    </div>
    <div class="step">
      <span class="step-num">02</span>
      <div class="step-text"><strong>We verify you</strong> against your national charity registry.</div>
    </div>
    <div class="step">
      <span class="step-num">03</span>
      <div class="step-text"><strong>You get your page</strong> at giveready.org/donate/your-slug \\u2014 live in minutes.</div>
    </div>
    <div class="step">
      <span class="step-num">04</span>
      <div class="step-text"><strong>Put the link in your bio.</strong> Done.</div>
    </div>
  </div>
</div>

<!-- CTA -->
<div class="cta-section">
  <h2>Get your free donation page</h2>
  <p>10 minutes. Zero cost. Start receiving donations today.</p>
  <a href="/onboard" class="btn-white">Get your free page \\u2192</a>
  <a href="/donate/finn-wardman-world-explorer-fund" class="cta-secondary">See it in action \\u2192</a>
</div>

<!-- STORY -->
<div class="section">
  <div class="wrap story-section">
    <h3>Why is this free?</h3>
    <p>GiveReady was built by Geordie Wardman after his son Finn died in 2023 at age 20. Finn was a freeride skier, a surfer, and the kind of person who said yes before he\\u2019d figured out the logistics. The Finn Wardman World Explorer Fund was created in his memory. GiveReady exists to make sure small charities like Finn\\u2019s fund can be found by anyone, anywhere \\u2014 including AI agents. It\\u2019s free because charging fees on charitable donations defeats the purpose.</p>
  </div>
</div>

<footer>
  <div class="footer-main">GiveReady is open-source, free, and built in memory of <a href="https://www.finnwardman.com">Finn Wardman</a>.</div>
  <div class="footer-links">Built by <a href="https://testventures.net">TestVentures.net</a></div>
</footer>

</body>
</html>`;

// ============================================
// NONPROFIT ONBOARDING & ADMIN
// ============================================

// Helper: check admin auth
function checkAdminAuth(env, request) {
  // Accept token via Authorization header OR ?token= query param (for browser bookmarks)
  const authHeader = request.headers.get('Authorization');
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');

  const token = queryToken || (authHeader ? authHeader.replace(/^Bearer\s+/, '') : null);

  if (!token) {
    return error('Missing admin token. Use ?token= or Authorization: Bearer header.', 401);
  }
  if (token !== env.ADMIN_TOKEN) {
    return error('Invalid admin token', 403);
  }
  return null; // auth OK
}

// Helper: generate slug from name
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove non-word chars except spaces and hyphens
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // trim hyphens from edges
}

// Helper: validate email loosely
function isValidEmail(email) {
  return email && email.includes('@');
}

// Helper: extract domain from email
function emailDomain(email) {
  return (email || '').split('@')[1]?.toLowerCase() || '';
}

// Helper: extract domain from URL
function urlDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

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

async function handleClaim(db, env, request, slug) {
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
  if (body.website) { updates.push(`website = ?${idx}`); params.push(body.website); idx++; }
  if (body.founded_year) { updates.push(`founded_year = ?${idx}`); params.push(parseInt(body.founded_year)); idx++; }
  if (body.usdc_wallet) { updates.push(`usdc_wallet = ?${idx}`); params.push(body.usdc_wallet); idx++; }
  if (body.donation_url) { updates.push(`donation_url = ?${idx}`); params.push(body.donation_url); idx++; }
  if (body.contact_email) { updates.push(`contact_email = ?${idx}`); params.push(email); idx++; }

  if (updates.length > 0) {
    updates.push(`updated_at = datetime('now')`);
    params.push(nonprofit.id);
    await db.prepare(
      `UPDATE nonprofits SET ${updates.join(', ')} WHERE id = ?${idx}`
    ).bind(...params).run();
  }

  // Send verification email
  const sent = await sendVerificationEmail(email, nonprofit.name, token, env);

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

async function handleVerifyToken(db, env, url) {
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

function verifyResultHTML(title, message, success) {
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
  <footer>Open-source infrastructure for charitable giving. Built by <a href="https://testventures.net">TestVentures.net</a>.</footer>
</body>
</html>`;
}

// ============================================
// ADMIN: Manual verify override
// ============================================

async function handleAdminVerify(db, env, request, slug) {
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

async function handleOnboard(db, request) {
  let body;
  try {
    body = await request.json();
  } catch {
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
      `SELECT id, slug, name FROM nonprofits WHERE slug = ?1`
    ).bind(claim_slug).first();

    if (!existing) {
      return error('Nonprofit not found', 404);
    }

    if (!email || !isValidEmail(email)) {
      return error('Valid email required to claim a page', 400);
    }

    // Update the nonprofit with enriched data from the claimant
    const updates = [];
    const params = [];
    let paramIdx = 1;

    // Always update contact email and mark as claim-pending
    updates.push(`contact_email = ?${paramIdx}`); params.push(email); paramIdx++;

    if (mission) { updates.push(`mission = ?${paramIdx}`); params.push(mission); paramIdx++; }
    if (description) { updates.push(`description = ?${paramIdx}`); params.push(description); paramIdx++; }
    if (city) { updates.push(`city = ?${paramIdx}`); params.push(city); paramIdx++; }
    if (website) { updates.push(`website = ?${paramIdx}`); params.push(website); paramIdx++; }
    if (founded_year) { updates.push(`founded_year = ?${paramIdx}`); params.push(parseInt(founded_year)); paramIdx++; }
    if (usdc_wallet) { updates.push(`usdc_wallet = ?${paramIdx}`); params.push(usdc_wallet); paramIdx++; }
    if (donation_url_override) { updates.push(`donation_url = ?${paramIdx}`); params.push(donation_url_override); paramIdx++; }

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

  // Validate required fields
  if (!name || !email || !country) {
    return error('Missing required fields: name, email, country', 400);
  }

  // Validate email
  if (!isValidEmail(email)) {
    return error('Invalid email address', 400);
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
  const donation_url = `https://giveready.org/donate/${slug}`;
  const now = new Date().toISOString();

  // Insert nonprofit
  await db.prepare(`
    INSERT INTO nonprofits (
      id, slug, name, contact_email, country, city, mission, description, website, founded_year,
      beneficiaries_per_year, usdc_wallet, donation_url, verified, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
  `).bind(
    id, slug, name, email, country || null, city || null, mission || null, description || mission || null,
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
    `).bind(crypto.randomUUID(), id, registration_country || country, registration_type || 'nonprofit', registration_number).run();
  }

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
    admin_message: 'Your profile is pending review. You will receive an email when it goes live.',
  }, 201);
}

async function handleAdminDrafts(db, env, request) {
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

async function handleAdminApprove(db, env, request, slug) {
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

  return json({
    success: true,
    slug,
    donate_url: `https://giveready.org/donate/${slug}`,
  });
}

async function handleAdminReject(db, env, request, slug) {
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

  // Delete related records
  await db.prepare(
    `DELETE FROM nonprofit_causes WHERE nonprofit_id = ?1`
  ).bind(id).run();

  await db.prepare(
    `DELETE FROM registrations WHERE nonprofit_id = ?1`
  ).bind(id).run();

  await db.prepare(
    `DELETE FROM nonprofits WHERE id = ?1`
  ).bind(id).run();

  return json({
    success: true,
    slug,
    deleted: true,
  });
}

async function handleVerifyRegistration(db, env, url) {
  const number = url.searchParams.get('number');
  const country = url.searchParams.get('country') || 'UK';

  if (!number) {
    return error('Missing registration number', 400);
  }

  if (country === 'UK') {
    try {
      // Try the free API endpoint
      const apiUrl = `https://api.charitycommission.gov.uk/register/api/SearchCharitiesByRegisteredCharityNumber/${encodeURIComponent(number)}/0`;
      const response = await fetch(apiUrl);

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const charity = data[0];
          return json({
            found: true,
            country: 'UK',
            name: charity.CharityName,
            status: charity.CharityStatus,
            registration_number: charity.RegisteredCharityNumber,
          });
        }
      }
    } catch (err) {
      console.error('Charity Commission API error:', err);
    }

    return json({
      found: false,
      country: 'UK',
      number,
    });
  }

  // For other countries
  return json({
    supported: false,
    country,
  });
}

// Helper: modify handleGetNonprofit to support preview mode
async function handleGetNonprofit(db, slug, allowPreview = false) {
  const nonprofit = await db.prepare(`SELECT * FROM nonprofits WHERE slug = ?1`).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  // Get causes
  const causes = await db.prepare(`
    SELECT c.id, c.name, c.description
    FROM causes c
    JOIN nonprofit_causes nc ON c.id = nc.cause_id
    WHERE nc.nonprofit_id = ?1
  `).bind(nonprofit.id).all();

  // Get programs
  const programs = await db.prepare(
    `SELECT name, description, beneficiaries_per_year, location FROM programs WHERE nonprofit_id = ?1`
  ).bind(nonprofit.id).all();

  // Get impact metrics
  const impact = await db.prepare(
    `SELECT name, value, unit, period, year FROM impact_metrics WHERE nonprofit_id = ?1 ORDER BY year DESC`
  ).bind(nonprofit.id).all();

  // Get registrations
  const registrations = await db.prepare(
    `SELECT country, type, registration_number FROM registrations WHERE nonprofit_id = ?1`
  ).bind(nonprofit.id).all();

  // Fingerprint: which agents have contributed applied enrichments to this profile.
  // Public credit for agents that pushed the profile forward.
  const enrichedBy = await db.prepare(
    `SELECT agent_name, field, reviewed_at
     FROM agent_enrichments
     WHERE nonprofit_id = ?1 AND status = 'applied'
     ORDER BY reviewed_at DESC LIMIT 20`
  ).bind(nonprofit.id).all();

  return json({
    ...nonprofit,
    causes: causes.results,
    programs: programs.results,
    impact_metrics: impact.results,
    registrations: registrations.results,
    enriched_by: enrichedBy.results,
  });
}

// ============================================
// AGENT ENRICHMENT — Lite version
// Agents discover thin profiles, submit data, consensus builds trust
// ============================================

const ENRICHABLE_FIELDS = new Set([
  'mission', 'description', 'tagline', 'website', 'city', 'region',
  'founded_year', 'contact_email', 'programme', 'impact_metric',
]);

// Fat-skill / thin-harness split (learning from 2026-04-14 test):
// Exact-string consensus works for STRUCTURED fields where the right answer
// is a single canonical value. It fails for PROSE fields because every agent
// writes its own sentence. For now, structured auto-promotes on exact match
// after light normalisation; prose stays in the review queue awaiting a
// committee-vote endpoint (next iteration — agents judge each other).
const AUTO_PROMOTE_STRUCTURED = new Set([
  'website', 'city', 'region', 'founded_year', 'contact_email',
]);

const AUTO_PROMOTE_PROSE_PENDING = new Set([
  'mission', 'description', 'tagline',
]);

// Trusted-agent prose path REMOVED 2026-04-16 after CSO audit (finding C1).
// The previous design let whitelisted foundation model names (claude / gpt /
// gemini / anthropic) auto-apply prose on first submission when the field was
// empty. Because agent_name is self-reported in the request body and the
// match used `includes` rather than `startsWith`, an unauthenticated caller
// could impersonate a trusted model ("i-claude-poison-charities" matches
// "claude") and mass-poison mission/description/tagline across the ~40k
// directory at rate-limit ceiling (30 writes/min/IP, cyclable across isolates).
// Prose fields now stay queued for the committee-vote mechanism. See
// 01-Projects/GiveReady/CSO-Audit-2026-04-16.md for the full finding and the
// HMAC-signed path back to a trusted-agent v2.

// Light normalisation so trivial formatting differences don't block consensus.
// URLs: lowercase host + path, strip www., strip trailing slash, strip tracking
// params (utm_*, fbclid, ref) and fragment. Path is lowercased because virtually
// all web servers are case-insensitive and the old case-sensitive path was hiding
// real consensus behind false rejections (/About vs /about). See CSO-Audit
// 2026-04-23 recommendation. Year fields coerce to 4-digit integer string.
function normaliseFieldValue(field, raw) {
  if (raw == null) return '';
  let v = String(raw).trim().replace(/\s+/g, ' ');
  if (field === 'website') {
    try {
      const u = new URL(v.startsWith('http') ? v : `https://${v}`);
      u.hostname = u.hostname.toLowerCase();
      u.pathname = u.pathname.toLowerCase();
      // Strip www. prefix — www.example.org and example.org are the same site
      if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4);
      // Strip tracking params that agents pick up from different sources
      for (const key of [...u.searchParams.keys()]) {
        if (key.startsWith('utm_') || key === 'fbclid' || key === 'ref' || key === 'gclid') {
          u.searchParams.delete(key);
        }
      }
      // Strip fragment
      u.hash = '';
      let out = u.toString();
      if (out.endsWith('/') && u.pathname === '/') out = out.slice(0, -1);
      return out;
    } catch (_) { /* fall through */ }
  }
  if (field === 'contact_email') return v.toLowerCase();
  if (field === 'city' || field === 'region') return v.replace(/\s*,\s*$/, '');
  if (field === 'founded_year') {
    const m = v.match(/(\d{4})/);
    return m ? m[1] : v;
  }
  return v;
}

// Attempt to promote an enrichment to live on the nonprofit row.
// Safety rules:
//   1. Never overwrite an existing non-empty value.
//   2. Only auto-promote fields in AUTO_PROMOTE_STRUCTURED.
//   3. Require 2+ distinct agents posting the same NORMALISED value.
// Returns { promoted: bool, reason: string } so the caller can tell the
// agent what actually happened.
async function promoteIfConsensus(db, nonprofit, field) {
  if (AUTO_PROMOTE_PROSE_PENDING.has(field)) {
    return { promoted: false, reason: 'prose-pending' };
  }
  if (!AUTO_PROMOTE_STRUCTURED.has(field)) {
    return { promoted: false, reason: 'not-auto-promotable' };
  }

  const current = await db.prepare(
    `SELECT ${field} AS val FROM nonprofits WHERE id = ?1`
  ).bind(nonprofit.id).first();
  if (current && current.val !== null && String(current.val).trim() !== '') {
    return { promoted: false, reason: 'already-has-value' };
  }

  // Pull all pending values, normalise in JS, group to find a winner.
  // D1 lacks a portable normalise function, so we do the grouping here.
  const rows = await db.prepare(
    `SELECT id, value, agent_id FROM agent_enrichments
     WHERE nonprofit_id = ?1 AND field = ?2 AND status = 'pending'`
  ).bind(nonprofit.id, field).all();

  const buckets = new Map(); // normValue -> { agents:Set, rawCanonical:string }
  for (const r of (rows.results || [])) {
    const n = normaliseFieldValue(field, r.value);
    if (!n) continue;
    if (!buckets.has(n)) buckets.set(n, { agents: new Set(), raw: r.value });
    buckets.get(n).agents.add(r.agent_id || 'unknown');
  }

  let winner = null;
  for (const [norm, info] of buckets) {
    if (info.agents.size < 2) continue;
    if (!winner || info.agents.size > winner.agents) {
      winner = { norm, raw: info.raw, agents: info.agents.size };
    }
  }

  if (!winner) return { promoted: false, reason: 'no-consensus' };

  // Apply the winner's canonical raw value (first submission for that bucket).
  await db.prepare(
    `UPDATE nonprofits SET ${field} = ?1 WHERE id = ?2`
  ).bind(winner.raw, nonprofit.id).run();

  // Mark matching (by normalised value) enrichments applied, others rejected.
  // We do this in JS because SQLite can't re-run our normaliser.
  const matchingIds = [];
  const losingIds = [];
  for (const r of (rows.results || [])) {
    const n = normaliseFieldValue(field, r.value);
    (n === winner.norm ? matchingIds : losingIds).push(r.id);
  }
  if (matchingIds.length) {
    const placeholders = matchingIds.map((_, i) => `?${i + 1}`).join(',');
    await db.prepare(
      `UPDATE agent_enrichments SET status='applied', reviewed_at=datetime('now')
       WHERE id IN (${placeholders})`
    ).bind(...matchingIds).run();
  }
  if (losingIds.length) {
    // Record WHY each losing submission was rejected, and the value that won.
    // The next agent that retries this field on this nonprofit gets this
    // back in their submission response so they can self-correct.
    const rejectionReason = `Normalised value did not match the winning consensus for '${field}'. Winner had ${winner.agents} agreeing agents. Aim for the winning canonical form when retrying.`;
    const placeholders = losingIds.map((_, i) => `?${i + 3}`).join(',');
    await db.prepare(
      `UPDATE agent_enrichments
         SET status='rejected',
             reviewed_at=datetime('now'),
             rejection_reason=?1,
             winning_value=?2
       WHERE id IN (${placeholders})`
    ).bind(rejectionReason, winner.raw, ...losingIds).run();
  }

  return { promoted: true, reason: 'consensus', agents: winner.agents };
}

async function handleNeedsEnrichment(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
  const cause = url.searchParams.get('cause');
  const field = url.searchParams.get('field');

  // Fast approach: filter for genuinely thin profiles first, then rank
  let where = [`(n.description IS NULL OR n.description = '' OR n.mission IS NULL OR n.mission = '' OR n.website IS NULL OR n.website = '')`];
  const params = [];

  if (field === 'mission') where.push(`(n.mission IS NULL OR n.mission = '')`);
  else if (field === 'description') where.push(`(n.description IS NULL OR n.description = '')`);
  else if (field === 'website') where.push(`(n.website IS NULL OR n.website = '')`);
  else if (field === 'contact_email') where.push(`(n.contact_email IS NULL OR n.contact_email = '')`);

  let joinClause = '';
  if (cause) {
    joinClause = ` JOIN nonprofit_causes nc ON n.id = nc.nonprofit_id`;
    where.push(`nc.cause_id = ?${params.length + 1}`);
    params.push(cause);
  }

  params.push(limit);

  const query = `
    SELECT n.id, n.slug, n.name, n.country, n.city, n.website, n.verified,
           n.mission, n.description, n.founded_year, n.contact_email
    FROM nonprofits n${joinClause}
    WHERE ${where.join(' AND ')}
    ORDER BY n.name ASC
    LIMIT ?${params.length}
  `;

  const results = await db.prepare(query).bind(...params).all();

  // For each result, list which fields need data
  const npIds = results.results.map((np) => np.id);

  // Batch-fetch pending single-agent submissions for these nonprofits.
  // These are "second-opinion needed" items: one agent submitted a value but
  // no second agent has corroborated it yet. A new agent can validate the
  // pending value (POST the same value to agree) instead of researching from
  // scratch. This is the lower-cost path to consensus.
  let pendingByNpField = new Map(); // key: `${nonprofit_id}:${field}` → { value, agent_name, submitted_at }
  if (npIds.length > 0) {
    const placeholders = npIds.map((_, i) => `?${i + 1}`).join(',');
    const pending = await db.prepare(
      `SELECT nonprofit_id, field, value, agent_name, created_at
         FROM agent_enrichments
        WHERE nonprofit_id IN (${placeholders})
          AND status = 'pending'
        ORDER BY created_at DESC`
    ).bind(...npIds).all();

    // Group by nonprofit+field, keep only fields with exactly 1 distinct agent_id
    // (true single-agent pending). If 2+ agents already submitted, consensus logic
    // handles it — we don't need to surface those here.
    const grouped = new Map();
    for (const r of (pending.results || [])) {
      const key = `${r.nonprofit_id}:${r.field}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }
    for (const [key, rows] of grouped) {
      const distinctAgents = new Set(rows.map((r) => r.agent_name));
      if (distinctAgents.size === 1) {
        const r = rows[0];
        pendingByNpField.set(key, {
          value: r.field === 'mission' || r.field === 'description' || r.field === 'tagline'
            ? r.value.substring(0, 120) + (r.value.length > 120 ? '...' : '')
            : r.value,
          agent_name: r.agent_name,
          submitted_at: r.created_at,
          submissions: rows.length,
        });
      }
    }
  }

  const enrichable = results.results.map(np => {
    const needs = [];
    if (!np.description || np.description === np.mission) needs.push('description');
    if (!np.website) needs.push('website');
    if (!np.city) needs.push('city', 'region');
    if (!np.mission) needs.push('mission');
    if (!np.founded_year) needs.push('founded_year');
    if (!np.contact_email) needs.push('contact_email');

    // Attach pending second-opinion items per field
    const secondOpinion = [];
    for (const f of needs) {
      const pending = pendingByNpField.get(`${np.id}:${f}`);
      if (pending) {
        secondOpinion.push({
          field: f,
          pending_value: pending.value,
          submitted_by: pending.agent_name,
          submitted_at: pending.submitted_at,
          action: `To corroborate: POST the same value to /api/enrich/${np.slug}. To disagree: POST a different value. Either way, you move this field closer to resolution.`,
        });
      }
    }

    return {
      slug: np.slug,
      name: np.name,
      country: np.country,
      needs_fields: needs,
      second_opinion_needed: secondOpinion.length > 0 ? secondOpinion : undefined,
      current_data: {
        mission: np.mission ? np.mission.substring(0, 100) + '...' : null,
        website: np.website,
        city: np.city,
      },
      enrich_url: `POST https://giveready.org/api/enrich/${np.slug}`,
    };
  });

  const totalEnrichments = await db.prepare(
    `SELECT COUNT(*) as count FROM agent_enrichments`
  ).first();

  // Count only actionable second-opinion items (ones that actually appear in responses)
  const pendingCount = enrichable.reduce((n, np) =>
    n + (np.second_opinion_needed ? np.second_opinion_needed.length : 0), 0);

  return json({
    message: 'These nonprofit profiles need enrichment. Submit data via POST /api/enrich/{slug}.',
    hint: pendingCount > 0
      ? `${pendingCount} field(s) below have a pending submission from one agent and need a second opinion. Corroborating an existing value (POST the same value) is faster than researching from scratch.`
      : undefined,
    total_enrichments_received: totalEnrichments.count,
    second_opinions_available: pendingCount,
    nonprofits: enrichable,
  });
}

async function handleEnrich(db, request, slug) {
  // Look up the nonprofit
  const nonprofit = await db.prepare(
    `SELECT id, slug, name FROM nonprofits WHERE slug = ?1`
  ).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  // Parse the submission
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return error('Invalid JSON body', 400);
  }

  const agentId = body.agent_id || request.headers.get('User-Agent') || 'unknown';
  const agentName = body.agent_name || agentId.substring(0, 100);
  const submissions = [];

  // Accept either a single field or multiple fields
  const fields = body.fields || [];
  if (body.field && body.value) {
    fields.push({ field: body.field, value: body.value, source_url: body.source_url });
  }

  if (fields.length === 0) {
    return error('No enrichment data provided. Send { "fields": [{ "field": "description", "value": "...", "source_url": "..." }] }', 400);
  }

  for (const f of fields) {
    if (!f.field || !f.value) continue;
    if (!ENRICHABLE_FIELDS.has(f.field)) continue;

    const id = crypto.randomUUID();

    // Check for consensus: has another agent already submitted similar data for this field?
    const existing = await db.prepare(
      `SELECT COUNT(*) as count FROM agent_enrichments
       WHERE nonprofit_id = ?1 AND field = ?2 AND agent_id != ?3 AND status = 'pending'`
    ).bind(nonprofit.id, f.field, agentId).first();

    const confidence = existing.count > 0 ? existing.count + 1 : 1;

    // Fetch prior rejections for THIS (nonprofit, field). If any exist,
    // surface them in the response so the agent learns why its last
    // attempt (or a peer's) lost. This is the self-learning feedback loop.
    const priorRejectedRows = await db.prepare(
      `SELECT agent_name, value, rejection_reason, winning_value, reviewed_at
         FROM agent_enrichments
        WHERE nonprofit_id = ?1 AND field = ?2 AND status = 'rejected'
        ORDER BY reviewed_at DESC
        LIMIT 5`
    ).bind(nonprofit.id, f.field).all();
    const priorRejections = (priorRejectedRows.results || []).map((r) => ({
      agent: r.agent_name,
      rejected_value: r.value,
      reason: r.rejection_reason || 'No reason recorded.',
      winning_value: r.winning_value || null,
      rejected_at: r.reviewed_at,
    }));

    await db.prepare(
      `INSERT INTO agent_enrichments (id, nonprofit_id, nonprofit_slug, field, value, source_url, agent_id, agent_name, confidence)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(id, nonprofit.id, slug, f.field, f.value.substring(0, 5000), f.source_url || null, agentId, agentName, confidence).run();

    // If confidence >= 2 (2+ agents agree), update the confidence score on all matching submissions
    if (confidence >= 2) {
      await db.prepare(
        `UPDATE agent_enrichments SET confidence = ?1 WHERE nonprofit_id = ?2 AND field = ?3 AND status = 'pending'`
      ).bind(confidence, nonprofit.id, f.field).run();
    }

    // Close the loop: if this submission pushes a field to consensus AND
    // the nonprofit's current value is empty, promote it live right now.
    // Structured fields (website, city, founded_year, etc.) auto-promote on
    // normalised exact match.
    let promoResult = { promoted: false, reason: 'not-attempted' };
    if (confidence >= 2) {
      promoResult = await promoteIfConsensus(db, nonprofit, f.field);
    }

    // Prose fields (mission, description, tagline) DO NOT auto-promote.
    // Consensus on prose doesn't converge across models (every agent writes
    // its own sentence) and the prior trusted-agent shortcut was removed
    // 2026-04-16 after CSO audit — agent_name is self-reported, so any
    // unauthenticated caller could impersonate a trusted model and poison
    // empty fields at scale. Prose stays queued for committee review.
    const isProse = AUTO_PROMOTE_PROSE_PENDING.has(f.field);

    const applied = promoResult.promoted;
    submissions.push({
      field: f.field,
      field_type: isProse ? 'prose' : (AUTO_PROMOTE_STRUCTURED.has(f.field) ? 'structured' : 'other'),
      status: applied ? 'applied' : 'pending',
      confidence,
      consensus: confidence >= 2 ? 'high — multiple agents agree' : 'single agent — awaiting corroboration',
      applied,
      promotion_note: promoResult.promoted
        ? `Promoted live — ${promoResult.agents} agents agreed on the same value after normalisation.`
        : isProse
          ? 'Prose fields do not auto-promote. Submission queued for committee review.'
          : confidence >= 2
            ? 'Consensus count reached but no two normalised values match yet.'
            : 'Awaiting a second agent to corroborate the same value.',
      prior_rejections: priorRejections,
      profile_url: applied ? `https://giveready.org/api/nonprofits/${slug}` : undefined,
    });
  }

  const hasConsensus = submissions.some(s => s.confidence >= 2);
  const anyApplied = submissions.some(s => s.applied);
  const anyProse = submissions.some(s => s.field_type === 'prose');
  return json({
    message: anyApplied
      ? `Consensus reached. ${submissions.filter(s => s.applied).length} field(s) promoted live on ${nonprofit.name}.`
      : `Thank you. ${submissions.length} enrichment(s) submitted for ${nonprofit.name}.`,
    nonprofit: nonprofit.slug,
    submissions,
    note: anyApplied
      ? 'Your enrichment is live. Your agent name is credited at https://giveready.org/agents.'
      : anyProse
        ? 'Prose fields (mission, description, tagline) queue for committee review — no two agents write identical prose. Structured fields (website, city, region, founded_year, contact_email) auto-promote when two agents agree on the normalised value.'
        : hasConsensus
          ? 'Multiple agents have submitted for this field, but no two normalised values match yet. Try submitting a more canonical form.'
          : 'Your submission will be reviewed. If another agent independently submits matching data, it promotes automatically.',
    auto_promote: {
      structured: Array.from(AUTO_PROMOTE_STRUCTURED),
      prose_pending: Array.from(AUTO_PROMOTE_PROSE_PENDING),
    },
    leaderboard: 'https://giveready.org/agents',
  }, 201);
}

async function handleAdminTraffic(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const hours = parseInt(url.searchParams.get('hours') || '24');
  const since = `datetime('now', '-${hours} hours')`;
  const includeNoise = url.searchParams.get('include_noise') === 'true';
  const useBlocklist = env.AGENT_FILTER_MODE === 'blocklist';

  // Build SQL fragment for agent filtering.
  // Allowlist mode (default): only include rows matching known agent patterns.
  // Blocklist mode (legacy): exclude rows matching known noise prefixes.
  let noiseFilter = '';
  let noiseConds;
  let allowConds;
  if (useBlocklist) {
    noiseConds = AGENT_NOISE_PREFIXES
      .map((p) => `user_agent LIKE '${p.replace(/'/g, "''")}%'`)
      .join(' OR ');
    noiseFilter = includeNoise ? '' : ` AND NOT (${noiseConds})`;
  } else {
    allowConds = KNOWN_AGENT_PATTERNS
      .map((entry) => `user_agent LIKE '%${entry.pattern.replace(/'/g, "''")}%'`)
      .join(' OR ');
    noiseConds = allowConds; // used by noise breakdown query (inverted)
    noiseFilter = includeNoise ? '' : ` AND (${allowConds})`;
  }

  // Discovery hits by route (llms.txt, agents.md, mcp, etc.)
  const discoveryByRoute = await db.prepare(
    `SELECT route, COUNT(*) as hits FROM discovery_hits
     WHERE created_at > ${since}${noiseFilter}
     GROUP BY route ORDER BY hits DESC`
  ).all();

  // Discovery hits by user-agent (identify actual agents)
  const discoveryByAgent = await db.prepare(
    `SELECT user_agent, COUNT(*) as hits FROM discovery_hits
     WHERE created_at > ${since} AND user_agent IS NOT NULL${noiseFilter}
     GROUP BY user_agent ORDER BY hits DESC LIMIT 30`
  ).all();

  // Recent discovery hits (last 20) — always filtered view so the digest
  // doesn't get flooded with Bun pollers in the recent list either.
  const recentDiscovery = await db.prepare(
    `SELECT route, user_agent, created_at FROM discovery_hits
     WHERE 1=1${noiseFilter}
     ORDER BY created_at DESC LIMIT 20`
  ).all();

  // API query log — what are people/agents searching for?
  // Excludes seeded demo rows (is_demo=1) so the digest sees real traffic only.
  // See migration 012-query-log-is-demo.sql.
  const recentQueries = await db.prepare(
    `SELECT query_text, source, results_count, created_at FROM query_log
     WHERE COALESCE(is_demo, 0) = 0
     ORDER BY created_at DESC LIMIT 30`
  ).all();

  // Query volume by day — also real traffic only.
  const queryByDay = await db.prepare(
    `SELECT DATE(created_at) as day, COUNT(*) as queries FROM query_log
     WHERE COALESCE(is_demo, 0) = 0
     GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 7`
  ).all();

  // Total discovery hits (raw, lifetime)
  const totalDiscovery = await db.prepare(
    `SELECT COUNT(*) as total FROM discovery_hits`
  ).first();

  // Period totals: raw and filtered so we can show both.
  const totalDiscoveryRecentRaw = await db.prepare(
    `SELECT COUNT(*) as total FROM discovery_hits WHERE created_at > ${since}`
  ).first();

  // Agents-only count and noise breakdown, inverted per filter mode.
  const agentsOnlyFilter = useBlocklist
    ? `AND NOT (${noiseConds})`
    : `AND (${allowConds})`;
  const noiseOnlyFilter = useBlocklist
    ? `AND (${noiseConds})`
    : `AND NOT (${allowConds})`;

  const totalDiscoveryRecentFiltered = await db.prepare(
    `SELECT COUNT(*) as total FROM discovery_hits
     WHERE created_at > ${since} ${agentsOnlyFilter}`
  ).first();

  // Top 5 filtered-out noise UAs in the period, so we can still see what
  // infrastructure is polling us without it dominating the main numbers.
  const noiseBreakdown = await db.prepare(
    `SELECT user_agent, COUNT(*) as hits FROM discovery_hits
     WHERE created_at > ${since} ${noiseOnlyFilter}
     GROUP BY user_agent ORDER BY hits DESC LIMIT 5`
  ).all();

  // Enrichment activity
  const enrichmentRecent = await db.prepare(
    `SELECT COUNT(*) as total FROM agent_enrichments WHERE created_at > ${since}`
  ).first();

  return json({
    period: `last ${hours} hours`,
    noise_filtered: !includeNoise,
    filter_mode: useBlocklist ? 'blocklist' : 'allowlist',
    known_agents: useBlocklist ? undefined : KNOWN_AGENT_PATTERNS.map((e) => e.name),
    noise_prefixes: useBlocklist ? AGENT_NOISE_PREFIXES : undefined,
    summary: {
      total_discovery_hits: totalDiscovery.total,
      discovery_hits_in_period: includeNoise
        ? totalDiscoveryRecentRaw.total
        : totalDiscoveryRecentFiltered.total,
      discovery_hits_in_period_raw: totalDiscoveryRecentRaw.total,
      discovery_hits_in_period_agents_only: totalDiscoveryRecentFiltered.total,
      enrichments_in_period: enrichmentRecent.total,
    },
    discovery_by_route: discoveryByRoute.results,
    discovery_by_user_agent: discoveryByAgent.results,
    noise_breakdown: noiseBreakdown.results,
    recent_discovery_hits: recentDiscovery.results,
    recent_queries: recentQueries.results,
    queries_by_day: queryByDay.results,
  });
}

async function handleEnrichmentStats(db) {
  const total = await db.prepare(
    `SELECT COUNT(*) as count FROM agent_enrichments`
  ).first();

  const byStatus = await db.prepare(
    `SELECT status, COUNT(*) as count FROM agent_enrichments GROUP BY status`
  ).all();

  const byField = await db.prepare(
    `SELECT field, COUNT(*) as count FROM agent_enrichments GROUP BY field ORDER BY count DESC`
  ).all();

  const uniqueAgents = await db.prepare(
    `SELECT COUNT(DISTINCT agent_id) as count FROM agent_enrichments`
  ).first();

  const highConfidence = await db.prepare(
    `SELECT COUNT(*) as count FROM agent_enrichments WHERE confidence >= 2`
  ).first();

  const recentSubmissions = await db.prepare(
    `SELECT ae.nonprofit_slug, ae.field, ae.agent_name, ae.confidence, ae.created_at
     FROM agent_enrichments ae
     ORDER BY ae.created_at DESC LIMIT 10`
  ).all();

  return json({
    total_enrichments: total.count,
    unique_agents: uniqueAgents.count,
    high_confidence: highConfidence.count,
    by_status: byStatus.results,
    by_field: byField.results,
    recent: recentSubmissions.results,
  });
}

// ============================================
// AGENT LEADERBOARD — public surface
// ============================================

async function handleAgentLeaderboard(db) {
  const agents = await db.prepare(
    `SELECT agent_name,
            COUNT(*) AS submissions,
            SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS applied,
            COUNT(DISTINCT nonprofit_id) AS nonprofits_touched,
            MAX(created_at) AS last_seen
     FROM agent_enrichments
     WHERE agent_name IS NOT NULL AND agent_name <> ''
     GROUP BY agent_name
     ORDER BY applied DESC, submissions DESC, last_seen DESC
     LIMIT 50`
  ).all();

  const recent = await db.prepare(
    `SELECT agent_name, nonprofit_slug, field, status, created_at
     FROM agent_enrichments
     ORDER BY created_at DESC
     LIMIT 20`
  ).all();

  const totals = await db.prepare(
    `SELECT
       COUNT(*) AS total_submissions,
       SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS total_applied,
       COUNT(DISTINCT agent_name) AS unique_agents,
       COUNT(DISTINCT nonprofit_id) AS nonprofits_improved
     FROM agent_enrichments`
  ).first();

  return json({
    message: 'Public leaderboard of agents that have contributed enrichments. Applied = promoted live after 2+ agent consensus.',
    totals,
    top_agents: agents.results,
    recent_activity: recent.results,
  });
}

// ============================================
// SELF-LEARNING ENDPOINTS (2026-04-16)
// exemplars / funnel / named-first-seen
// ============================================

// Agent filter: allowlist of known AI agents and crawlers we want to track.
// Inverted from the old prefix-based blocklist after CSO audit finding H2:
// the old startsWith('Bun/') approach was trivially spoofed by prepending
// 'Mozilla' or any non-matching string to a noise UA. An attacker could also
// impersonate a real agent by using its prefix. The allowlist uses substring
// matching against verified crawler identifiers.
//
// Feature flag: set AGENT_FILTER_MODE=blocklist in env to revert to old behavior.
// Default: allowlist (new, secure).
const KNOWN_AGENT_PATTERNS = [
  // AI model crawlers (the agents we built GiveReady for)
  { pattern: 'ClaudeBot', name: 'Anthropic Claude' },
  { pattern: 'Claude-SearchBot', name: 'Anthropic Claude Search' },
  { pattern: 'GPTBot', name: 'OpenAI GPT' },
  { pattern: 'ChatGPT-User', name: 'OpenAI ChatGPT' },
  { pattern: 'Google-Extended', name: 'Google AI' },
  { pattern: 'PerplexityBot', name: 'Perplexity' },
  { pattern: 'cohere-ai', name: 'Cohere' },
  // Search engine crawlers (they read /llms.txt, /agents.md, /mcp too)
  { pattern: 'Googlebot', name: 'Google Search' },
  { pattern: 'bingbot', name: 'Microsoft Bing' },
  { pattern: 'Applebot', name: 'Apple' },
  { pattern: 'DuckDuckBot', name: 'DuckDuckGo' },
  { pattern: 'YandexBot', name: 'Yandex' },
  { pattern: 'Amzn-SearchBot', name: 'Amazon Search' },
  { pattern: 'SemrushBot', name: 'SEMrush' },
  // MCP ecosystem crawlers
  { pattern: 'MCPRegistry', name: 'MCP Registry' },
  { pattern: 'Smithery', name: 'Smithery' },
  { pattern: 'PulseMCP', name: 'PulseMCP' },
  { pattern: 'GlamaMCP', name: 'Glama MCP' },
];

// Legacy blocklist kept for feature flag rollback (AGENT_FILTER_MODE=blocklist).
const AGENT_NOISE_PREFIXES = [
  'Bun/', 'curl/', 'wget/', 'Go-http-client', 'Python-requests',
  'python-httpx', 'python-urllib', 'node-fetch', 'axios/', 'okhttp/',
  'libwww-perl', 'Apache-HttpClient', 'Java/', 'Ruby', 'PostmanRuntime',
];

function isKnownAgent(ua) {
  if (!ua) return false;
  return KNOWN_AGENT_PATTERNS.some((entry) => ua.includes(entry.pattern));
}

function isNoiseAgent(ua, env) {
  // Feature flag: AGENT_FILTER_MODE=blocklist reverts to old prefix-based filter
  if (env && env.AGENT_FILTER_MODE === 'blocklist') {
    if (!ua) return true;
    return AGENT_NOISE_PREFIXES.some((p) => ua.startsWith(p));
  }
  // Default (allowlist): anything not a known agent is noise
  return !isKnownAgent(ua);
}

// /api/agents/exemplars — returns recently applied submissions as templates.
// Agents that read this BEFORE submitting converge on the shape that worked.
// This is the reinforcement half of the self-learning loop.
async function handleAgentExemplars(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
  const field = url.searchParams.get('field');

  const where = field ? `WHERE status = 'applied' AND field = ?1` : `WHERE status = 'applied'`;
  const binds = field ? [field] : [];

  const rows = await db.prepare(
    `SELECT ae.nonprofit_slug, ae.field, ae.value, ae.agent_name, ae.source_url, ae.reviewed_at
       FROM agent_enrichments ae
       ${where}
       ORDER BY ae.reviewed_at DESC
       LIMIT ${limit}`
  ).bind(...binds).all();

  return json({
    message: 'Recent applied enrichments, exposed as templates. Match the shape of these values when submitting to POST /api/enrich/{slug} and your chance of applied status goes up.',
    hint: 'Filter by ?field=website (or city, region, founded_year, contact_email, mission, description, tagline).',
    count: (rows.results || []).length,
    exemplars: rows.results,
  });
}

// /api/agents/funnel — named crawlers that hit a discovery route but
// did not submit an enrichment in the following window. This is the
// read-and-leave gap the daily digest cares about. Excludes noise.
async function handleAgentFunnel(db, url, env) {
  const hours = parseInt(url.searchParams.get('hours') || '168', 10) || 168;
  const since = `datetime('now', '-${hours} hours')`;

  // All discovery hits from NOT-noise user-agents in the period.
  const hits = await db.prepare(
    `SELECT user_agent, route, MIN(created_at) AS first_hit, MAX(created_at) AS last_hit, COUNT(*) AS hits
       FROM discovery_hits
      WHERE created_at > ${since}
        AND user_agent IS NOT NULL AND user_agent <> ''
      GROUP BY user_agent, route
      ORDER BY last_hit DESC`
  ).all();

  // Submissions in the same window, keyed by user_agent (agent_id is the UA).
  const submissions = await db.prepare(
    `SELECT agent_id, agent_name, COUNT(*) AS submitted
       FROM agent_enrichments
      WHERE created_at > ${since}
      GROUP BY agent_id, agent_name`
  ).all();
  const submittedByAgent = new Set((submissions.results || []).map((s) => s.agent_id));

  const rows = (hits.results || []).filter((h) => !isNoiseAgent(h.user_agent, env));
  const readAndLeft = rows.filter((h) => !submittedByAgent.has(h.user_agent));
  const readAndSubmitted = rows.filter((h) => submittedByAgent.has(h.user_agent));

  const useBlocklist = env && env.AGENT_FILTER_MODE === 'blocklist';
  return json({
    message: `Named crawlers in the last ${hours}h — who read a discovery route and never submitted.`,
    window_hours: hours,
    filter_mode: useBlocklist ? 'blocklist' : 'allowlist',
    read_and_left: readAndLeft,
    read_and_submitted: readAndSubmitted,
    noise_excluded: useBlocklist ? AGENT_NOISE_PREFIXES : KNOWN_AGENT_PATTERNS.map((e) => e.name),
  });
}

// /api/agents/named-first-seen — new NAMED user-agents seen in the period
// that weren't seen before. Cuts through Bun/curl noise. This is the
// "what actually changed today" signal.
async function handleAgentNamedFirstSeen(db, url, env) {
  const hours = parseInt(url.searchParams.get('hours') || '24', 10) || 24;
  const since = `datetime('now', '-${hours} hours')`;

  // All distinct user-agents seen in the window.
  const recent = await db.prepare(
    `SELECT user_agent, MIN(created_at) AS first_hit_in_window, COUNT(*) AS hits
       FROM discovery_hits
      WHERE created_at > ${since}
        AND user_agent IS NOT NULL AND user_agent <> ''
      GROUP BY user_agent`
  ).all();

  // For each, find its lifetime first_hit.
  const out = [];
  for (const r of (recent.results || [])) {
    if (isNoiseAgent(r.user_agent, env)) continue;
    const lifetime = await db.prepare(
      `SELECT MIN(created_at) AS lifetime_first FROM discovery_hits WHERE user_agent = ?1`
    ).bind(r.user_agent).first();
    const isNew = lifetime.lifetime_first >= r.first_hit_in_window;
    out.push({
      user_agent: r.user_agent,
      hits_in_window: r.hits,
      first_seen_lifetime: lifetime.lifetime_first,
      first_hit_in_window: r.first_hit_in_window,
      is_new: isNew,
    });
  }
  out.sort((a, b) => (b.is_new - a.is_new) || (b.hits_in_window - a.hits_in_window));

  const useBlocklist = env && env.AGENT_FILTER_MODE === 'blocklist';
  return json({
    message: `Named agents in the last ${hours}h — ${useBlocklist ? 'noise prefixes' : 'non-allowlisted UAs'} filtered out.`,
    window_hours: hours,
    filter_mode: useBlocklist ? 'blocklist' : 'allowlist',
    agents: out,
    first_time_named_crawlers: out.filter((a) => a.is_new),
  });
}

function handleAgentLeaderboardHTML() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agent Leaderboard — GiveReady</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Public leaderboard of AI agents that have enriched the GiveReady nonprofit directory.">
<style>
  :root { --bg:#0b0d12; --panel:#121620; --ink:#e8eaf0; --muted:#8a91a3; --accent:#4ade80; --rule:#1f2530; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 48px 24px 80px; }
  h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: -0.01em; }
  p.lede { color: var(--muted); margin: 0 0 32px; max-width: 640px; }
  .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 0 0 32px; }
  .card { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 16px; }
  .num { font-size: 22px; font-weight: 600; }
  .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  section { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 20px; margin: 0 0 20px; }
  h2 { font-size: 16px; margin: 0 0 16px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--rule); }
  th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: 0; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill-applied { background: rgba(74,222,128,0.14); color: var(--accent); }
  .pill-pending { background: rgba(138,145,163,0.16); color: var(--muted); }
  .pill-rejected { background: rgba(239,68,68,0.14); color: #f87171; }
  footer { color: var(--muted); font-size: 12px; margin-top: 32px; }
  @media (max-width: 640px) { .totals { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Agent Leaderboard</h1>
  <p class="lede">AI agents that have enriched the GiveReady nonprofit directory. When two or more agents independently submit the same value for an empty field, it promotes live and the agents get credit here.</p>
  <div id="totals" class="totals"></div>
  <section>
    <h2>Top Agents</h2>
    <table id="agents"><thead><tr><th>Agent</th><th>Applied</th><th>Submissions</th><th>Nonprofits</th><th>Last Seen</th></tr></thead><tbody></tbody></table>
  </section>
  <section>
    <h2>Recent Activity</h2>
    <table id="recent"><thead><tr><th>Agent</th><th>Nonprofit</th><th>Field</th><th>Status</th><th>When</th></tr></thead><tbody></tbody></table>
  </section>
  <footer>
    Data via <a href="/api/agents/leaderboard">/api/agents/leaderboard</a>. Contribute via
    <a href="/agents.md">agents.md</a>. Rules: 2+ agents agreeing on the same value for an empty field auto-promotes live. Existing values are never overwritten.
  </footer>
</div>
<script>
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
  function fmt(n){return (n==null?0:n).toLocaleString();}
  function ago(iso){ if(!iso) return ''; const t=new Date(iso.replace(' ','T')+'Z').getTime(); const d=Math.max(1, Math.floor((Date.now()-t)/1000)); if(d<60) return d+'s ago'; if(d<3600) return Math.floor(d/60)+'m ago'; if(d<86400) return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago'; }
  function pill(status){ const c = status==='applied'?'pill-applied':status==='rejected'?'pill-rejected':'pill-pending'; return '<span class="pill '+c+'">'+esc(status)+'</span>'; }
  fetch('/api/agents/leaderboard').then(r=>r.json()).then(d=>{
    const t = d.totals || {};
    document.getElementById('totals').innerHTML = [
      ['Applied','total_applied'], ['Submissions','total_submissions'], ['Agents','unique_agents'], ['Nonprofits','nonprofits_improved']
    ].map(([label,key])=>'<div class="card"><div class="num">'+fmt(t[key])+'</div><div class="label">'+label+'</div></div>').join('');
    const aBody = document.querySelector('#agents tbody');
    aBody.innerHTML = (d.top_agents||[]).map(a=>'<tr><td>'+esc(a.agent_name)+'</td><td>'+fmt(a.applied)+'</td><td>'+fmt(a.submissions)+'</td><td>'+fmt(a.nonprofits_touched)+'</td><td>'+ago(a.last_seen)+'</td></tr>').join('') || '<tr><td colspan="5">No agents yet. Be the first: POST /api/enrich/{slug}</td></tr>';
    const rBody = document.querySelector('#recent tbody');
    rBody.innerHTML = (d.recent_activity||[]).map(r=>'<tr><td>'+esc(r.agent_name)+'</td><td><a href="/api/nonprofits/'+esc(r.nonprofit_slug)+'">'+esc(r.nonprofit_slug)+'</a></td><td>'+esc(r.field)+'</td><td>'+pill(r.status)+'</td><td>'+ago(r.created_at)+'</td></tr>').join('') || '<tr><td colspan="5">No activity yet.</td></tr>';
  });
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS } });
}

// ============================================
// CHARITY DASHBOARD: AUTH + PROFILE + QUERIES
// Migration: 011-charity-dashboard.sql
// Reviewed: /plan-eng-review 2026-04-20
// ============================================

// ---- helpers ----

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function apiError(code, message, status = 400, details) {
  return json({ error: { code, message, details: details || {} } }, status);
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const re = new RegExp('(?:^|; )' + name + '=([^;]*)');
  const m = header.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

// Per-email rate limit for /api/auth/request. D1-backed count of magic_link_tokens
// created in the last hour for this email. Eventually consistent but sufficient
// for the real abuse case at this scale. DO upgrade tracked as follow-up.
async function isAuthEmailRateLimited(db, email) {
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
        Click the button below to sign in to your GiveReady dashboard. The link is valid for 15 minutes and can only be used once.
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

async function handleAuthRequest(db, env, ctx, request) {
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

  // Generate token, store hash, expire in 15 min
  const token = randomHex(16);              // 128-bit
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const ua = request.headers.get('user-agent') || null;

  await db.prepare(
    `INSERT INTO magic_link_tokens (token_hash, email, expires_at, ip_address, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(tokenHash, email, expiresAt, ip, ua).run();

  // Fire email asynchronously so the client navigates to /check-email immediately
  ctx.waitUntil(sendLoginMagicLink(email, token, env));

  console.log(`[Auth] Magic link requested: ${email}`);

  // 204 tells the client "accepted, go show the check-email page"
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleAuthVerify(db, env, request, url) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const token = url.searchParams.get('token');
  if (!token) {
    console.log(`[Auth.reject] verify missing-token ip=${ip}`);
    return apiError('TOKEN_INVALID', 'Sign-in link is not valid. Request a new one.', 410);
  }

  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT token_hash, email, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ?1`
  ).bind(tokenHash).first();

  // CSO M2 (2026-04-20): collapse missing/used/expired into single TOKEN_INVALID response
  // to prevent token-existence information disclosure. Log the distinction server-side.
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    const reason = !row ? 'missing' : row.used_at ? 'used' : 'expired';
    console.log(`[Auth.reject] verify ${reason} ip=${ip}${row ? ` email=${row.email}` : ''}`);
    return apiError('TOKEN_INVALID', 'Sign-in link is not valid. Request a new one.', 410);
  }

  // Mark used before creating session (prevents double-use race)
  await db.prepare(
    `UPDATE magic_link_tokens SET used_at = datetime('now') WHERE token_hash = ?1`
  ).bind(tokenHash).run();

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
    // Valid email, no access. Point them at claim-request.
    return new Response(verifyResultHTML(
      'No dashboard access yet',
      `This email is verified, but no GiveReady charity is linked to it yet. ` +
      `<a href="/dashboard/claim-request?email=${encodeURIComponent(row.email)}">Request access to a charity &rarr;</a>`,
      false
    ), { status: 403, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  // Create session. 256-bit token, 30-day expiry (convenience over strict 24h).
  // Revocable via revoked_at. Rotates on each /verify.
  const sessionToken = randomHex(32);
  const sessionHash = await sha256Hex(sessionToken);
  const SESSION_TTL_DAYS = 30;
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const ua = request.headers.get('user-agent') || null;
  const first = list[0];

  await db.prepare(`
    INSERT INTO charity_sessions (token_hash, charity_user_id, active_nonprofit_id, expires_at, last_seen_at, ip_address, user_agent)
    VALUES (?1, ?2, ?3, ?4, datetime('now'), ?5, ?6)
  `).bind(sessionHash, first.user_id, first.nonprofit_id, sessionExpiresAt, ip, ua).run();

  const cookie = `gr_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`;
  const redirect = list.length > 1 ? '/dashboard/pick-charity' : '/dashboard';

  console.log(`[Auth] Sign-in success: ${row.email} (${list.length} charity binding(s))`);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirect,
      'Set-Cookie': cookie,
      ...CORS_HEADERS,
    },
  });
}

async function handleAuthLogout(db, request) {
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

// ---- session middleware ----

async function requireCharitySession(db, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const path = new URL(request.url).pathname;
  const token = getCookie(request, 'gr_session');
  if (!token) {
    console.log(`[Auth.reject] session no-cookie path=${path} ip=${ip}`);
    return { error: apiError('UNAUTHORIZED', 'Sign in required', 401) };
  }
  const hash = await sha256Hex(token);
  const session = await db.prepare(`
    SELECT cs.token_hash, cs.charity_user_id, cs.active_nonprofit_id, cs.expires_at, cs.revoked_at, cu.email
    FROM charity_sessions cs
    JOIN charity_users cu ON cs.charity_user_id = cu.id
    WHERE cs.token_hash = ?1
  `).bind(hash).first();
  if (!session) {
    console.log(`[Auth.reject] session invalid path=${path} ip=${ip}`);
    return { error: apiError('UNAUTHORIZED', 'Invalid session', 401) };
  }
  if (session.revoked_at) {
    console.log(`[Auth.reject] session revoked path=${path} ip=${ip} email=${session.email}`);
    return { error: apiError('UNAUTHORIZED', 'Session revoked', 401) };
  }
  if (new Date(session.expires_at) < new Date()) {
    console.log(`[Auth.reject] session expired path=${path} ip=${ip} email=${session.email}`);
    return { error: apiError('UNAUTHORIZED', 'Session expired', 401) };
  }
  // Best-effort last_seen refresh (don't block on errors)
  db.prepare(`UPDATE charity_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?1`)
    .bind(hash).run().catch(() => {});
  return { session };
}

// ---- charity endpoints ----

async function handleCharityMe(db, request) {
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

async function handleCharitySwitch(db, request) {
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

async function handleCharityProfileGet(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  const np = await db.prepare(`SELECT * FROM nonprofits WHERE id = ?1`)
    .bind(auth.session.active_nonprofit_id).first();
  if (!np) return apiError('NOT_FOUND', 'Charity not found', 404);
  return json(np);
}

const ALLOWED_PROFILE_FIELDS = [
  'name', 'tagline', 'mission', 'description', 'website',
  'city', 'region', 'country', 'founded_year',
  'beneficiaries_per_year', 'donation_url', 'contact_email',
  'logo_url', 'annual_budget_usd', 'budget_year', 'team_size',
];

async function handleCharityProfilePatch(db, request) {
  const auth = await requireCharitySession(db, request);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return apiError('VALIDATION_FAILED', 'Invalid JSON'); }
  if (!body || typeof body !== 'object') return apiError('VALIDATION_FAILED', 'JSON object required');

  const existing = await db.prepare(`SELECT * FROM nonprofits WHERE id = ?1`)
    .bind(auth.session.active_nonprofit_id).first();
  if (!existing) return apiError('NOT_FOUND', 'Charity not found', 404);

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

  return json({ ok: true, changes: audit.length });
}

async function handleCharityQueries(db, request, url) {
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
    GROUP BY ql.query_text
    ORDER BY hits DESC, last_seen DESC
    LIMIT 50
  `).bind(auth.session.active_nonprofit_id, `-${days} days`).all();
  return json({ days, queries: rows.results || [] });
}

async function handleCharityDonations(db, request) {
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

async function handleClaimRequest(db, request) {
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
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ============================================
// ROUTER
// ============================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Allow GET, POST, PATCH (PATCH for /api/charity/profile editing)
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH') {
      return error('Method not allowed', 405);
    }

    try {
      // Routes
      if (path === '/' || path === '/api') return handleRoot();
      if (path === '/api/search') return handleSearch(env.DB, url);
      if (path === '/api/nonprofits') return handleListNonprofits(env.DB, url);
      if (path === '/api/causes') return handleListCauses(env.DB);
      if (path === '/api/stats') return handleStats(env.DB);

      // Onboard endpoint
      if (path === '/api/onboard' && request.method === 'POST') {
        const rl = checkRateLimit(request, 'write');
        if (rl) return rl;
        return handleOnboard(env.DB, request);
      }

      // Admin endpoints
      if (path === '/api/admin/traffic') {
        return handleAdminTraffic(env.DB, env, request, url);
      }
      if (path === '/api/admin/drafts') {
        return handleAdminDrafts(env.DB, env, request);
      }
      const approveMatch = path.match(/^\/api\/admin\/approve\/([a-z0-9-]+)$/);
      if (approveMatch && request.method === 'POST') {
        return handleAdminApprove(env.DB, env, request, approveMatch[1]);
      }
      const rejectMatch = path.match(/^\/api\/admin\/reject\/([a-z0-9-]+)$/);
      if (rejectMatch && request.method === 'POST') {
        return handleAdminReject(env.DB, env, request, rejectMatch[1]);
      }

      // Magic link claim endpoint
      const claimMatch = path.match(/^\/api\/claim\/([a-z0-9-]+)$/);
      if (claimMatch && request.method === 'POST') {
        const rl = checkRateLimit(request, 'write');
        if (rl) return rl;
        return handleClaim(env.DB, env, request, claimMatch[1]);
      }

      // Magic link verification (email click) — one-time claim flow
      if (path === '/verify') {
        return handleVerifyToken(env.DB, env, url);
      }

      // ============================================
      // Charity self-serve dashboard (migration 011)
      // ============================================

      // Static HTML pages for the dashboard flow — fetch from ASSETS, wrap with CSP + CORS.
      // Paths without extension (clean URLs) fall through here since not_found_handling = none.
      const DASHBOARD_PAGES = {
        '/signin': '/signin.html',
        '/check-email': '/check-email.html',
        '/dashboard': '/dashboard.html',
        '/claim': '/claim.html',
      };
      if (DASHBOARD_PAGES[path] && request.method === 'GET') {
        const assetUrl = new URL(DASHBOARD_PAGES[path], request.url).toString();
        const assetResp = await env.ASSETS.fetch(assetUrl);
        const html = await assetResp.text();
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'public, max-age=300, must-revalidate',
            ...CORS_HEADERS,
          },
        });
      }

      // Passwordless login
      if (path === '/api/auth/request' && request.method === 'POST') {
        return handleAuthRequest(env.DB, env, ctx, request);
      }
      if (path === '/api/auth/verify' && request.method === 'GET') {
        return handleAuthVerify(env.DB, env, request, url);
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        return handleAuthLogout(env.DB, request);
      }

      // Authenticated charity endpoints
      if (path === '/api/charity/me' && request.method === 'GET') {
        return handleCharityMe(env.DB, request);
      }
      if (path === '/api/charity/switch' && request.method === 'POST') {
        return handleCharitySwitch(env.DB, request);
      }
      if (path === '/api/charity/profile' && request.method === 'GET') {
        return handleCharityProfileGet(env.DB, request);
      }
      if (path === '/api/charity/profile' && request.method === 'PATCH') {
        return handleCharityProfilePatch(env.DB, request);
      }
      if (path === '/api/charity/queries' && request.method === 'GET') {
        return handleCharityQueries(env.DB, request, url);
      }
      if (path === '/api/charity/donations' && request.method === 'GET') {
        return handleCharityDonations(env.DB, request);
      }

      // Unauthenticated: request access to a charity (admin reviews)
      if (path === '/api/charity/claim-request' && request.method === 'POST') {
        return handleClaimRequest(env.DB, request);
      }

      // Admin manual verify
      const adminVerifyMatch = path.match(/^\/api\/admin\/verify\/([a-z0-9-]+)$/);
      if (adminVerifyMatch && request.method === 'POST') {
        return handleAdminVerify(env.DB, env, request, adminVerifyMatch[1]);
      }

      // Registration verification (existing charity commission check)
      if (path === '/api/verify-registration') {
        return handleVerifyRegistration(env.DB, env, url);
      }

      if (path === '/mcp' || path === '/.well-known/ai-plugin.json' || path === '/.well-known/mcp.json' || path === '/.well-known/mcp' || path === '/.well-known/mcp/server-card.json' || path === '/llms.txt' || path === '/agents.md' || path === '/AGENTS.md' || path === '/api/needs-enrichment' || path === '/api/enrichments/stats' || path === '/api/agents/leaderboard' || path === '/api/agents/exemplars' || path === '/api/agents/funnel' || path === '/api/agents/named-first-seen' || path === '/agents' || path.startsWith('/api/enrich/')) {
        const ua = request.headers.get('User-Agent');
        ctx.waitUntil(logDiscoveryHit(env.DB, path, ua));
      }
      if (path === '/mcp') return handleMCPManifest();
      if (path === '/.well-known/ai-plugin.json') return handleAIPlugin();
      // 2026 SEP-1960 manifest — served at both /.well-known/mcp.json (most-cited path)
      // and /.well-known/mcp (path used in some references) so client implementations
      // that diverge on trailing-.json land on the same payload.
      if (path === '/.well-known/mcp.json' || path === '/.well-known/mcp') return handleWellKnownMcpManifest();
      // 2026 SEP-1649 server card
      if (path === '/.well-known/mcp/server-card.json') return handleWellKnownServerCard();
      if (path === '/robots.txt') return handleRobotsTxt();
      if (path === '/llms.txt') return handleLlmsTxt();
      // Both /agents.md (lowercase, original) and /AGENTS.md (capital, 2026 root convention)
      // serve the same dynamic instruction page with bounty + 30-second wins + leaderboard.
      if (path === '/agents.md' || path === '/AGENTS.md') return handleAgentsMd(env.DB);

      // Public agent leaderboard
      if (path === '/api/agents/leaderboard') return handleAgentLeaderboard(env.DB);
      if (path === '/agents') return handleAgentLeaderboardHTML();

      // Self-learning endpoints (2026-04-16)
      if (path === '/api/agents/exemplars') return handleAgentExemplars(env.DB, url);
      if (path === '/api/agents/funnel') return handleAgentFunnel(env.DB, url, env);
      if (path === '/api/agents/named-first-seen') return handleAgentNamedFirstSeen(env.DB, url, env);

      // Agent enrichment endpoints
      if (path === '/api/needs-enrichment') return handleNeedsEnrichment(env.DB, url);
      if (path === '/api/enrichments/stats') return handleEnrichmentStats(env.DB);
      const enrichMatch = path.match(/^\/api\/enrich\/([a-z0-9-]+)$/);
      if (enrichMatch && request.method === 'POST') {
        const rl = checkRateLimit(request, 'write');
        if (rl) return rl;
        return handleEnrich(env.DB, request, enrichMatch[1]);
      }

      // x402 donate route — GET (returns 402) or POST (with X-PAYMENT settles)
      // Nonprofits without wallets get redirected to their existing donation URL
      const donateMatch = path.match(/^\/api\/donate\/([a-z0-9-]+)$/);
      if (donateMatch) {
        return handleDonate(env.DB, env, request, donateMatch[1]);
      }

      // Donation history route
      const donationHistoryMatch = path.match(/^\/api\/donations\/([a-z0-9-]+)$/);
      if (donationHistoryMatch) {
        return handleDonationHistory(env.DB, donationHistoryMatch[1]);
      }

      // Dynamic nonprofit route
      const nonprofitMatch = path.match(/^\/api\/nonprofits\/([a-z0-9-]+)$/);
      if (nonprofitMatch) {
        const allowPreview = url.searchParams.get('preview') === '1';
        return handleGetNonprofit(env.DB, nonprofitMatch[1], allowPreview);
      }

      // Donate page: /donate/{slug} → serve inline HTML (client-side JS reads the slug from URL)
      const donatePageMatch = path.match(/^\/donate\/([a-z0-9-]+)$/);
      if (donatePageMatch) {
        return new Response(DONATE_PAGE_HTML, {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      // Get started → redirect to onboard
      if (path === '/get-started') {
        return Response.redirect('https://giveready.org/onboard', 301);
      }

      // No API route matched — try serving a static asset
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
      }

      return error('Not found', 404);
    } catch (err) {
      console.error(err);
      return error('Internal server error', 500);
    }
  },
};
