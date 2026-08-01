-- ════════════════════════════════════════════════════════════════
-- GiveReady — keep nonprofits_fts in sync with nonprofits
--
-- Why: migration 008 created nonprofits_fts as an external-content FTS5
-- table and populated it once with a 'rebuild'. Its own comment says
-- "keep in sync on INSERT/UPDATE" — nothing ever did. The result is that
-- every nonprofit added after that rebuild is invisible to /api/search,
-- which is the primary discovery path for both humans and agents.
--
-- Found 2026-08-01: doobneek Inc. registered, verified, live page at
-- /nonprofits/doobneek-inc, and `GET /api/search?q=doobneek` returned 0.
-- The LIKE fallback in handleSearch does not catch this because the FTS
-- path succeeds — it just matches nothing.
--
-- These are the standard FTS5 external-content sync triggers.
--
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/019-fts-sync-triggers.sql
-- ════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS nonprofits_fts_ai;
DROP TRIGGER IF EXISTS nonprofits_fts_ad;
DROP TRIGGER IF EXISTS nonprofits_fts_au;

CREATE TRIGGER nonprofits_fts_ai AFTER INSERT ON nonprofits BEGIN
  INSERT INTO nonprofits_fts(rowid, name, mission, description, tagline, city)
  VALUES (new.rowid, new.name, new.mission, new.description, new.tagline, new.city);
END;

CREATE TRIGGER nonprofits_fts_ad AFTER DELETE ON nonprofits BEGIN
  INSERT INTO nonprofits_fts(nonprofits_fts, rowid, name, mission, description, tagline, city)
  VALUES ('delete', old.rowid, old.name, old.mission, old.description, old.tagline, old.city);
END;

CREATE TRIGGER nonprofits_fts_au AFTER UPDATE ON nonprofits BEGIN
  INSERT INTO nonprofits_fts(nonprofits_fts, rowid, name, mission, description, tagline, city)
  VALUES ('delete', old.rowid, old.name, old.mission, old.description, old.tagline, old.city);
  INSERT INTO nonprofits_fts(rowid, name, mission, description, tagline, city)
  VALUES (new.rowid, new.name, new.mission, new.description, new.tagline, new.city);
END;

-- One-off rebuild to pick up every row added since the 008 rebuild.
-- Safe to re-run; this is how FTS5 external-content tables are repaired.
INSERT INTO nonprofits_fts(nonprofits_fts) VALUES('rebuild');
