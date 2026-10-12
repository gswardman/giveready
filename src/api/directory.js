/**
 * GiveReady — Public directory API: root manifest, search, nonprofit listing, cause listing.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json } from '../lib/http.js';

// ============================================
// ROUTE HANDLERS
// ============================================

export async function handleRoot() {
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
      contribute_data: 'POST /api/enrich/SLUG (replace SLUG with a real nonprofit slug)',
    },
    endpoints: {
      search: 'GET /api/search?q=QUERY&cause=CAUSE&country=COUNTRY&limit=N',
      nonprofits: 'GET /api/nonprofits?limit=N&offset=N',
      nonprofit: 'GET /api/nonprofits/SLUG (replace SLUG with a real nonprofit slug)',
      causes: 'GET /api/causes',
      stats: 'GET /api/stats',
      donate: 'GET|POST /api/donate/SLUG?amount=USDC — x402 payment (replace SLUG and USDC)',
      donations: 'GET /api/donations/SLUG',
      needs_enrichment: 'GET /api/needs-enrichment?limit=N&field=FIELD',
      enrich: 'POST /api/enrich/SLUG — submit data for review (replace SLUG with a real nonprofit slug)',
      enrichment_stats: 'GET /api/enrichments/stats',
    },
    cause_areas: 'GET /api/causes for full list — 29 cause areas including youth-empowerment, environment, health, animals, housing, mental-health, and more',
    agent_files: {
      llms_txt: 'https://giveready.org/llms.txt',
      agents_md: 'https://giveready.org/agents.md',
      openapi: 'https://giveready.org/openapi.json',
      arazzo_workflows: 'https://giveready.org/agents.arazzo.yaml',
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

export async function handleSearch(db, url) {
  const q = url.searchParams.get('q') || '';
  const cause = url.searchParams.get('cause');
  const country = url.searchParams.get('country');
  const ghd = url.searchParams.get('ghd_aligned');

  // Trust filters (2026-08-27). Until today `verified=1` was accepted and
  // ignored: it returned the unfiltered default page, so a caller asking for
  // verified organisations got unverified ones and no way to tell. Silent
  // ignore is worse than 400, because the caller acts on the result.
  const verifiedOnly = ['1', 'true'].includes(String(url.searchParams.get('verified')));
  const registryStatusFilter = url.searchParams.get('registry_status');
  const safeOnly = ['1', 'true'].includes(String(url.searchParams.get('safe_to_recommend')));
  // Freshness in hours. `safe_to_recommend=1&checked_within_hours=24` is the
  // query an agent should send before telling a human where to send money.
  const checkedWithinHours = parseInt(url.searchParams.get('checked_within_hours') || '0');
  const checkedSince = checkedWithinHours > 0
    ? Math.floor(Date.now() / 1000) - (checkedWithinHours * 3600)
    : null;

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
               n.region, n.description,
               n.registry_status, n.registry_status_source,
               n.registry_status_source_date, n.registry_status_checked_at
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
      if (verifiedOnly) {
        query += ` AND n.verified = 1`;
      }
      if (safeOnly) {
        query += ` AND n.registry_status = 'good_standing'`;
      } else if (registryStatusFilter) {
        query += ` AND n.registry_status = ?${params.length + 1}`;
        params.push(registryStatusFilter);
      }
      if (checkedSince !== null) {
        query += ` AND n.registry_status_checked_at >= ?${params.length + 1}`;
        params.push(checkedSince);
      }

      query += ` ORDER BY rank LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
      params.push(limit, offset);

      const results = await db.prepare(query).bind(...params).all();

      // Log the query (fire-and-forget, don't await)
      db.prepare(
        `INSERT INTO query_log (id, query_text, source, results_count) VALUES (?1, ?2, ?3, ?4)`
      ).bind(crypto.randomUUID(), q, 'api', results.results.length).run().catch(() => {});

      return json({
        query: { q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true',
                 verified: verifiedOnly, registry_status: registryStatusFilter,
                 safe_to_recommend: safeOnly,
                 checked_within_hours: checkedWithinHours || null },
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
           n.region, n.description,
           n.registry_status, n.registry_status_source,
           n.registry_status_source_date, n.registry_status_checked_at
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
  if (verifiedOnly) {
    query += ` AND n.verified = 1`;
  }
  if (safeOnly) {
    query += ` AND n.registry_status = 'good_standing'`;
  } else if (registryStatusFilter) {
    query += ` AND n.registry_status = ?${params.length + 1}`;
    params.push(registryStatusFilter);
  }
  if (checkedSince !== null) {
    query += ` AND n.registry_status_checked_at >= ?${params.length + 1}`;
    params.push(checkedSince);
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
    query: { q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true',
                 verified: verifiedOnly, registry_status: registryStatusFilter,
                 safe_to_recommend: safeOnly,
                 checked_within_hours: checkedWithinHours || null },
    count: results.results.length,
    nonprofits: results.results,
  });
}

export async function handleListNonprofits(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  // `page` was accepted and silently ignored until 2026-08-27. page=1, page=5
  // and page=20 all returned the identical first record, so any paging caller
  // read the same 100 rows forever and had no way to notice. Accept both now;
  // an explicit offset wins.
  const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1);
  const offset = url.searchParams.has('offset')
    ? Math.max(parseInt(url.searchParams.get('offset') || '0'), 0)
    : (page - 1) * limit;

  // `country` was ignored the same way: the unfiltered total came back for
  // every value, which reads as "41,227 organisations in Bermuda".
  const country = url.searchParams.get('country');

  // `cause` was the third instance of the same bug, live until 2026-09-07.
  // /api/nonprofits?cause=surf-therapy returned the unfiltered first page,
  // byte-identical to no filter at all, so an agent asking for surf-therapy
  // organisations got 50 arbitrary ones and no way to notice. Same clause as
  // handleSearch, so the two endpoints agree on what a cause filter means.
  //
  // Three for three on this handler now: page, country, cause. The lesson is
  // not "check cause" but that every accepted-and-ignored parameter reads as a
  // successful query to the caller. If a fourth filter is added here, add it to
  // the SQL in the same commit or reject it explicitly.
  const cause = url.searchParams.get('cause');

  // ORDER BY was not a total order, so OFFSET paging could repeat or skip rows
  // wherever verified and beneficiaries_per_year tied. `id` makes it stable.
  // ?1 is limit and ?2 is offset, so filter placeholders start at ?3. Each
  // helper reads the array length BEFORE pushing, which is what keeps the
  // numbering and the bind order in step. Getting this wrong throws in D1 at
  // runtime, in production, on a query nobody runs in dev.
  const conds = [];
  const filters = [];
  if (country) {
    conds.push(`LOWER(country) = LOWER(?${filters.length + 3})`);
    filters.push(country);
  }
  if (cause) {
    conds.push(`id IN (SELECT nonprofit_id FROM nonprofit_causes WHERE cause_id = ?${filters.length + 3})`);
    filters.push(cause);
  }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT id, slug, name, tagline, mission, country, city, region, website,
           donation_url, logo_url, beneficiaries_per_year, founded_year,
           ghd_aligned, verified, description,
           registry_status, registry_status_source_date, registry_status_checked_at
    FROM nonprofits
    ${whereSql}
    ORDER BY verified DESC, beneficiaries_per_year DESC, id
    LIMIT ?1 OFFSET ?2
  `;
  const results = await db.prepare(sql).bind(limit, offset, ...filters).all();

  // Same pattern as handleStats, same reason (2026-09-02). The unfiltered
  // COUNT(*) read 41,227 rows on every /api/nonprofits call, and this endpoint
  // is not in the discovery-logged route list, so its volume has never been
  // measured. Served from stats_cache; the country-filtered variant stays live
  // because it rides idx_nonprofits_country and is bounded by that country.
  // A filtered total, or next_offset lies and the caller pages into nothing.
  // This is the half of the `country` bug that made it read as "41,227
  // organisations in Bermuda"; `cause` would have done the same.
  let total;
  if (filters.length) {
    const countConds = [];
    if (country) countConds.push(`LOWER(country) = LOWER(?${countConds.length + 1})`);
    if (cause) countConds.push(`id IN (SELECT nonprofit_id FROM nonprofit_causes WHERE cause_id = ?${countConds.length + 1})`);
    total = await db.prepare(
      `SELECT COUNT(*) as count FROM nonprofits WHERE ${countConds.join(' AND ')}`
    ).bind(...filters).first();
  } else {
    const cached = await db.prepare(
      `SELECT value FROM stats_cache WHERE key = 'nonprofit_count'`
    ).first();
    total = cached
      ? { count: parseInt(cached.value) || 0 }
      : await db.prepare(`SELECT COUNT(*) as count FROM nonprofits`).first();
  }

  const rows = results.results || [];
  return json({
    total: total.count,
    count: rows.length,
    limit,
    offset,
    next_offset: (offset + rows.length) < total.count ? offset + rows.length : null,
    nonprofits: rows,
  });
}

export async function handleListCauses(db) {
  const causes = await db.prepare(`
    SELECT c.id, c.name, c.description, COUNT(nc.nonprofit_id) as nonprofit_count
    FROM causes c
    LEFT JOIN nonprofit_causes nc ON c.id = nc.cause_id
    GROUP BY c.id
    ORDER BY nonprofit_count DESC
  `).all();

  return json({ causes: causes.results });
}
