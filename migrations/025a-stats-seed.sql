-- 025a-stats-seed.sql
-- 2026-09-02. THE FIX. Run this one first, and if you run nothing else, run this.
--
-- Apply:
--   npx wrangler d1 execute giveready-db --remote --file=migrations/025a-stats-seed.sql
--
-- Verify:
--   npx wrangler d1 execute giveready-db --remote --command \
--     "SELECT key, value, updated_at FROM stats_cache ORDER BY key;"
--   Expect nonprofit_count ~41227 with today's updated_at.
--
-- WHY THIS IS THE ONE THAT MATTERS
-- handleStats served /api/stats by running `SELECT COUNT(*) FROM nonprofits`
-- live, 41,227 rows per call, with no cache header, fetched by index.html and
-- progress.html on every page load. That was the largest single consumer of the
-- 5,000,000/day D1 free-tier rows_read limit. The deployed Worker now reads
-- these keys instead, but only if their updated_at is inside 48 hours: an
-- older stamp trips a deliberate staleness fuse and falls back to the live
-- count. `nonprofit_count` currently carries an April timestamp from the last
-- bulk import, so until this file runs the fix is deployed and doing nothing.
--
-- COST: about 123k rows read, once. It removes roughly 3.4M/day.
--
-- Deliberately contains NO bulk DELETE. See 025-d1-rows-read-fix.sql for what
-- happened when the seed and the prune were bundled.

-- Ordered cheapest-and-most-important first, so that if this ever has to run
-- against a nearly-exhausted quota, the critical key is written earliest.

-- The one that stops the bleeding.
INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'nonprofit_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM nonprofits;

-- Seeded for the fallback path only. handleStats reads verified LIVE on every
-- call and always will: `WHERE verified = 1` rides idx_nonprofits_verified for
-- ~177 rows, and this is the number that froze on 2026-08-02 and made the daily
-- digest report a working registration flow as broken. It stays instant.
INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'verified_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM nonprofits WHERE verified = 1;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'cause_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM causes;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'country_count', CAST(COUNT(DISTINCT country) AS TEXT), datetime('now') FROM nonprofits;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'total_beneficiaries', CAST(COALESCE(SUM(beneficiaries_per_year), 0) AS TEXT), datetime('now') FROM nonprofits;
