-- Migration: Add onboarding support
-- Run with: wrangler d1 execute giveready-db --file=migrations/001-onboard-support.sql

-- No schema changes needed for basic onboarding.
-- The nonprofits table already has verified = 0|1 which serves as the draft/approved flag.
-- New onboard submissions write verified = 0, admin approval sets verified = 1.

-- Add wallet_signature column for storing proof of wallet ownership
ALTER TABLE nonprofits ADD COLUMN wallet_signature TEXT;

-- Add wallet_type column (squads-vault or personal)
ALTER TABLE nonprofits ADD COLUMN wallet_type TEXT;

-- Add notes column for freeform onboarding notes
ALTER TABLE nonprofits ADD COLUMN notes TEXT;

-- Wrangler secrets to set:
-- wrangler secret put ADMIN_TOKEN    (any strong random string for admin API auth)
-- wrangler secret put CHARITY_API_KEY  (UK Charity Commission API key, optional)
