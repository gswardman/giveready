-- 029-wallet-proof.sql
-- 2026-09-21. Storage for wallet ownership proofs.
--
-- WHY
-- migration 001 added `wallet_signature` to nonprofits, commented "proof of
-- wallet ownership". Nothing ever wrote to it. src/index.js accepted a
-- wallet_signature field on onboarding and console.logged it under "for future
-- verification". Five months on, every one of 41,228 records publishes a payable
-- address with zero evidence of control.
--
-- A donor agent's second check is wallet control. Until this table exists there
-- is no way to pass it, for WEF or anyone else.
--
-- Idempotent.

-- Outstanding challenges. One live challenge per nonprofit; issuing a new one
-- replaces the old, so a harvested-but-unused challenge cannot be banked.
CREATE TABLE IF NOT EXISTS wallet_proof_challenges (
  nonprofit_id TEXT PRIMARY KEY,
  nonce        TEXT NOT NULL,
  wallet       TEXT NOT NULL,
  message      TEXT NOT NULL,
  issued_at    INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_proof_expires
  ON wallet_proof_challenges (expires_at);

-- When the proof was accepted, and the exact text that was signed. Storing the
-- message matters: a signature without the message it covers cannot be
-- independently re-verified by anyone else, which would make this another status
-- with no provenance (migration 024, design rule 3).
ALTER TABLE nonprofits ADD COLUMN wallet_proved_at INTEGER;
ALTER TABLE nonprofits ADD COLUMN wallet_proof_message TEXT;
