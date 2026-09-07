#!/usr/bin/env node
/**
 * check-irs-revocations.js
 *
 * Joins the GiveReady directory against the IRS Auto-Revocation List and the
 * current Pub 78 exempt file, and emits SQL to update registry status.
 *
 * WHY THIS RUNS ON THE MAC AND NOT IN THE WORKER
 * The revocation list is tens of thousands of rows. Streaming, parsing and
 * diffing it against 41k directory records is filesystem work. Workers have CPU
 * and memory limits and D1 batch writes of that size from a Worker are painful.
 * Same reasoning as scripts/import-irs-bmf.js, which already lives here.
 * The Cowork sandbox cannot reach irs.gov at all, so this must run locally.
 *
 * THE FALSE-POSITIVE TRAP, READ BEFORE CHANGING THE LOGIC
 * The IRS leaves organisations on the Auto-Revocation List after they have been
 * reinstated. See irs.gov "Automatic Exemption Revocation for Nonfiling:
 * Organization Remains on List of Revoked Organizations After Reinstatement".
 * So list membership on its own is NOT proof of current revocation.
 *
 *   on revocation list AND absent from Pub 78  -> 'revoked'
 *   on revocation list AND present in Pub 78   -> 'revoked_reinstated'
 *   absent from list  AND present in Pub 78    -> 'good_standing'
 *   absent from both                            -> 'not_found'
 *
 * Calling a live charity revoked is worse than saying nothing. If the Pub 78
 * file is missing or fails to parse, this script REFUSES to emit any 'revoked'
 * status and exits non-zero. Degrading to "flag everything on the list" would
 * publish accusations against reinstated charities.
 *
 * USAGE
 *   node scripts/check-irs-revocations.js --fetch          download fresh files
 *   node scripts/check-irs-revocations.js --dry-run        report, write no SQL
 *   node scripts/check-irs-revocations.js                  report + emit SQL
 *
 * OUTPUT
 *   data/irs/revocation-updates.sql   apply with wrangler d1 execute
 *   stdout: a summary you can paste into the daily log
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'irs');
const OUT_SQL = path.join(DATA_DIR, 'revocation-updates.sql');

// IRS source files. Both are published by the IRS as bulk downloads.
// revocation list: name, EIN, address, revocation date, posting date.
// pub78: the current cumulative list of organisations eligible to receive
// tax-deductible contributions. Presence here is the reinstatement check.
const SOURCES = {
  revocation: 'https://apps.irs.gov/pub/epostcard/data-download-revocation.zip',
  pub78:      'https://apps.irs.gov/pub/epostcard/data-download-pub78.zip',
};

const API_BASE = process.env.GIVEREADY_API || 'https://www.giveready.org';

const args = process.argv.slice(2);
const DO_FETCH = args.includes('--fetch');
const DRY_RUN = args.includes('--dry-run');

/** Digits only, zero-padded to 9. Fixes '94-2961034' vs '942961034'. */
function normaliseEin(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 9) return null;      // not an EIN
  return digits.padStart(9, '0');
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'GiveReady/1.0 (+https://www.giveready.org)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlinkSync(dest);
        return reject(new Error(`${url} returned HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
  });
}

/**
 * The IRS ships these as zips containing pipe- or comma-delimited text.
 * Layout has changed before, so parse defensively: find the EIN column by
 * looking for the first 9-digit field rather than trusting a fixed index.
 */
function parseIrsFile(text) {
  const eins = new Map(); // normalisedEin -> { raw, fields }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.includes('|') ? line.split('|') : line.split(',');
    let ein = null;
    for (const f of fields) {
      const c = String(f).replace(/\D/g, '');
      if (c.length === 9) { ein = c; break; }
    }
    if (ein) eins.set(ein, { raw: line, fields });
  }
  return eins;
}

/**
 * Pull join keys from the public API rather than reading D1 directly, so this
 * script needs no database credentials and can run anywhere.
 *
 * REWRITTEN 2026-08-27. The previous version paged
 * /api/nonprofits?country=United States&limit=500&page=N and read
 * `np.registrations` off each row. Three things were wrong with that and all
 * three failed silently:
 *
 *   1. The list endpoint never returned `registrations`. Only the
 *      single-profile endpoint does. So the inner loop iterated an empty array
 *      on every row and this function returned [].
 *   2. `page` was ignored. page=1, page=5 and page=20 all returned the same
 *      first record.
 *   3. `limit=500` was capped at 100, so `rows.length < 500` broke the loop
 *      after one page regardless.
 *
 * Result: five consecutive daily runs downloaded 77MB of IRS data, parsed 1.2M
 * revoked and 1.4M exempt EINs correctly, joined them against nothing, and
 * logged "no updates to apply". The whole point of a daily check is that it
 * tells you when something is wrong, so the zero-key case now exits non-zero
 * instead of reporting a clean run.
 */
async function loadDirectoryEins() {
  const out = [];
  let cursor = '';
  let pages = 0;

  for (;;) {
    const url = `${API_BASE}/api/registry/eins?limit=1000`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url);

    if (res.status === 404) {
      // The endpoint ships with the Worker. If this script runs against a
      // deployment that predates it, say so plainly rather than falling back to
      // the broken path and reporting another clean zero.
      throw new Error(
        '/api/registry/eins returned 404. Deploy the Worker first '
        + '(scripts/apply-registry-fix-2026-08-27.py, then wrangler deploy).'
      );
    }
    if (!res.ok) throw new Error(`registry keys fetch failed: HTTP ${res.status}`);

    const body = await res.json();
    const rows = body.nonprofits || [];
    for (const r of rows) {
      // Trust the endpoint's padding but re-normalise anyway: if the column
      // format changes upstream, a silently unpadded key would just stop
      // matching and look like "no revocations found".
      const ein = normaliseEin(r.ein);
      if (ein) {
        out.push({ id: r.id, slug: r.slug, name: r.slug, ein, ein_source: r.ein_source });
      }
    }

    pages++;
    if (!body.next_cursor) break;
    cursor = body.next_cursor;
    if (pages > 200) throw new Error('registry keys paging exceeded 200 pages, refusing to loop');
  }

  return out;
}

/** download() with three attempts and 5s / 15s backoff. */
async function downloadWithRetry(url, dest, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await download(url, dest);
    } catch (e) {
      lastErr = e;
      if (i === attempts) break;
      const waitMs = i * 10000 - 5000;   // 5s, then 15s
      console.log(`  attempt ${i}/${attempts} failed (${e.message}), retrying in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function sqlEscape(s) { return String(s).replace(/'/g, "''"); }

(async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const revZip = path.join(DATA_DIR, 'revocation.zip');
  const p78Zip = path.join(DATA_DIR, 'pub78.zip');

  if (DO_FETCH) {
    console.log('Fetching IRS files...');
    // Retry with backoff (2026-08-27). Two of the first five daily runs died on
    // transient irs.gov errors, ECONNRESET on the 25th and ENOTFOUND on the
    // 26th, and each one failed the entire check. A flaky external download is
    // ordinary; treating the first failure as fatal is not.
    await downloadWithRetry(SOURCES.revocation, revZip);
    await downloadWithRetry(SOURCES.pub78, p78Zip);
    console.log('  downloaded');
  }

  for (const [label, f] of [['revocation', revZip], ['pub78', p78Zip]]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing ${label} file at ${f}. Run with --fetch first.`);
      process.exit(1);
    }
  }

  // Unzip. Node has no bundled zip reader, so shell out to the system unzip,
  // which macOS has. Kept explicit rather than adding a dependency.
  const { execFileSync } = require('child_process');
  execFileSync('unzip', ['-o', '-q', revZip, '-d', path.join(DATA_DIR, 'rev')]);
  execFileSync('unzip', ['-o', '-q', p78Zip, '-d', path.join(DATA_DIR, 'p78')]);

  const readAll = (dir) => fs.readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'latin1'))
    .join('\n');

  const revText = readAll(path.join(DATA_DIR, 'rev'));
  const p78Text = readAll(path.join(DATA_DIR, 'p78'));

  const revoked = parseIrsFile(revText);
  const exempt = parseIrsFile(p78Text);

  console.log(`IRS revocation list: ${revoked.size.toLocaleString()} EINs`);
  console.log(`IRS Pub 78 exempt:   ${exempt.size.toLocaleString()} EINs`);

  // SAFETY: refuse to run if pub78 looks broken. Without a working reinstatement
  // check, every reinstated charity on the list gets falsely flagged revoked.
  if (exempt.size < 100000) {
    console.error(`\nREFUSING TO PROCEED. Pub 78 parsed only ${exempt.size} EINs, expected >100,000.`);
    console.error('Without a working exempt file the reinstatement check cannot run, and every');
    console.error('reinstated charity on the revocation list would be falsely flagged revoked.');
    console.error('Fix the parse before emitting any status.');
    process.exit(2);
  }

  console.log('\nLoading GiveReady US registrations...');
  const dir = await loadDirectoryEins();
  const bySource = dir.reduce((a, r) => {
    a[r.ein_source || 'unknown'] = (a[r.ein_source || 'unknown'] || 0) + 1; return a;
  }, {});
  console.log(`  ${dir.length.toLocaleString()} US registration numbers in the directory`);
  console.log(`  by source: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);

  // SAFETY (2026-08-27): zero join keys is a broken pipeline, not a clean run.
  // This exact condition held for five days and read as "no updates to apply"
  // because nothing distinguished "nothing changed" from "nothing was checked".
  // Same rule as the Pub 78 exit above: refuse, do not degrade.
  if (dir.length === 0) {
    console.error('\nREFUSING TO PROCEED. 0 join keys returned by /api/registry/eins.');
    console.error('Expect roughly 35,000. Zero means the endpoint is missing, the response');
    console.error('shape changed, or the registrations backfill was rolled back.');
    console.error('An empty join produces an all-clear report, which is worse than no report.');
    process.exit(2);
  }

  const results = { revoked: [], revoked_reinstated: [], good_standing: [], not_found: [] };
  for (const row of dir) {
    const onRevList = revoked.has(row.ein);
    const inExempt = exempt.has(row.ein);
    let status;
    if (onRevList && !inExempt) status = 'revoked';
    else if (onRevList && inExempt) status = 'revoked_reinstated';
    else if (inExempt) status = 'good_standing';
    else status = 'not_found';
    results[status].push(row);
  }

  const total = dir.length || 1;
  console.log('\n=== RESULT ===');
  for (const k of ['revoked', 'revoked_reinstated', 'good_standing', 'not_found']) {
    const n = results[k].length;
    console.log(`  ${k.padEnd(20)} ${String(n).padStart(6)}  ${(n / total * 100).toFixed(1)}%`);
  }

  if (results.revoked.length) {
    console.log('\n=== REVOKED, sample of 10 ===');
    for (const r of results.revoked.slice(0, 10)) {
      console.log(`  ${r.ein}  ${r.name}  /nonprofits/${r.slug}`);
    }
  }

  if (DRY_RUN) { console.log('\n--dry-run: no SQL written.'); return; }

  const now = Math.floor(Date.now() / 1000);
  const srcDate = new Date().toISOString().slice(0, 10);
  const lines = [
    `-- Generated by check-irs-revocations.js on ${new Date().toISOString()}`,
    `-- revocation list: ${revoked.size} EINs, pub78: ${exempt.size} EINs`,
    `-- NEVER deletes. Flags only. See migrations/024 design rules.`,
    '',
  ];
  for (const [status, rows] of Object.entries(results)) {
    for (const r of rows) {
      lines.push(
        `UPDATE nonprofits SET registry_status='${status}', ` +
        `registry_status_source='irs_auto_revocation', ` +
        `registry_status_source_date='${srcDate}', ` +
        `registry_status_checked_at=${now} WHERE id='${sqlEscape(r.id)}';`
      );
      lines.push(
        `INSERT INTO registry_checks (nonprofit_id, registration_number_normalised, country, source, source_date, status, previous_status, changed, checked_at) ` +
        `SELECT '${sqlEscape(r.id)}','${r.ein}','United States','irs_auto_revocation','${srcDate}','${status}', registry_status, ` +
        `CASE WHEN registry_status='${status}' THEN 0 ELSE 1 END, ${now} FROM nonprofits WHERE id='${sqlEscape(r.id)}';`
      );
    }
  }
  fs.writeFileSync(OUT_SQL, lines.join('\n'));
  console.log(`\nWrote ${OUT_SQL} (${lines.length} statements)`);
  console.log('Apply with:');
  console.log(`  wrangler d1 execute giveready-db --remote --file=${path.relative(ROOT, OUT_SQL)}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
