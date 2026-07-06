-- 018: referral attribution for the guide -> donation funnel (2026-07-07)
-- Why: citations are the leading indicator, not the goal. The Gates thesis is
-- proven by a non-operator donation attributable to an AI answer. This adds the
-- two columns needed to see that path: the HTTP Referer (which AI assistant or
-- search engine sent the visitor) and the ?ref= param (which guide sent the
-- click onward to a nonprofit profile or donate page).
-- Anti-slop guardrail #5 in 01-Projects/GiveReady/2026-07-06-purpose-and-wef-strategy.md.

ALTER TABLE discovery_hits ADD COLUMN referrer TEXT;
ALTER TABLE discovery_hits ADD COLUMN ref TEXT;
CREATE INDEX IF NOT EXISTS idx_discovery_ref ON discovery_hits(ref);
