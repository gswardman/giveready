-- GiveReady Database Schema
-- Nonprofit profiles optimised for AI discoverability

CREATE TABLE IF NOT EXISTS nonprofits (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT,
  mission TEXT NOT NULL,
  description TEXT NOT NULL,
  website TEXT,
  donation_url TEXT,
  usdc_wallet TEXT,
  country TEXT NOT NULL,
  city TEXT,
  region TEXT,
  founded_year INTEGER,
  annual_budget_usd INTEGER,
  budget_year INTEGER,
  team_size INTEGER,
  beneficiaries_per_year INTEGER,
  contact_email TEXT,
  logo_url TEXT,
  verified INTEGER DEFAULT 0,
  ghd_aligned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS causes (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS nonprofit_causes (
  nonprofit_id TEXT NOT NULL,
  cause_id TEXT NOT NULL,
  PRIMARY KEY (nonprofit_id, cause_id),
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id),
  FOREIGN KEY (cause_id) REFERENCES causes(id)
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  beneficiaries_per_year INTEGER,
  location TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE TABLE IF NOT EXISTS impact_metrics (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT,
  period TEXT,
  year INTEGER,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  country TEXT NOT NULL,
  type TEXT NOT NULL,
  registration_number TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_nonprofits_country ON nonprofits(country);
CREATE INDEX IF NOT EXISTS idx_nonprofits_slug ON nonprofits(slug);
CREATE INDEX IF NOT EXISTS idx_nonprofits_verified ON nonprofits(verified);
CREATE INDEX IF NOT EXISTS idx_nonprofit_causes_cause ON nonprofit_causes(cause_id);
CREATE INDEX IF NOT EXISTS idx_programs_nonprofit ON programs(nonprofit_id);
CREATE INDEX IF NOT EXISTS idx_impact_nonprofit ON impact_metrics(nonprofit_id);

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

-- Discovery hit counters (llms.txt, agents.md, ai-plugin.json, /mcp)
CREATE TABLE IF NOT EXISTS discovery_hits (
  id TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_discovery_route ON discovery_hits(route);
CREATE INDEX IF NOT EXISTS idx_discovery_created ON discovery_hits(created_at);

-- Query log for measuring AI discoverability
CREATE TABLE IF NOT EXISTS query_log (
  id TEXT PRIMARY KEY,
  query_text TEXT,
  source TEXT,
  results_count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
