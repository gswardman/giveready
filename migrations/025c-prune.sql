-- 025c-prune.sql
-- 2026-09-02. Retention catch-up. RE-RUNNABLE, AND MEANT TO BE RE-RUN.
--
-- Apply, repeatedly, until it reports 0 rows written:
--   npx wrangler d1 execute giveready-db --remote --file=migrations/025c-prune.sql
--
-- Check progress between runs:
--   npx wrangler d1 execute giveready-db --remote --command \
--     "SELECT COUNT(*) AS remaining FROM discovery_hits WHERE created_at < datetime('now','-90 days');"
--
-- WHY IT IS BATCHED
-- The first version of this deleted every expired row in one statement, about
-- 165,000 of them. Against the live database it returned {"D1_RESET_DO":true}
-- and rolled back: that is a single transaction large enough to restart the
-- Durable Object behind D1. Do not "simplify" this back into one DELETE, even
-- when the backlog is small. The backlog is only small because this runs.
--
-- 5,000 rows per statement, 10 statements, so 50,000 rows per invocation. About
-- four invocations clears the September 2026 backlog. Each is independent: if
-- one fails you have lost nothing and can run it again.
--
-- WHY 90 DAYS
-- Nothing reads discovery_hits beyond 30 days. The admin windows top out at
-- hours=720 and funnel-guides at 168. 90 days is a 3x margin. Migration 008
-- intended a 30-day retention, ran its DELETE once at migration time, and never
-- became recurring, which is why the table reached 240,779 rows by September.
-- scheduled() now repeats a bounded version of this daily so it cannot lapse
-- again.

DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
DELETE FROM discovery_hits WHERE rowid IN (
  SELECT rowid FROM discovery_hits WHERE created_at < datetime('now', '-90 days') LIMIT 5000);

DELETE FROM query_log WHERE rowid IN (
  SELECT rowid FROM query_log WHERE created_at < datetime('now', '-90 days') LIMIT 5000);
