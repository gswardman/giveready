-- GiveReady — Mark seeded demo query_log rows
-- Phase 3 of the 2026-04-29 learning-loop plan.
-- The 6 fixture rows from scripts/seed-cks-demo.sql have been polluting the
-- daily digest's signal/noise read by appearing in /api/admin/traffic's
-- recent_queries with synthetic ClaudeBot/GPTBot/Perplexity source labels.
-- This migration adds an is_demo flag, backfills the known fixtures, and
-- the API handler will exclude is_demo=1 rows from recent_queries.
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/012-query-log-is-demo.sql

ALTER TABLE query_log ADD COLUMN is_demo INTEGER DEFAULT 0;

-- Backfill existing seeded rows. Pattern matches both today's seed-cks-demo
-- IDs (q-demo-cks-NN) and any future demo rows that follow the q-demo-* convention.
UPDATE query_log SET is_demo = 1 WHERE id LIKE 'q-demo-%';

-- Index so the digest's "last 30 real queries" scan stays cheap.
CREATE INDEX IF NOT EXISTS idx_query_log_is_demo_created
  ON query_log(is_demo, created_at);
