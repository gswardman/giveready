-- GiveReady v0.2 Migration
-- Adds donations table + WEF wallet address
-- Run: wrangler d1 execute giveready-db --remote --file=./migrate-v0.2.sql

-- Donation transactions via x402
CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  amount_usdc REAL NOT NULL,
  amount_atomic INTEGER NOT NULL,
  network TEXT NOT NULL,
  tx_hash TEXT,
  sender_address TEXT,
  status TEXT DEFAULT 'pending',
  facilitator_response TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  settled_at TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE INDEX IF NOT EXISTS idx_donations_nonprofit ON donations(nonprofit_id);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);

-- Set WEF wallet address (Phantom, Solana USDC)
UPDATE nonprofits
SET usdc_wallet = 'J4F3RwWiCnAvyeMqnrxMb7RC8CVg2kk8VyPFfzbfn3CH',
    updated_at = datetime('now')
WHERE id = 'finn-wardman-wef';

-- Re-seed consortium orgs if missing (INSERT OR IGNORE skips if they exist)
-- Run seed.sql separately if the 3 orgs are missing entirely
