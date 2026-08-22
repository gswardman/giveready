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

async function loadDirectoryEins() {
  // Pull registrations from the public API rather than reading D1 directly, so
  // this script needs no database credentials and can run anywhere.
  const out = [];
  let page = 1;
  for (;;) {
    const url = `${API_BASE}/api/nonprofits?country=United%20States&limit=500&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`directory fetch failed: HTTP ${res.status}`);
    const body = await res.json();
    const rows = body.nonprofits || body.results || [];
    if (!rows.length) break;
    for (const np of rows) {
      const regs = np.registrations || [];
      for (const r of regs) {
        const ein = normaliseEin(r.registration_number);
        if (ein) out.push({ id: np.id, slug: np.slug, name: np.name, ein });
      }
    }
    if (rows.length < 500) break;
    page++;
  }
  return out;
}

function sqlEscape(s) { return String(s).replace(/'/g, "''"); }

(async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const revZip = path.join(DATA_DIR, 'revocation.zip');
  const p78Zip = path.join(DATA_DIR, 'pub78.zip');

  if (DO_FETCH) {
    console.log('Fetching IRS files...');
    await download(SOURCES.revocation, revZip);
    await download(SOURCES.pub78, p78Zip);
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
  console.log(`  ${dir.length.toLocaleString()} US registration numbers in the directory`);

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
  console.log(`  wrangler d1 execute giveready --remote --file=${path.relative(ROOT, OUT_SQL)}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
