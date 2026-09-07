#!/usr/bin/env node
/**
 * audit-ein-sources.js
 *
 * READ ONLY. Fetches every join key from /api/registry/eins and reports whether
 * the two EIN sources agree. Writes nothing, touches no database.
 *
 * WHY THIS EXISTS
 * The registry check derives an EIN two ways: from the `registrations` table,
 * and from the `nonprofits.id` where the Every.org import minted it as
 * 'every-<EIN>'. The second is an inference. Roughly 86% of the directory
 * depends on it.
 *
 * If that inference is wrong for some slice of records, the daily check will
 * publish a US tax status against the wrong organisation. Migration 024 rule:
 * calling a live charity revoked is worse than saying nothing. So the inference
 * gets measured before it gets trusted.
 *
 * The measurement is free. Where a record carries BOTH an id-derived EIN and a
 * real registrations EIN, the two should be identical. The agreement rate on
 * that overlap is the confidence figure for the ~30,000 records that only have
 * the inference.
 *
 * USAGE
 *   node scripts/audit-ein-sources.js
 *   node scripts/audit-ein-sources.js --json > /tmp/ein-audit.json
 *
 * EXIT CODES
 *   0  agreement >= 99% on the overlap
 *   1  fetch failed
 *   3  agreement < 99%, or zero overlap to measure. Do NOT apply a check run
 *      until this is understood.
 */

'use strict';

const API_BASE = process.env.GIVEREADY_API || 'https://www.giveready.org';
const AS_JSON = process.argv.includes('--json');
const THRESHOLD = 0.99;

async function fetchAll() {
  const rows = [];
  let cursor = '';
  let pages = 0;
  for (;;) {
    const url = `${API_BASE}/api/registry/eins?limit=1000`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url);
    if (res.status === 404) {
      throw new Error('/api/registry/eins returned 404. Deploy the Worker first.');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const body = await res.json();
    rows.push(...(body.nonprofits || []));
    pages++;
    if (!body.next_cursor) break;
    cursor = body.next_cursor;
    if (pages > 200) throw new Error('paging exceeded 200 pages, refusing to loop');
  }
  return rows;
}

(async function main() {
  let rows;
  try {
    rows = await fetchAll();
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    process.exit(1);
  }

  const bySource = {};
  const both = [];
  const disagree = [];

  for (const r of rows) {
    bySource[r.ein_source || 'none'] = (bySource[r.ein_source || 'none'] || 0) + 1;
    if (r.ein_registrations && r.ein_id_pattern) {
      both.push(r);
      if (r.ein_registrations !== r.ein_id_pattern) disagree.push(r);
    }
  }

  const overlap = both.length;
  const agree = overlap - disagree.length;
  const rate = overlap ? agree / overlap : 0;

  if (AS_JSON) {
    console.log(JSON.stringify({
      total: rows.length,
      by_source: bySource,
      overlap,
      agree,
      disagree: disagree.length,
      agreement_rate: rate,
      threshold: THRESHOLD,
      examples: disagree.slice(0, 50),
    }, null, 2));
  } else {
    console.log(`Total join keys:        ${rows.length.toLocaleString()}`);
    console.log(`By source:              ${Object.entries(bySource).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(', ')}`);
    console.log(`Records with both:      ${overlap.toLocaleString()}`);
    console.log(`  agree:                ${agree.toLocaleString()}`);
    console.log(`  disagree:             ${disagree.length.toLocaleString()}`);
    console.log(`Agreement rate:         ${(rate * 100).toFixed(2)}%  (threshold ${(THRESHOLD * 100).toFixed(0)}%)`);
    if (disagree.length) {
      console.log('\nFirst 20 disagreements (registrations vs id-derived):');
      for (const d of disagree.slice(0, 20)) {
        console.log(`  ${d.slug}\n    registrations ${d.ein_registrations}   id ${d.ein_id_pattern}`);
      }
    }
  }

  if (!overlap) {
    console.error('\nNO OVERLAP TO MEASURE. The id-pattern inference is unvalidated.');
    console.error('Do not apply a registry check run until this is understood.');
    process.exit(3);
  }
  if (rate < THRESHOLD) {
    console.error(`\nAGREEMENT BELOW THRESHOLD. The id-pattern inference is wrong for ${disagree.length} of ${overlap}`);
    console.error('measurable records, and it is the only key available for the rest.');
    console.error('Applying a check run would publish a tax status derived from a bad guess.');
    process.exit(3);
  }
  console.log('\nOK. The id-pattern inference holds on the measurable overlap.');
})();
