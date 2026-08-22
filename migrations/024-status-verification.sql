-- 024-status-verification.sql
-- 2026-08-22. Registry status tracking: is this charity still in good standing?
--
-- WHY
-- The directory was seeded from an IRS Business Master File snapshot. A snapshot
-- is a photograph. The IRS revokes roughly 28,000 organisations a year for
-- failing to file Form 990 for three consecutive years, and publishes the
-- Auto-Revocation List monthly. Some number of the US records in this directory
-- have lost 501(c)(3) status since import and the pages still present them as
-- fine. Agent traffic reads nonprofit records ~10,192 times per 30 days, so the
-- staleness is being served, not sitting idle.
--
-- DESIGN RULES, do not weaken these:
--
-- 1. NEVER DELETE A REVOKED ORG. Flag it, keep the page, keep the URL alive.
--    Deleting destroys the audit trail and breaks links agents already hold.
--    A page that says "this charity lost tax-exempt status on DATE" is more
--    useful to an agent than a 404.
--
-- 2. PRESENCE ON THE REVOCATION LIST IS NOT PROOF OF CURRENT REVOCATION.
--    The IRS leaves organisations on the list after they are reinstated
--    (irs.gov: "Organization Remains on List of Revoked Organizations After
--    Reinstatement"). So list membership alone gives false positives. The
--    honest test is: on the revocation list AND absent from the current Pub 78 /
--    BMF exempt file. Anything on the list but still exempt is
--    'revoked_reinstated', which is a data point, not an accusation.
--
-- 3. EVERY STATUS CARRIES ITS EVIDENCE. source, source_date, checked_at.
--    A status with no provenance is an opinion. This is the whole product.
--
-- 4. UNCHECKED IS NOT CLEAN. Default status is 'unchecked', never 'good'.
--    Absence of a check must never render as a pass. That failure mode has
--    already cost this project twice (2026-08-13 false 0/10, 2026-08-22
--    cardinality bias), and here it would mean vouching for a dead charity.
--
-- Apply:
--   wrangler d1 execute giveready --remote --file=migrations/024-status-verification.sql

-- Normalised join key. The directory currently stores the same EIN in multiple
-- formats: friends-for-youth carries both '942961034' and '94-2961034'. Digits
-- only, zero-padded to 9, so the join actually lands.
ALTER TABLE registrations ADD COLUMN registration_number_normalised TEXT;

CREATE INDEX IF NOT EXISTS idx_registrations_normalised
  ON registrations (registration_number_normalised);

-- Current registry standing, one row per nonprofit.
ALTER TABLE nonprofits ADD COLUMN registry_status TEXT DEFAULT 'unchecked';
  -- 'unchecked'           never checked against a registry. THE DEFAULT.
  -- 'good_standing'       found in the current exempt file on the stated date
  -- 'revoked'             on the revocation list AND absent from the exempt file
  -- 'revoked_reinstated'  on the revocation list BUT present in the exempt file
  -- 'not_found'           registration number present but no registry match
  -- 'no_registration'     no registration number to check
  -- 'unsupported_country' no machine-readable registry (e.g. South Africa)

ALTER TABLE nonprofits ADD COLUMN registry_status_source TEXT;
ALTER TABLE nonprofits ADD COLUMN registry_status_source_date TEXT;
ALTER TABLE nonprofits ADD COLUMN registry_status_checked_at INTEGER;
ALTER TABLE nonprofits ADD COLUMN registry_revoked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_nonprofits_registry_status
  ON nonprofits (registry_status);
CREATE INDEX IF NOT EXISTS idx_nonprofits_status_checked
  ON nonprofits (registry_status_checked_at);

-- Append-only history. Every check writes a row, including no-change results.
-- Without this you cannot answer "when did this charity go bad" or "how stale is
-- our freshness claim", which is the thing being sold.
CREATE TABLE IF NOT EXISTS registry_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nonprofit_id TEXT NOT NULL,
  registration_number_normalised TEXT,
  country TEXT,
  source TEXT NOT NULL,              -- 'irs_auto_revocation', 'irs_pub78', 'uk_charity_commission'
  source_date TEXT,                  -- publication date of the registry file itself
  status TEXT NOT NULL,
  previous_status TEXT,
  changed INTEGER DEFAULT 0,         -- 1 when status differs from previous
  detail TEXT,
  checked_at INTEGER NOT NULL,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);

CREATE INDEX IF NOT EXISTS idx_registry_checks_np ON registry_checks (nonprofit_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_registry_checks_changed ON registry_checks (changed, checked_at);

-- Backfill the normalised column for existing rows. Digits only.
-- SQLite has no regex, so this is nested replace() for the characters actually
-- seen in the data: hyphen, space, dot.
UPDATE registrations
   SET registration_number_normalised =
       replace(replace(replace(registration_number, '-', ''), ' ', ''), '.', '')
 WHERE registration_number IS NOT NULL AND registration_number <> '';

-- Countries with no machine-readable registry get their honest status now,
-- rather than sitting in 'unchecked' forever and looking like a backlog.
UPDATE nonprofits
   SET registry_status = 'unsupported_country'
 WHERE country IS NOT NULL
   AND country NOT IN ('United States', 'United Kingdom');
