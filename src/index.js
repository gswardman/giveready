/**
 * GiveReady API
 * Making small nonprofits discoverable and donatable through AI
 *
 * Cloudflare Worker + D1
 * https://giveready.org
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
// ROUTE HANDLERS
// ============================================

async function handleRoot() {
  return json({
    name: 'GiveReady',
    version: '0.1.0',
    description: 'An open directory of youth nonprofits, built for AI assistants. Search by cause, country, or keyword. Every lookup helps donors find organisations they would never have discovered otherwise.',
    documentation: 'https://giveready.org/docs',
    endpoints: {
      search: 'GET /api/search?q={query}&cause={cause}&country={country}',
      nonprofits: 'GET /api/nonprofits',
      nonprofit: 'GET /api/nonprofits/{slug}',
      causes: 'GET /api/causes',
      stats: 'GET /api/stats',
    },
    about: {
      purpose: 'GiveReady makes small nonprofits discoverable by AI systems so donors can find and support causes they care about. Lookup fees fund the Finn Wardman World Explorer Fund.',
      built_by: 'TestVentures.net',
      funded_by: 'Revenue supports the Finn Wardman World Explorer Fund (finnwardman.com)',
    },
    mcp: {
      description: 'GiveReady is available as an MCP server for AI assistants. See /mcp for the server manifest.',
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

  let query = `
    SELECT DISTINCT n.id, n.slug, n.name, n.tagline, n.mission, n.country, n.city,
           n.website, n.donation_url, n.beneficiaries_per_year, n.ghd_aligned,
           n.founded_year, n.annual_budget_usd
    FROM nonprofits n
    LEFT JOIN nonprofit_causes nc ON n.id = nc.nonprofit_id
    LEFT JOIN causes c ON nc.cause_id = c.id
    WHERE n.verified = 1
  `;
  const params = [];

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

  // Log the query for discoverability measurement
  await db.prepare(
    `INSERT INTO query_log (id, query_text, source, results_count) VALUES (?1, ?2, ?3, ?4)`
  ).bind(
    crypto.randomUUID(),
    q || `cause:${cause || '*'} country:${country || '*'}`,
    'api',
    results.results.length
  ).run();

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
    SELECT id, slug, name, tagline, country, city, website, donation_url,
           beneficiaries_per_year, founded_year, ghd_aligned
    FROM nonprofits
    WHERE verified = 1
    ORDER BY name
    LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all();

  const total = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits WHERE verified = 1`
  ).first();

  return json({
    total: total.count,
    count: results.results.length,
    nonprofits: results.results,
  });
}

async function handleGetNonprofit(db, slug) {
  const nonprofit = await db.prepare(
    `SELECT * FROM nonprofits WHERE slug = ?1 AND verified = 1`
  ).bind(slug).first();

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

  return json({
    ...nonprofit,
    causes: causes.results,
    programs: programs.results,
    impact_metrics: impact.results,
    registrations: registrations.results,
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
  const nonprofits = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits WHERE verified = 1`
  ).first();

  const countries = await db.prepare(
    `SELECT COUNT(DISTINCT country) as count FROM nonprofits WHERE verified = 1`
  ).first();

  const causes = await db.prepare(
    `SELECT COUNT(*) as count FROM causes`
  ).first();

  const totalBeneficiaries = await db.prepare(
    `SELECT SUM(beneficiaries_per_year) as total FROM nonprofits WHERE verified = 1`
  ).first();

  const queries = await db.prepare(
    `SELECT COUNT(*) as total FROM query_log`
  ).first();

  const queriesThisWeek = await db.prepare(
    `SELECT COUNT(*) as count FROM query_log WHERE created_at > datetime('now', '-7 days')`
  ).first();

  return json({
    nonprofits: nonprofits.count,
    countries: countries.count,
    causes: causes.count,
    total_beneficiaries_per_year: totalBeneficiaries.total,
    total_queries: queries.total,
    queries_this_week: queriesThisWeek.count,
  });
}

// ============================================
// MCP MANIFEST
// ============================================

async function handleMCPManifest() {
  return json({
    name: 'giveready',
    version: '0.1.0',
    description: 'Search and discover youth nonprofits. Find verified organisations by cause, country, or keyword. Get impact data, programmes, and donation links. Every query helps small nonprofits become visible to donors who would support them if they could find them.',
    tools: [
      {
        name: 'search_nonprofits',
        description: 'Search for youth nonprofits by keyword, cause area, or country. Returns verified organisations with impact data and donation links. Use this when a user wants to find charities to donate to, learn about youth programmes, or discover nonprofits working in a specific area.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keyword (e.g., "music education", "surf therapy", "adventure travel")' },
            cause: { type: 'string', description: 'Cause area ID (e.g., "youth-empowerment", "music-education", "mental-health", "adventure-travel", "surf-therapy")' },
            country: { type: 'string', description: 'Country name (e.g., "South Africa", "United Kingdom", "Bermuda")' },
            ghd_aligned: { type: 'boolean', description: 'Filter for organisations aligned with global health and development priorities (operating in low/middle-income countries)' },
          },
        },
      },
      {
        name: 'get_nonprofit',
        description: 'Get detailed information about a specific nonprofit including mission, programmes, impact metrics, registration details, and donation links. Use this when a user wants to learn more about a specific organisation before donating.',
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
        description: 'List all cause areas in the GiveReady directory with the number of nonprofits in each. Use this to help donors explore what kinds of youth organisations are available.',
        inputSchema: { type: 'object', properties: {} },
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
    description_for_human: 'Find and donate to verified youth nonprofits worldwide.',
    description_for_model: 'Search a verified directory of youth nonprofits. Returns organisations with impact data, programmes, and donation links. Use when a user asks about donating to youth causes, finding charities, or learning about nonprofits working with young people. Covers causes including music education, surf therapy, adventure travel, mental health, entrepreneurship, and community development.',
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

function handleRobotsTxt() {
  return new Response(
    `User-agent: *
Allow: /

# GiveReady - AI-readable nonprofit directory
# API documentation: https://giveready.org/docs
# MCP server manifest: https://giveready.org/mcp
# AI plugin manifest: https://giveready.org/.well-known/ai-plugin.json
`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
}

// ============================================
// ROUTER
// ============================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return error('Method not allowed', 405);
    }

    try {
      // Routes
      if (path === '/' || path === '/api') return handleRoot();
      if (path === '/api/search') return handleSearch(env.DB, url);
      if (path === '/api/nonprofits') return handleListNonprofits(env.DB, url);
      if (path === '/api/causes') return handleListCauses(env.DB);
      if (path === '/api/stats') return handleStats(env.DB);
      if (path === '/mcp') return handleMCPManifest();
      if (path === '/.well-known/ai-plugin.json') return handleAIPlugin();
      if (path === '/robots.txt') return handleRobotsTxt();

      // Dynamic nonprofit route
      const nonprofitMatch = path.match(/^\/api\/nonprofits\/([a-z0-9-]+)$/);
      if (nonprofitMatch) {
        return handleGetNonprofit(env.DB, nonprofitMatch[1]);
      }

      return error('Not found', 404);
    } catch (err) {
      console.error(err);
      return error('Internal server error', 500);
    }
  },
};
