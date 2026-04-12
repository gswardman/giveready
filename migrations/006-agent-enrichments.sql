-- GiveReady — Agent Enrichment System (Lite)
-- Agents can discover thin profiles and submit enrichment data
-- No auto-promotion: all submissions queue for review
-- Consensus tracked: if 2+ agents submit similar data, flagged as high-confidence
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/006-agent-enrichments.sql

CREATE TABLE IF NOT EXISTS agent_enrichments (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  nonprofit_slug TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  source_url TEXT,
  agent_id TEXT,
  agent_name TEXT,
  status TEXT DEFAULT 'pending',
  confidence INTEGER DEFAULT 0,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE INDEX IF NOT EXISTS idx_enrichments_nonprofit ON agent_enrichments(nonprofit_id);
CREATE INDEX IF NOT EXISTS idx_enrichments_status ON agent_enrichments(status);
CREATE INDEX IF NOT EXISTS idx_enrichments_field ON agent_enrichments(field);
CREATE INDEX IF NOT EXISTS idx_enrichments_agent ON agent_enrichments(agent_id);
