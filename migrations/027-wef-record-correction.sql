-- 027-wef-record-correction.sql
-- 2026-09-21. Correct the Finn Wardman World Explorer Fund record.
--
-- WHY
-- WEF has been filed in this directory as a Bermudian entity holding an endowment
-- at the Bermuda Community Foundation. Both facts are stale:
--
--   * The vault Corrections Log entry of 2026-06-16 (the top authority in that
--     vault) records that WEF holds granted US 501(c)(3) status, an EIN, a
--     Mercury bank account and its own Stripe account. That entry explicitly
--     supersedes the earlier "unincorporated private grant-making fund
--     established in Bermuda" phrasing.
--   * The Bermuda Community Foundation relationship was terminated. BCF told the
--     fund it was a good fit and reversed that position once they understood the
--     grant-making model. Publishing it as a current endowment relationship is
--     wrong and is unfair to BCF as much as to WEF.
--
-- WHAT IT WAS COSTING
-- Because country = 'Bermuda' and Bermuda publishes no machine-readable charity
-- registry, WEF resolved to registry_status = 'unsupported_country', which carries
-- safe_to_recommend = false. The directory was telling every agent that read the
-- WEF profile that WEF was not safe to recommend. On the 30 days to 2026-09-21
-- agent traffic read nonprofit records 7,161 times. A donor agent running the
-- ordinary check order — recipient exists, wallet control proven, recipient-to-
-- wallet linkage, then need — would fail WEF at the first check and never say so.
-- That is the most plausible reason WEF has never received a non-operator gift,
-- and it is a data defect, not a payments problem.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- It does not set registry_status to 'good_standing'. Per design rule 3 of
-- migration 024, every status carries its evidence, and a status with no
-- provenance is an opinion. good_standing means "present in the current IRS Pub 78
-- exempt file" and must be earned by the registry check job, not asserted by hand.
-- This migration resets the status to 'unchecked' with null provenance, which is
-- the honest value until that job runs against a confirmed EIN.
--
-- It also does not write the EIN. EIN 42-2773838 appears in
-- 01-Projects/WEF/2026-07-30-wef-nonprofit-ads-account-setup-chrome-prompt.md but
-- could not be confirmed against the IRS Tax Exempt Organization Search from this
-- session. A wrong EIN on a public charity directory is worse than a null one, and
-- it would drive an automated registry check to a false answer. The EIN insert is
-- staged at migrations/_pending/028-wef-ein.sql and moves into migrations/ once
-- Geordie has checked it against the determination letter.
--
-- Idempotent: deploy.sh runs every file in migrations/ on every deploy.

-- 1. Geography. The operating entity is the US 501(c)(3).
UPDATE nonprofits
   SET country = 'United States',
       city    = 'Mount Kisco',
       region  = 'NY'
 WHERE id = 'finn-wardman-wef';

-- 2. Remove the terminated BCF endowment claim from the public description.
--    Targeted replace rather than a full rewrite: the rest of this description is
--    Geordie's own words about his son and is not ours to edit.
UPDATE nonprofits
   SET description = REPLACE(
         description,
         'Based in Bermuda with an endowment at the Bermuda Community Foundation, the WEF awards grants to young people for adventure travel and cultural exploration.',
         'A registered US 501(c)(3), the WEF awards grants to young people aged 18 to 26 for adventure travel and cultural exploration.'
       )
 WHERE id = 'finn-wardman-wef'
   AND description LIKE '%Bermuda Community Foundation%';

-- 3. Drop the false registration row. The fund holds no Bermuda registration:
--    the Registry General denied the public charity application in Feb 2024 and
--    confirmed in May 2026 that public charity status is not available to it.
DELETE FROM registrations
 WHERE nonprofit_id = 'finn-wardman-wef'
   AND type = 'Endowed Fund (via Bermuda Community Foundation)';

-- 4. Reset registry standing to unchecked with null provenance. Not a pass.
--    Per the agent-facing rules in src/index.js: "unchecked is NOT a pass.
--    Absence of a check means we do not know."
UPDATE nonprofits
   SET registry_status             = 'unchecked',
       registry_status_source      = NULL,
       registry_status_source_date = NULL,
       registry_status_checked_at  = NULL
 WHERE id = 'finn-wardman-wef'
   AND registry_status = 'unsupported_country';
