/**
 * GiveReady — Registry endpoints: EIN lookup, revocations, registration verification.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json, error } from '../lib/http.js';

/**
 * GET /api/registry/eins?cursor=&limit=
 *
 * Bulk join keys for the daily registry check. Deliberately thin: id, slug,
 * ein, country, current status. No mission text, no description.
 *
 * WHY THIS EXISTS (2026-08-27)
 * check-irs-revocations.js read EINs off /api/nonprofits, which does not return
 * the registrations array. Only the single-profile endpoint does. So the daily
 * job downloaded 77MB of IRS data every morning, parsed 1.2M revoked and 1.4M
 * exempt EINs correctly, then joined them against an empty list. Five runs,
 * zero matches, and it logged "no updates to apply" rather than an error. A
 * check that cannot fail loudly is not a check.
 *
 * TWO SOURCES FOR THE KEY, in this order:
 *   1. registrations.registration_number_normalised. The real record.
 *   2. nonprofits.id. The Every.org import minted IDs as 'every-<EIN>', so
 *      roughly 86% of the directory carries its EIN in the primary key.
 *      Confirmed on live records: every-460923905 has registration 460923905.
 * `ein_source` reports which path produced the value, so if assumption 2 is
 * ever wrong it is auditable rather than silent.
 *
 * ZERO PADDING. Migration 024 backfilled the normalised column with digits only
 * and did not pad. An EIN with a leading zero therefore sits at 8 characters
 * while the IRS files are 9 wide, and the join would miss it. Pad here.
 *
 * CONFLICTING EINs. A few records carry two different numbers (yescarolina has
 * both 203562766 and 461710691). MIN() picks one deterministically. That is a
 * data problem to fix upstream, not here, but a deterministic wrong answer is
 * at least reproducible.
 *
 * US REGISTRATIONS ONLY, and this matters. UK charity numbers are 6 to 8
 * digits: bridges-for-music carries 1154170, which pads to 001154170 and would
 * then be looked up in the IRS files as if it were an EIN. A chance collision
 * would publish a US tax status against a UK charity. Filter on the
 * registration's own country and type, never on digit length.
 */
export async function handleRegistryEins(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 5000);
  const cursor = url.searchParams.get('cursor') || '';

  const results = await db.prepare(`
    SELECT n.id, n.slug, n.country, n.registry_status,
           COALESCE(reg.ein, idein.ein) AS ein,
           CASE WHEN reg.ein IS NOT NULL THEN 'registrations'
                WHEN idein.ein IS NOT NULL THEN 'id_pattern'
                ELSE NULL END AS ein_source,
           -- Both raw values, always. Where a record has both, they should
           -- agree; every disagreement is a record where we would publish a tax
           -- status derived from a guess. Returning only the COALESCE would
           -- make that unmeasurable, which is how the original bug survived.
           reg.ein AS ein_registrations,
           idein.ein AS ein_id_pattern
      FROM nonprofits n
      LEFT JOIN (
        SELECT nonprofit_id,
               MIN(substr('000000000' || registration_number_normalised, -9, 9)) AS ein
          FROM registrations
         WHERE registration_number_normalised IS NOT NULL
           AND length(registration_number_normalised) BETWEEN 8 AND 9
           AND (country = 'United States' OR type LIKE '501(c)%')
         GROUP BY nonprofit_id
      ) reg ON reg.nonprofit_id = n.id
      LEFT JOIN (
        SELECT id AS nid, substr(id, 7) AS ein
          FROM nonprofits
         WHERE id GLOB 'every-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
      ) idein ON idein.nid = n.id
     WHERE n.id > ?1
       AND COALESCE(reg.ein, idein.ein) IS NOT NULL
     ORDER BY n.id
     LIMIT ?2
  `).bind(cursor, limit).all();

  const rows = results.results || [];
  return json({
    count: rows.length,
    next_cursor: rows.length === limit ? rows[rows.length - 1].id : null,
    nonprofits: rows,
  });
}

/**
 * GET /api/registry/revoked?limit=
 *
 * Organisations in this directory that appear on the IRS auto-revocation list,
 * with the evidence attached. Public and linkable on purpose: a list of
 * charities that lost tax-exempt status and are still listed as fine elsewhere
 * does not exist in this form anywhere else.
 *
 * 'revoked' and 'revoked_reinstated' are returned in SEPARATE arrays and must
 * stay separate. On the list AND back in the current exempt file is a fact
 * about the past. Merging the two would publish an accusation against a charity
 * that is currently in good standing, which is the exact failure migration 024
 * rule 2 exists to prevent.
 */
export async function handleRegistryRevoked(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 1000);

  const results = await db.prepare(`
    SELECT slug, name, country, registry_status, registry_status_source,
           registry_status_source_date, registry_status_checked_at,
           registry_revoked_at
      FROM nonprofits
     WHERE registry_status IN ('revoked', 'revoked_reinstated')
     ORDER BY registry_status, registry_revoked_at DESC, slug
     LIMIT ?1
  `).bind(limit).all();

  const rows = (results.results || []).map((r) => ({
    ...r,
    url: `https://www.giveready.org/nonprofits/${r.slug}`,
  }));

  return json({
    count: rows.length,
    revoked: rows.filter((r) => r.registry_status === 'revoked'),
    reinstated: rows.filter((r) => r.registry_status === 'revoked_reinstated'),
    notes: [
      'revoked = on the IRS auto-revocation list AND absent from the current Pub 78 exempt file.',
      'reinstated = on the list BUT present in the current exempt file. Currently exempt. Not a warning.',
      'The IRS leaves organisations on the revocation list after reinstatement, so list membership alone proves nothing.',
      'Organisations are never deleted from this directory. A flagged page with a date is more useful to an agent than a 404.',
    ],
  });
}

export async function handleVerifyRegistration(db, env, url) {
  const number = url.searchParams.get('number');
  const country = url.searchParams.get('country') || 'UK';

  if (!number) {
    return error('Missing registration number', 400);
  }

  if (country === 'UK') {
    try {
      // Try the free API endpoint
      const apiUrl = `https://api.charitycommission.gov.uk/register/api/SearchCharitiesByRegisteredCharityNumber/${encodeURIComponent(number)}/0`;
      const response = await fetch(apiUrl);

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const charity = data[0];
          return json({
            found: true,
            country: 'UK',
            name: charity.CharityName,
            status: charity.CharityStatus,
            registration_number: charity.RegisteredCharityNumber,
          });
        }
      }
    } catch (err) {
      console.error('Charity Commission API error:', err);
    }

    return json({
      found: false,
      country: 'UK',
      number,
    });
  }

  // For other countries
  return json({
    supported: false,
    country,
  });
}
