-- ════════════════════════════════════════════════════════════════
-- GiveReady — Scale Indexes & Performance for 2M+ Nonprofits
-- Generated: 2026-04-12
--
-- Adds:
--   1. FTS5 full-text search table (replaces LIKE scans)
--   2. Composite indexes for common query patterns
--   3. Stats cache table (avoids 5x COUNT on every /api/stats call)
--   4. Index on nonprofits.name for ORDER BY performance
--
-- Run AFTER 007-irs-bmf-import.sql:
--   npx wrangler d1 execute giveready-db --remote --file=migrations/008-scale-indexes.sql
-- ════════════════════════════════════════════════════════════════

-- 1. Full-Text Search via FTS5
--    This replaces the 5-column LIKE scan in handleSearch
--    Populate after creation, then keep in sync on INSERT/UPDATE
CREATE VIRTUAL TABLE IF NOT EXISTS nonprofits_fts USING fts5(
  name,
  mission,
  description,
  tagline,
  city,
  content='nonprofits',
  content_rowid='rowid'
);

-- Populate FTS from existing data
INSERT INTO nonprofits_fts(nonprofits_fts) VALUES('rebuild');

-- 2. Composite indexes for filtered queries
--    The cause+nonprofit join is the hottest path
CREATE INDEX IF NOT EXISTS idx_nc_cause_nonprofit ON nonprofit_causes(cause_id, nonprofit_id);

-- Index for needs-enrichment queries (NULL field checks)
CREATE INDEX IF NOT EXISTS idx_nonprofits_mission ON nonprofits(mission) WHERE mission IS NULL OR mission = '';
CREATE INDEX IF NOT EXISTS idx_nonprofits_description ON nonprofits(description) WHERE description IS NULL OR description = '';
CREATE INDEX IF NOT EXISTS idx_nonprofits_website ON nonprofits(website) WHERE website IS NULL OR website = '';

-- Index for registrations lookup by nonprofit
CREATE INDEX IF NOT EXISTS idx_registrations_nonprofit ON registrations(nonprofit_id);

-- Name index for ORDER BY n.name ASC (needs-enrichment)
CREATE INDEX IF NOT EXISTS idx_nonprofits_name ON nonprofits(name);

-- 3. Stats cache table
--    /api/stats reads from here instead of running 5 COUNTs
CREATE TABLE IF NOT EXISTS stats_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed initial stats
INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'nonprofit_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM nonprofits;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'country_count', CAST(COUNT(DISTINCT country) AS TEXT), datetime('now') FROM nonprofits;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'cause_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM causes;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'total_beneficiaries', CAST(COALESCE(SUM(beneficiaries_per_year), 0) AS TEXT), datetime('now') FROM nonprofits;

INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
SELECT 'verified_count', CAST(COUNT(*) AS TEXT), datetime('now') FROM nonprofits WHERE verified = 1;

-- 4. Cleanup old discovery_hits and query_log (keep 30 days)
DELETE FROM discovery_hits WHERE created_at < datetime('now', '-30 days');
DELETE FROM query_log WHERE created_at < datetime('now', '-30 days');
