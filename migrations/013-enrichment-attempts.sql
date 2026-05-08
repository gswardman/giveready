-- GiveReady — Enrichment Attempts Funnel Logging
-- Closes the observability gap between "agent read /AGENTS.md" and
-- "agent submission appears on the leaderboard". Today we only see the
-- successful inserts into agent_enrichments — we cannot see attempts that
-- 400'd on missing fields, 404'd on a bad slug, 401'd on auth, or never
-- got past JSON parsing. With this table the daily digest can show
-- "tried-and-bounced" as a distinct funnel stage.
--
-- Every POST to /api/enrich/{slug} writes one row here, regardless of
-- outcome. The successful inserts ALSO continue to write to
-- agent_enrichments — this table is in addition to, not instead of.
--
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/013-enrichment-attempts.sql

CREATE TABLE IF NOT EXISTS enrichment_attempts (
  id TEXT PRIMARY KEY,
  slug TEXT,                      -- nonprofit slug from URL path (may be invalid)
  user_agent TEXT,
  ip TEXT,                        -- from CF-Connecting-IP header
  referrer TEXT,                  -- from Referer header
  status_code INTEGER NOT NULL,   -- HTTP status returned to caller
  error_class TEXT,               -- 'ok' | 'invalid_json' | 'no_fields' | 'nonprofit_not_found' | 'unhandled' | future classes
  fields_count INTEGER DEFAULT 0, -- number of fields in the submitted payload (0 if parse failed)
  payload_bytes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_created ON enrichment_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_status ON enrichment_attempts(status_code);
CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_error ON enrichment_attempts(error_class);
CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_ua ON enrichment_attempts(user_agent);
