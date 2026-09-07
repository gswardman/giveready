-- 025b-discovery-total-seed.sql
-- 2026-09-02. Cosmetic. Run after 025a, or skip it.
--
-- Apply:
--   npx wrangler d1 execute giveready-db --remote --file=migrations/025b-discovery-total-seed.sql
--
-- WHAT IT IS FOR
-- handleAdminTraffic used to run `SELECT COUNT(*) FROM discovery_hits` with no
-- WHERE clause on every admin call: 240,779 rows, whatever window was asked for.
-- The daily digest makes three such calls, so this one decorative number cost
-- ~722k rows a day. The deployed Worker now reads this cached key instead.
--
-- WHY IT IS OPTIONAL
-- If the key is absent the Worker reports `total_discovery_hits: null` and
-- `total_discovery_hits_as_of: null`, which is honest and harmless. Nothing in
-- build-digest.sh, gr-status.sh or any skill reads the field. The saving comes
-- from the Worker no longer running the count, not from this file.
--
-- COST: about 240k rows read, once. Run it when the quota has room, and prefer
-- running it AFTER 025c-prune.sql so the number describes the pruned table.
-- The daily cron in scheduled() refreshes it from 03:17 UTC onward anyway, so
-- skipping this file entirely just means one null in the admin response until
-- tomorrow morning.

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'discovery_hits_total', CAST(COUNT(*) AS TEXT), datetime('now') FROM discovery_hits;
