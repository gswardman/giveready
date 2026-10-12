/**
 * GiveReady — GET /api/nonprofits/<slug>: the full nonprofit profile.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json, error } from '../lib/http.js';

// Helper: modify handleGetNonprofit to support preview mode
export async function handleGetNonprofit(db, slug, allowPreview = false) {
  const nonprofit = await db.prepare(`SELECT * FROM nonprofits WHERE slug = ?1`).bind(slug).first();

  if (!nonprofit) {
    return error('Nonprofit not found', 404);
  }

  // Get causes
  const causes = await db.prepare(`
    SELECT c.id, c.name, c.description
    FROM causes c
    JOIN nonprofit_causes nc ON c.id = nc.cause_id
    WHERE nc.nonprofit_id = ?1
  `).bind(nonprofit.id).all();

  // Get programs
  const programs = await db.prepare(
    `SELECT name, description, beneficiaries_per_year, location FROM programs WHERE nonprofit_id = ?1`
  ).bind(nonprofit.id).all();

  // Get impact metrics
  const impact = await db.prepare(
    `SELECT name, value, unit, period, year FROM impact_metrics WHERE nonprofit_id = ?1 ORDER BY year DESC`
  ).bind(nonprofit.id).all();

  // Get registrations
  const registrations = await db.prepare(
    `SELECT country, type, registration_number FROM registrations WHERE nonprofit_id = ?1`
  ).bind(nonprofit.id).all();

  // Fingerprint: which agents have contributed applied enrichments to this profile.
  // Public credit for agents that pushed the profile forward.
  const enrichedBy = await db.prepare(
    `SELECT agent_name, field, reviewed_at
     FROM agent_enrichments
     WHERE nonprofit_id = ?1 AND status = 'applied'
     ORDER BY reviewed_at DESC LIMIT 20`
  ).bind(nonprofit.id).all();

  // Registry standing (added 2026-08-22, migration 024).
  //
  // This block is the product. An agent recommending a charity carries real
  // liability if that charity has lost its tax-exempt status, and the raters do
  // not cover this long tail. So every status ships WITH its evidence: which
  // registry said so, the publication date of the file, and when we checked.
  // A status with no provenance is an opinion.
  //
  // 'unchecked' is deliberately not falsy-clean. Callers must not read absence
  // of a check as a pass. See migration 024 design rule 4.
  //
  // HISTORY (added 2026-08-22, Geordie's call). A revoked charity that files its
  // outstanding returns can be reinstated, and roughly that is the point of the
  // revocation regime: it is a prod, not a death sentence. A directory that
  // shows only current status treats a recovered charity the same as one that
  // never lapsed, and treats a lapse as permanent. Both are wrong.
  //
  // So every status CHANGE is kept and published. An agent reading this profile
  // can see that the organisation lapsed in 2024, fixed it in 2026, and has been
  // clean since. That is a better basis for a recommendation than a single flag,
  // and it is the thing a rater cannot give you.
  const statusHistory = await db.prepare(
    `SELECT status, previous_status, source, source_date, checked_at, detail
       FROM registry_checks
      WHERE nonprofit_id = ?1 AND changed = 1
      ORDER BY checked_at ASC LIMIT 50`
  ).bind(nonprofit.id).all();

  const history = (statusHistory.results || []).map((h) => ({
    ...h,
    transition: describeTransition(h.previous_status, h.status),
  }));

  // Has this organisation come back from a revocation at any point?
  const reinstated = history.some(
    (h) => h.previous_status === 'revoked' && h.status === 'good_standing'
  );

  const registryStatus = {
    status: nonprofit.registry_status || 'unchecked',
    source: nonprofit.registry_status_source || null,
    source_date: nonprofit.registry_status_source_date || null,
    checked_at: nonprofit.registry_status_checked_at || null,
    revoked_at: nonprofit.registry_revoked_at || null,
    safe_to_recommend: nonprofit.registry_status === 'good_standing',
    note: registryStatusNote(nonprofit.registry_status),
    previously_revoked: reinstated || nonprofit.registry_status === 'revoked_reinstated',
    history,
  };

  return json({
    ...nonprofit,
    causes: causes.results,
    programs: programs.results,
    impact_metrics: impact.results,
    registrations: registrations.results,
    enriched_by: enrichedBy.results,
    registry_status: registryStatus,
  });
}

// Plain-language description of a status CHANGE, written for an agent that will
// quote it to a human. The comeback case is the one that matters most: it is the
// difference between "this charity was struck off" and "this charity had a
// filing lapse and fixed it", which are very different recommendations.
export function describeTransition(from, to) {
  if (!from || from === 'unchecked') {
    return `First registry check recorded this organisation as ${to}.`;
  }
  if (from === 'revoked' && to === 'good_standing') {
    return 'Reinstated. This organisation had lost tax-exempt status and has since '
      + 'been restored to the current IRS exempt file, which normally means the '
      + 'outstanding returns were filed. Safe to recommend again as of this date.';
  }
  if (from === 'revoked' && to === 'revoked_reinstated') {
    return 'Reinstated, though the IRS has left the organisation on the Auto-Revocation '
      + 'List, which it does not clear after reinstatement.';
  }
  if (to === 'revoked') {
    return 'Lost tax-exempt status. Absent from the current IRS exempt file and present '
      + 'on the Auto-Revocation List. Donations may no longer be tax-deductible.';
  }
  if (from === 'not_found' && to === 'good_standing') {
    return 'Now matched to a registry record. The earlier non-match was most likely a '
      + 'data problem on our side rather than anything about the organisation.';
  }
  return `Registry standing changed from ${from} to ${to}.`;
}

// Plain-language gloss per status, so an agent does not have to infer meaning
// from an enum. Written for a machine reader that will quote it to a human.
function registryStatusNote(status) {
  switch (status) {
    case 'good_standing':
      return 'Found in the current IRS Pub 78 exempt file on the stated source date.';
    case 'revoked':
      return 'On the IRS Auto-Revocation List and absent from the current exempt file. Tax-exempt status appears to have been revoked for failure to file Form 990 for three consecutive years. Donations may not be tax-deductible. Verify directly with the IRS before recommending.';
    case 'revoked_reinstated':
      return 'Appears on the IRS Auto-Revocation List but is present in the current exempt file, which usually means the organisation was revoked and later reinstated. The IRS does not remove reinstated organisations from the list. Treat as in good standing but note the history.';
    case 'not_found':
      return 'A registration number is on file but no match was found in the registry. This may be a data-entry error on our side rather than a problem with the organisation.';
    case 'no_registration':
      return 'No registration number on file, so no registry check has been possible.';
    case 'unsupported_country':
      return 'This jurisdiction publishes no machine-readable charity registry we can check against.';
    default:
      return 'Never checked against a registry. Absence of a check is not a pass.';
  }
}
