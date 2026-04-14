-- GiveReady — Consensus auto-promotion
-- When 2+ agents submit the same field and the nonprofit's value is empty,
-- the value is promoted live and enrichment rows transition to 'applied'.
-- This migration adds supporting indexes and a backfill for existing
-- high-confidence enrichments that already cleared the consensus bar.
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/009-consensus-promotion.sql

-- Speed up the per-nonprofit/field/status lookup the promoter runs.
CREATE INDEX IF NOT EXISTS idx_enrichments_field_status
  ON agent_enrichments(nonprofit_id, field, status);

-- Discovery-hit route leaderboard surfaces recent agents; speed that up too.
CREATE INDEX IF NOT EXISTS idx_discovery_hits_created
  ON discovery_hits(created_at);

-- Backfill: any field with confidence >= 2 and no value on the nonprofit row
-- gets promoted right now. We do this field-by-field to keep it safe.
-- NOTE: D1 does not support complex UPDATE...FROM with subqueries across
-- arbitrary fields, so the worker performs the backfill lazily on next
-- write. This migration only prepares the indexes. See handleEnrich().
