-- ════════════════════════════════════════════════════════════════
-- GiveReady — onboarding funnel instrumentation
--
-- Why: on 2026-08-01 four separate faults were found on the single path a
-- charity walks from signing up to being able to receive money. All four
-- had been live for months. None were visible from the operator side,
-- because the only signal was an inbound email from the one person
-- persistent enough to write it (doobneek Inc.).
--
-- Registration POSTs are not written to discovery_hits, so a failed
-- attempt left no trace at all. This table closes that hole: one
-- append-only row per step, success or failure, across the whole path.
--
-- Privacy: no raw email addresses and no raw IPs. `actor_hash` is a
-- truncated SHA-256 of the lowercased email — enough to follow one
-- organisation's journey across steps, not enough to be a contact list.
-- `email_domain` is kept separately because "did a real org domain try, or
-- a throwaway gmail" is a different question from "who".
--
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/020-onboarding-funnel.sql
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_events (
  id TEXT PRIMARY KEY,

  -- Where on the path. Ordered roughly by how far the charity has got:
  --   register_attempt   POST /api/onboard received
  --   register_success   nonprofit row written
  --   register_fail      rejected (validation) or threw (server)
  --   claim_attempt      claim of an existing directory row
  --   signin_request     magic link requested
  --   signin_success     link verified, session created
  --   signin_no_charity  link verified but no charity bound to the email
  --   profile_edit       dashboard profile saved
  --   wallet_set         usdc_wallet added or changed
  --   wallet_cleared     usdc_wallet removed
  --   verified           operator approved, page goes public
  --   donate_quote       an agent was quoted an x402 payment
  --   donate_redirect    no wallet, donor sent to the charity's own page
  --   donate_settled     on-chain settlement confirmed
  step TEXT NOT NULL,

  -- 'ok' or 'fail'. Kept separate from step so a step can be counted both
  -- ways without parsing names.
  outcome TEXT NOT NULL DEFAULT 'ok',

  nonprofit_id TEXT,
  slug TEXT,

  -- Truncated SHA-256 of the lowercased email. Never the address itself.
  actor_hash TEXT,
  email_domain TEXT,

  -- Failure reason, verbatim from the handler. Null on success. This is the
  -- field that would have said "NOT NULL constraint failed:
  -- nonprofits.mission" back in April.
  reason TEXT,

  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_created ON onboarding_events(created_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_step ON onboarding_events(step, outcome);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_actor ON onboarding_events(actor_hash);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_nonprofit ON onboarding_events(nonprofit_id);
