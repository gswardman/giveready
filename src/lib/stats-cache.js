/**
 * GiveReady — stats_cache maintenance: the daily directory recount and the registration-path bump.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

// ============================================
// STATS CACHE MAINTENANCE
// ============================================
//
// WHY THIS EXISTS (2026-09-02). The account hit 99% of the 5,000,000/day D1
// free-tier rows_read limit and the site returned Cloudflare 1101 on every
// database-backed route from 20:15 UTC until the quota reset at 00:00 UTC.
//
// The largest single consumer was `SELECT COUNT(*) FROM nonprofits` inside
// handleStats: 41,227 rows read, on every /api/stats call, uncached, fetched by
// public/index.html and public/progress.html on every page load. About 121
// homepage views spent the entire daily allowance.
//
// THE TRAP TO NOT FALL BACK INTO. stats_cache already existed and was abandoned
// for these two counts on 2026-08-02, for a good reason: it was only written
// after bulk imports, so the numbers froze, a newly-verified charity stayed
// invisible, and the daily digest drew a false conclusion from a frozen figure.
// Re-caching naively would reintroduce that exact bug.
//
// So the design here is deliberately split:
//
//   verified_count  stays LIVE. `WHERE verified = 1` rides idx_nonprofits_verified
//                   and reads ~177 rows, which is genuinely cheap. This is the
//                   number that was wrong on 2026-08-02, and it stays instant.
//
//   nonprofit_count comes from stats_cache. It is recounted once a day by the
//                   cron (41,227 rows/day, not 41,227 rows/request) AND bumped
//                   on the registration path, so a self-registering charity
//                   still moves the number immediately. The daily recount is
//                   what corrects any drift the bump misses.
//
// Do NOT "fix" this by recounting hourly. 24 x 41,227 is 989k rows/day, a fifth
// of the free tier, to maintain a cache. That is worse than the bug.

export async function refreshDirectoryStats(db) {
  // One authoritative recount. Costs one full scan of nonprofits, once a day.
  await db.prepare(
    `INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
     SELECT 'nonprofit_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM nonprofits`
  ).run();
  await db.prepare(
    `INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
     SELECT 'country_count', CAST(COUNT(DISTINCT country) AS TEXT), datetime('now') FROM nonprofits`
  ).run();
  await db.prepare(
    `INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
     SELECT 'total_beneficiaries', CAST(COALESCE(SUM(beneficiaries_per_year), 0) AS TEXT), datetime('now') FROM nonprofits`
  ).run();
  await db.prepare(
    `INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
     SELECT 'cause_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM causes`
  ).run();
}

// Move a cached counter without recounting. Used on the registration path so a
// new charity is visible in /api/stats before the next daily recount. Silent on
// failure by design: a stats counter must never be able to fail a registration.
export function bumpStatsCounter(db, key, delta) {
  return db.prepare(
    `UPDATE stats_cache
        SET value = CAST(CAST(value AS INTEGER) + ?2 AS TEXT), updated_at = datetime('now')
      WHERE key = ?1`
  ).bind(key, delta).run().catch((e) => {
    console.error(`[Stats] bump ${key} failed: ${(e && e.message) || e}`);
  });
}
