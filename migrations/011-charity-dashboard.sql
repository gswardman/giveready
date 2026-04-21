-- Migration 011: Charity self-serve dashboard
-- Adds: passwordless login, session management, profile audit, claim requests,
--       query attribution (query_matches), bundled index fixes for H3 CSO audit.
--
-- Run with: wrangler d1 execute giveready-db --local --file=./migrations/011-charity-dashboard.sql
--   (then same command without --local to apply to production)
--
-- Reviewed: /plan-eng-review 2026-04-20
-- Ship target: Friday 24 April (Gates grant demo)

-- -----------------------------------------------------------------------------
-- charity_users
--
-- Binds an email address to a nonprofit. Composite UNIQUE(nonprofit_id, email)
-- so one email (e.g. a charity consultant like Joe) can bind to many charities.
-- Email lookup returns a list; the login flow shows a picker when count > 1.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charity_users (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'admin',  -- 'admin' | 'editor' | 'viewer' (future)
  verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT,
  UNIQUE(nonprofit_id, email),
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX IF NOT EXISTS idx_charity_users_email ON charity_users(email);
CREATE INDEX IF NOT EXISTS idx_charity_users_nonprofit ON charity_users(nonprofit_id);

-- -----------------------------------------------------------------------------
-- magic_link_tokens
--
-- Login tokens (distinct from verification_tokens which handles one-time claim
-- verification). Tokens are SHA-256-hashed before storage. Raw token lives only
-- in the emailed URL. 15-minute expiry, single-use.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,               -- lowercase, pre-validated
  expires_at TEXT NOT NULL,          -- ISO 8601, 15 min from creation
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT,                   -- for audit
  user_agent TEXT                    -- for audit
);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email ON magic_link_tokens(email, created_at);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_expires ON magic_link_tokens(expires_at);

-- -----------------------------------------------------------------------------
-- charity_sessions
--
-- Persistent session tokens for logged-in charity users. 24-hour expiry,
-- rotatable, revocable. Cookie holds the raw token; DB holds the SHA-256 hash.
-- active_nonprofit_id tracks which charity the user has "active" in the session
-- when they bind to multiple (charity picker flow).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charity_sessions (
  token_hash TEXT PRIMARY KEY,
  charity_user_id TEXT NOT NULL,
  active_nonprofit_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (charity_user_id) REFERENCES charity_users(id),
  FOREIGN KEY (active_nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX IF NOT EXISTS idx_charity_sessions_expires ON charity_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_charity_sessions_user ON charity_sessions(charity_user_id);

-- -----------------------------------------------------------------------------
-- claim_requests
--
-- Self-serve claim-access requests. Admin reviews manually in MVP. Ships from
-- day one so the v4 "nonprofit claim rate" measurement metric has a data source.
-- Self-serve verification (matching email domain to Charity Commission record)
-- becomes Month 1-3 grant-funded scope.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_requests (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT,                 -- nullable, can match by registration number
  charity_registration_number TEXT,
  email TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'denied'
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX IF NOT EXISTS idx_claim_requests_status ON claim_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_claim_requests_email ON claim_requests(email);

-- -----------------------------------------------------------------------------
-- profile_edits
--
-- Audit trail for PATCH /api/charity/profile. Every field change produces one
-- row. Supports who-changed-what review later and deters tampering.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_edits (
  id TEXT PRIMARY KEY,
  charity_user_id TEXT NOT NULL,
  nonprofit_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (charity_user_id) REFERENCES charity_users(id),
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX IF NOT EXISTS idx_profile_edits_nonprofit ON profile_edits(nonprofit_id, created_at);

-- -----------------------------------------------------------------------------
-- query_matches
--
-- Query-to-nonprofit attribution. query_log captures each search; query_matches
-- records which nonprofits that search surfaced. Required for the
-- "Who searched for you" panel without N+1 queries.
--
-- Search handlers (handleSearch, MCP search_nonprofits) will be updated to
-- INSERT one row per matched nonprofit, with rank = position in results.
-- Queries logged before this migration have no matches attributed — the panel
-- starts empty per charity and fills as new queries arrive.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS query_matches (
  query_log_id TEXT NOT NULL,
  nonprofit_id TEXT NOT NULL,
  rank INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (query_log_id, nonprofit_id),
  FOREIGN KEY (query_log_id) REFERENCES query_log(id),
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX IF NOT EXISTS idx_query_matches_nonprofit_created ON query_matches(nonprofit_id, created_at);

-- -----------------------------------------------------------------------------
-- Bundled fix: H3 from 2026-04-16 CSO audit
--
-- handleAgentNamedFirstSeen runs one D1 query per distinct UA in the window.
-- Fix is a single aggregate query plus this composite index.
-- Shipping the index here so the fix lands with the next deploy.
-- The query rewrite happens in src/index.js alongside this migration.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_discovery_hits_ua_created ON discovery_hits(user_agent, created_at);

-- -----------------------------------------------------------------------------
-- Migration log entry
-- -----------------------------------------------------------------------------
-- (no explicit migrations table in this codebase; rely on file naming)
