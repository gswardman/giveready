-- 021 — on-chain reconciliation of wallet-to-wallet donations
--
-- Why this exists. The x402 path writes a donations row because the Worker
-- builds and broadcasts the transaction itself. A donor who pays from their own
-- wallet, via the QR or the solana: link on /donate/<slug>, never touches the
-- Worker at all. Until now those donations were invisible: /api/donations/<slug>
-- reported $0 raised while real money was arriving in the charity's wallet.
--
-- `source` records how a donation became known, not who referred it:
--   'x402'    — settled through the gateway, the Worker signed or broadcast it
--   'onchain' — observed on Solana by the reconciler; money arrived, referrer unknown
-- Reference-key attribution (proving GiveReady referred a donation) is a separate
-- change and deliberately not implied by 'onchain'.

ALTER TABLE donations ADD COLUMN source TEXT DEFAULT 'x402';
ALTER TABLE donations ADD COLUMN reference_pubkey TEXT;

-- One row per transaction, whichever path recorded it. Partial so the existing
-- pending rows (tx_hash NULL) are unaffected; NULLs are distinct in SQLite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_tx_hash
  ON donations(tx_hash) WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_donations_source ON donations(source);

-- Reconciler cursor. Signatures are read from the USDC token account rather
-- than the owner wallet, because the owner is usually absent from an SPL
-- transfer's account list; token_account is cached here to save an RPC call.
CREATE TABLE IF NOT EXISTS wallet_reconcile_state (
  nonprofit_id   TEXT PRIMARY KEY,
  wallet         TEXT NOT NULL,
  token_account  TEXT,
  last_signature TEXT,
  last_run_at    TEXT,
  last_error     TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
