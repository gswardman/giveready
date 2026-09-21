-- 028-wef-ein.sql
-- 2026-09-21. WEF US 501(c)(3) registration. EIN CONFIRMED against IRS source documents.
--
-- PROVENANCE, both read directly this session from the Powered by Finn vault:
--
--   1. IRS Notice CP575E, 2 June 2026 — EIN assignment.
--      "Your EIN is 42-2773838. The name control associated with this EIN is FINN."
--      Addressed to FINN WARDMAN WORLD EXPLORER FUND, % GREG MCRAY, 191 Sarles St,
--      Mount Kisco NY 10549.
--
--   2. IRS Letter 947 (Rev. 2-2020), 3 June 2026 — determination letter.
--      Addressed to FINN WARDMAN WORLD EXPLORER FUND INC, same address.
--      EIN 42-2773838. Exempt under IRC 501(c)(3).
--      Public charity status: 509(a)(2).
--      Effective date of exemption: 26 May 2026.
--      Contribution deductibility: Yes.
--      Form 990/990-EZ/990-N required: Yes. Accounting period ends 31 December.
--
-- The two documents disagree on "INC". The determination letter carries it, the EIN
-- notice does not, and 02-Foundation/.../WEF-org-identity.md transcribed it without.
-- The determination letter governs exempt status and is what feeds IRS Pub 78, so the
-- registration row below records the determination-letter form. The registry check
-- job matches on EIN, so the name variant does not affect it either way. A correction
-- has been written back to the Powered by Finn Corrections Log.
--
-- NOTE ON THE ADDRESS, for whoever reads this next: CP575E shows "% GREG MCRAY",
-- which is the Foundation Group filing firm, so 191 Sarles St is the filing agent's
-- address rather than an address WEF occupies. Migration 027 wrote Mount Kisco / NY
-- into the public profile. That is what the IRS holds, so it is not wrong, but it is
-- worth Geordie deciding whether the public directory should show it.
--
-- WHAT HAPPENS NEXT, and what must NOT happen:
-- Once this row exists the registry check job can match WEF against the IRS exempt
-- file and set registry_status on evidence. Do NOT hand-write 'good_standing'.
-- Migration 024 design rule 3: every status carries its evidence, a status with no
-- provenance is an opinion. Exemption was effective 26 May 2026, so WEF should appear
-- in current Pub 78 data; if the check returns not_found, that is a data or timing
-- question to investigate, not a reason to assert the status manually.
--
-- Idempotent.

INSERT OR REPLACE INTO registrations (
  id,
  nonprofit_id,
  country,
  type,
  registration_number,
  registration_number_normalised
) VALUES (
  'reg-finn-wardman-wef-us-501c3',
  'finn-wardman-wef',
  'United States',
  '501(c)(3) public charity, 509(a)(2)',
  '42-2773838',
  '422773838'
);

-- Mirror the number onto the nonprofit row so the registry job can find it.
UPDATE nonprofits
   SET registry_number = '42-2773838'
 WHERE id = 'finn-wardman-wef';
