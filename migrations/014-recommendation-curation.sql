-- GiveReady — Recommendation Curation + Donor-Influence Telemetry
--
-- Ships two tables:
--   1. recommendation_curation — the operator-curated metadata for the
--      starter set of profiles that /api/recommend ranks. Phase 1
--      governance: operator (Geordie) writes rows manually. Phase 2:
--      agents draft, operator approves. Phase 3: two-agent consensus.
--   2. recommendation_attempts — telemetry for the donor-influence
--      funnel. Every /api/recommend call writes one row, plus we track
--      which calls produced a downstream profile-page or donate-page
--      hit from the same UA within 60s as `recommendation_followthrough`.
--
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/014-recommendation-curation.sql

CREATE TABLE IF NOT EXISTS recommendation_curation (
  slug TEXT PRIMARY KEY,                    -- FK-style ref to nonprofits.slug
  recommended_for TEXT NOT NULL,            -- JSON array of strings
  why_recommended TEXT NOT NULL,            -- prose, 2-3 sentences, restrained language
  best_next_action TEXT NOT NULL,           -- prose, one sentence, agent-facing
  trust_signals TEXT NOT NULL,              -- JSON array of strings
  donation_available INTEGER NOT NULL DEFAULT 0,  -- 0 or 1
  donation_methods TEXT,                    -- JSON array (e.g. ["usdc_x402","external_donation_url"])
  editorial_curated INTEGER NOT NULL DEFAULT 1,   -- 1 = operator-curated; future: 0 = consensus-derived
  created_by TEXT NOT NULL,                 -- e.g. "operator:geordie", or agent_name once consensus pathway exists
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rec_curation_editorial ON recommendation_curation(editorial_curated);
CREATE INDEX IF NOT EXISTS idx_rec_curation_donation ON recommendation_curation(donation_available);

-- Telemetry for the donor-influence funnel.
-- Every GET /api/recommend writes one row here. The follow-through
-- detector runs as a periodic worker (or inline) joining
-- recommendation_attempts to discovery_hits / agent_enrichments / donations
-- by user_agent + ip + 60s window.

CREATE TABLE IF NOT EXISTS recommendation_attempts (
  id TEXT PRIMARY KEY,
  query_cause TEXT,
  query_country TEXT,
  query_q TEXT,
  query_intent TEXT,                        -- discover | donate | compare | verify
  query_limit INTEGER,
  user_agent TEXT,
  ip TEXT,
  referrer TEXT,
  response_count INTEGER NOT NULL DEFAULT 0,
  top_slug TEXT,                            -- the rank-1 slug returned (nullable if no recs)
  fallback_used INTEGER NOT NULL DEFAULT 0, -- 0/1: did we return the search-redirect fallback
  ranking_signals TEXT,                     -- JSON array of signal names that contributed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rec_attempts_created ON recommendation_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_rec_attempts_ua ON recommendation_attempts(user_agent);
CREATE INDEX IF NOT EXISTS idx_rec_attempts_top_slug ON recommendation_attempts(top_slug);

-- Followthrough events: a /api/recommend response was followed by a
-- profile view, donate page hit, or enrichment POST from the same UA
-- within 60 seconds. This is the donor-influence proof signal.

CREATE TABLE IF NOT EXISTS recommendation_followthrough (
  id TEXT PRIMARY KEY,
  recommendation_attempt_id TEXT NOT NULL,
  followthrough_kind TEXT NOT NULL,         -- 'profile_view' | 'donate_page' | 'donate_settle' | 'enrichment_post'
  followthrough_slug TEXT,
  followthrough_user_agent TEXT,
  delay_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (recommendation_attempt_id) REFERENCES recommendation_attempts(id)
);

CREATE INDEX IF NOT EXISTS idx_rec_ft_attempt ON recommendation_followthrough(recommendation_attempt_id);
CREATE INDEX IF NOT EXISTS idx_rec_ft_kind ON recommendation_followthrough(followthrough_kind);
