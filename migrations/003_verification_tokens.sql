-- Migration 003: Magic link verification system
-- Run with: wrangler d1 execute giveready-db --remote --file=migrations/003_verification_tokens.sql

-- Verification tokens for magic link email verification
CREATE TABLE IF NOT EXISTS verification_tokens (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'claim',
  domain_match INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX IF NOT EXISTS idx_verification_token ON verification_tokens(token);

-- Add verification columns to nonprofits
ALTER TABLE nonprofits ADD COLUMN verification_status TEXT DEFAULT 'unverified';
ALTER TABLE nonprofits ADD COLUMN claimed_by_email TEXT;
ALTER TABLE nonprofits ADD COLUMN claimed_at TEXT;
ALTER TABLE nonprofits ADD COLUMN registry_number TEXT;
ALTER TABLE nonprofits ADD COLUMN registry_verified INTEGER DEFAULT 0;
