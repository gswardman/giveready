-- 025d-optional-list-index.sql
-- 2026-09-02. OPTIONAL. Not part of the agreed fixes 1 to 3.
--
-- Apply:
--   npx wrangler d1 execute giveready-db --remote --file=migrations/025d-optional-list-index.sql
--
-- Nothing in the Worker or in the other 025 files depends on this. Skip it
-- freely; it is here because it turned up while fixing the others.
--
-- handleListNonprofits orders by
--   verified DESC, beneficiaries_per_year DESC, id
-- and no existing index covers that, so SQLite sorts all 41,227 rows on every
-- call before applying LIMIT 20. Caching cannot help, because the sort is the
-- work. /api/nonprofits is also absent from the discovery-logged route list, so
-- its call volume has never been measured, which is exactly the condition under
-- which the /api/stats leak grew unnoticed.
--
-- Verified locally against a copy of the schema: the plan goes from a full sort
-- to `SCAN nonprofits USING INDEX idx_nonprofits_list_order`.
--
-- Cost: one index build over 41k rows. Reversible:
--   DROP INDEX idx_nonprofits_list_order;

CREATE INDEX IF NOT EXISTS idx_nonprofits_list_order
  ON nonprofits (verified DESC, beneficiaries_per_year DESC, id);
