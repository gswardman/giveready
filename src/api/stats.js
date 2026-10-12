/**
 * GiveReady — GET /api/stats: directory-wide counts served from stats_cache.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json, cacheable } from '../lib/http.js';

export async function handleStats(db) {
  // Try cached stats first (updated after imports, refreshed periodically)
  try {
    const cached = await db.prepare(
      `SELECT key, value, updated_at FROM stats_cache`
    ).all();

    if (cached.results && cached.results.length > 0) {
      const stats = {};
      let countAsOf = null;
      cached.results.forEach(r => {
        stats[r.key] = parseInt(r.value) || 0;
        if (r.key === 'nonprofit_count') countAsOf = r.updated_at || null;
      });

      // Only query_log counts need to be live (they're cheap — indexed on created_at)
      const queries = await db.prepare(
        `SELECT COUNT(*) as total FROM query_log`
      ).first();
      const queriesThisWeek = await db.prepare(
        `SELECT COUNT(*) as count FROM query_log WHERE created_at > datetime('now', '-7 days')`
      ).first();

      // verified_count stays LIVE. `WHERE verified = 1` rides
      // idx_nonprofits_verified and reads ~177 rows, so it costs nothing and the
      // 2026-08-02 failure (a newly-verified charity invisible behind a frozen
      // cache) cannot happen on the number that actually failed that day.
      const verifiedLive = await db.prepare(
        `SELECT COUNT(*) AS count FROM nonprofits WHERE verified = 1`
      ).first();

      // nonprofit_count comes from stats_cache. See refreshDirectoryStats() for
      // why: the live COUNT(*) here was reading 41,227 rows on every homepage
      // view and was the largest single consumer of the D1 daily allowance.
      //
      // STALENESS FUSE. If the daily recount has not run for 48 hours the cron
      // is broken, and a silently frozen number feeding the digest is the exact
      // 2026-08-02 failure. Pay for one live count rather than serve a lie, and
      // say so in the response so it is visible rather than inferred.
      let npCount = stats.nonprofit_count ?? 0;
      let countStale = false;
      if (!countAsOf || (Date.now() - Date.parse(`${countAsOf.replace(' ', 'T')}Z`)) > 48 * 3600 * 1000) {
        countStale = true;
        const npLive = await db.prepare(
          `SELECT COUNT(*) AS count FROM nonprofits`
        ).first();
        npCount = npLive?.count ?? npCount;
        countAsOf = null;
        console.error('[Stats] nonprofit_count cache stale over 48h, fell back to live COUNT(*). Check the scheduled() prune/recount job.');
      }

      return cacheable(json({
        nonprofits: npCount,
        verified_nonprofits: verifiedLive?.count ?? stats.verified_count ?? 0,
        countries: stats.country_count || 0,
        causes: stats.cause_count || 0,
        total_beneficiaries_per_year: stats.total_beneficiaries || 0,
        total_queries: queries.total,
        queries_this_week: queriesThisWeek.count,
        nonprofit_count_as_of: countStale ? 'live (cache stale)' : countAsOf,
      }), 300);
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
