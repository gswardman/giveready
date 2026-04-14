-- Migration 007: Stripe gateway payment support
-- Adds payment_method to donations table and gateway_donations for holding funds
-- until nonprofits claim their profiles and connect bank accounts

-- Add payment_method column to donations (default 'solana' for existing rows)
ALTER TABLE donations ADD COLUMN payment_method TEXT DEFAULT 'solana';

-- Gateway donations: holds Stripe payment info for nonprofits without wallets
-- When a nonprofit claims their profile, these get reconciled
CREATE TABLE IF NOT EXISTS gateway_donations (
  id TEXT PRIMARY KEY,
  donation_id TEXT NOT NULL,
  nonprofit_id TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  amount_usd REAL NOT NULL,
  currency TEXT DEFAULT 'usd',
  donor_email TEXT,
  status TEXT DEFAULT 'pending',  -- pending, completed, claimed, refunded
  claimed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (donation_id) REFERENCES donations(id),
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_nonprofit ON gateway_donations(nonprofit_id);
CREATE INDEX IF NOT EXISTS idx_gateway_status ON gateway_donations(status);
CREATE INDEX IF NOT EXISTS idx_gateway_stripe_session ON gateway_donations(stripe_session_id);
