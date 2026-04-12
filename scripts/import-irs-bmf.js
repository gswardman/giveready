#!/usr/bin/env node
/**
 * GiveReady — IRS Exempt Organizations Business Master File (BMF) Import
 *
 * Downloads state-by-state CSV files from the IRS, parses them,
 * and generates a migration SQL file to bulk-insert ~1.9M US nonprofits.
 *
 * The BMF CSV columns (pipe-delimited, no header):
 *   0:  EIN
 *   1:  NAME
 *   2:  ICO (In Care Of name)
 *   3:  STREET
 *   4:  CITY
 *   5:  STATE
 *   6:  ZIP
 *   7:  GROUP (group exemption number)
 *   8:  SUBSECTION (501(c) subsection code — 03 = 501(c)(3))
 *   9:  AFFILIATION
 *   10: CLASSIFICATION
 *   11: RULING (ruling date YYYYMM)
 *   12: DEDUCTIBILITY (1=contributions deductible)
 *   13: FOUNDATION (foundation code)
 *   14: ACTIVITY (activity codes, 9 digits)
 *   15: ORGANIZATION (org type: 1=corp, 2=trust, 3=co-op, 4=partnership, 5=assoc)
 *   16: STATUS (exempt status: 01=unconditional)
 *   17: TAX_PERIOD
 *   18: ASSET_CD (asset code 0-9)
 *   19: INCOME_CD (income code 0-9)
 *   20: FILING_REQ_CD
 *   21: PF_FILING_REQ_CD
 *   22: ACCT_PD (accounting period month)
 *   23: ASSET_AMT
 *   24: INCOME_AMT
 *   25: REVENUE_AMT
 *   26: NTEE_CD (NTEE classification code)
 *   27: SORT_NAME (sort-friendly name)
 *
 * We only import SUBSECTION = 03 (501(c)(3) public charities).
 * STATUS = 01 means unconditionally exempt (active).
 *
 * Usage:
 *   node scripts/import-irs-bmf.js
 *
 * Options:
 *   STATES=CA,NY,TX    — only import these states (default: all)
 *   DRY_RUN=1          — print stats but don't write SQL
 *   SKIP_EXISTING=1    — skip EINs already in the DB (default: 1)
 *
 * Output: migrations/007-irs-bmf-import.sql
 *
 * NOTE: Run from your Mac terminal (not sandbox). Downloads ~200MB total.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// ─── Config ─────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === '1';
const STATES_FILTER = process.env.STATES ? process.env.STATES.split(',').map(s => s.trim().toUpperCase()) : null;
const SKIP_EXISTING = process.env.SKIP_EXISTING !== '0'; // default true

// All US state + territory abbreviations used by IRS BMF files
const ALL_REGIONS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL',
  'GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY'
];

const regions = STATES_FILTER || ALL_REGIONS;

// IRS BMF CSV download URL pattern
// Files are at: https://www.irs.gov/pub/irs-soi/eo_{state}.csv
const BMF_URL = (state) => `https://www.irs.gov/pub/irs-soi/eo_${state.toLowerCase()}.csv`;

// ─── NTEE → GiveReady cause mapping ────────────────────────────

const NTEE_TO_CAUSE = {
  'A': 'creative-arts',       // Arts, Culture, Humanities
  'B': 'education',           // Education
  'C': 'environment',         // Environment
  'D': 'animals',             // Animal-Related
  'E': 'health',              // Health — General
  'F': 'mental-health',       // Mental Health
  'G': 'health',              // Diseases, Disorders, Medical Disciplines
  'H': 'health',              // Medical Research
  'I': 'legal-justice',       // Crime & Legal
  'J': 'food-security',       // Employment, Job Related (some overlap)
  'K': 'food-security',       // Food, Agriculture, Nutrition
  'L': 'housing',             // Housing, Shelter
  'M': 'health',              // Public Safety, Disaster Preparedness
  'N': 'sports-recreation',   // Recreation, Sports, Leisure
  'O': 'youth-empowerment',   // Youth Development
  'P': 'community-development', // Human Services — Multi-purpose
  'Q': 'science-research',    // International, Foreign Affairs
  'R': 'legal-justice',       // Civil Rights, Social Action
  'S': 'community-development', // Community Improvement
  'T': 'community-development', // Philanthropy, Voluntarism
  'U': 'science-research',    // Science & Technology
  'V': 'community-development', // Social Science Research
  'W': 'community-development', // Public, Society Benefit
  'X': 'religion',            // Religion Related
  'Y': 'community-development', // Mutual/Membership Benefit
  'Z': 'community-development', // Unknown/Unclassified
};

// US state abbreviation → full name
const STATE_NAMES = {
  'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
  'CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia',
  'FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois',
  'IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana',
  'ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota',
  'MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada',
  'NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York',
  'NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma',
  'OR':'Oregon','PA':'Pennsylvania','PR':'Puerto Rico','RI':'Rhode Island',
  'SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas',
  'UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia',
  'WI':'Wisconsin','WY':'Wyoming'
};

// ─── Helpers ────────────────────────────────────────────────────

function sanitize(str) {
  if (!str) return '';
  return str.replace(/'/g, "''").trim();
}

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'GiveReady/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Load existing IDs from cache ───────────────────────────────

function loadExistingIDs() {
  const cachePath = path.join(__dirname, '..', 'data', 'everyorg-cache.json');
  const existing = new Set();

  // Also check for a local existing-eins.json if we've exported from D1
  const einCachePath = path.join(__dirname, '..', 'data', 'existing-eins.json');
  if (fs.existsSync(einCachePath)) {
    const eins = JSON.parse(fs.readFileSync(einCachePath, 'utf8'));
    eins.forEach(e => existing.add(e));
    console.log(`  Loaded ${existing.size} existing EINs from cache`);
  }

  return existing;
}

// ─── Parse one CSV line ─────────────────────────────────────────

function parseBMFLine(line) {
  // IRS BMF files are comma-separated with some fields quoted
  // Simple CSV parse — handle quoted fields
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());

  if (fields.length < 27) return null;

  return {
    ein: fields[0],
    name: fields[1],
    ico: fields[2],
    street: fields[3],
    city: fields[4],
    state: fields[5],
    zip: fields[6],
    group: fields[7],
    subsection: fields[8],
    affiliation: fields[9],
    classification: fields[10],
    ruling: fields[11],
    deductibility: fields[12],
    foundation: fields[13],
    activity: fields[14],
    organization: fields[15],
    status: fields[16],
    taxPeriod: fields[17],
    assetCd: fields[18],
    incomeCd: fields[19],
    filingReqCd: fields[20],
    pfFilingReqCd: fields[21],
    acctPd: fields[22],
    assetAmt: fields[23],
    incomeAmt: fields[24],
    revenueAmt: fields[25],
    nteeCode: fields[26],
    sortName: fields[27] || '',
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  GiveReady — IRS BMF Import                   ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log(`States: ${regions.length === ALL_REGIONS.length ? 'ALL (' + ALL_REGIONS.length + ')' : regions.join(', ')}`);
  console.log(`DRY_RUN: ${DRY_RUN}\n`);

  const existingEINs = loadExistingIDs();
  const seenSlugs = new Set();
  const seenEINs = new Set();

  const sql = [
    '-- ════════════════════════════════════════════════════════════════',
    '-- GiveReady — IRS Business Master File Import',
    `-- Generated: ${new Date().toISOString()}`,
    `-- States: ${regions.join(', ')}`,
    '-- Source: IRS Exempt Organizations BMF (501(c)(3) only)',
    '-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/007-irs-bmf-import.sql',
    '-- ════════════════════════════════════════════════════════════════',
    '',
    'PRAGMA foreign_keys = OFF;',
    '',
  ];

  let totalParsed = 0;
  let total501c3 = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let stateStats = {};

  for (const state of regions) {
    const url = BMF_URL(state);
    console.log(`\n📥 Downloading ${state}...`);

    let csvData;
    try {
      csvData = await download(url);
    } catch (err) {
      console.log(`  ⚠️  Failed to download ${state}: ${err.message}`);
      continue;
    }

    const lines = csvData.split('\n').filter(l => l.trim());
    console.log(`  ${lines.length} rows`);

    let stateInserts = 0;
    let stateSkips = 0;

    for (const line of lines) {
      const row = parseBMFLine(line);
      if (!row) continue;

      totalParsed++;

      // Only 501(c)(3) public charities
      if (row.subsection !== '03') continue;

      // Only active (status 01 = unconditional exemption)
      if (row.status !== '01') continue;

      total501c3++;

      // Dedupe by EIN
      if (seenEINs.has(row.ein)) continue;
      seenEINs.add(row.ein);

      // Skip if already in DB
      const irsId = `irs-${row.ein}`;
      if (SKIP_EXISTING && existingEINs.has(row.ein)) {
        stateSkips++;
        totalSkipped++;
        continue;
      }

      // Generate unique slug
      const name = titleCase(row.name);
      let slug = generateSlug(name);
      if (!slug) slug = `org-${row.ein}`;

      let finalSlug = slug;
      let counter = 2;
      while (seenSlugs.has(finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }
      seenSlugs.add(finalSlug);

      // Map NTEE to cause
      const nteePrefix = row.nteeCode ? row.nteeCode.charAt(0).toUpperCase() : '';
      const cause = NTEE_TO_CAUSE[nteePrefix] || 'community-development';

      // Determine founded year from ruling date (YYYYMM)
      const foundedYear = row.ruling && row.ruling.length >= 4 ? parseInt(row.ruling.substring(0, 4)) : null;

      // Parse financials
      const revenue = row.revenueAmt ? parseInt(row.revenueAmt) : null;
      const assets = row.assetAmt ? parseInt(row.assetAmt) : null;

      // City in title case
      const city = titleCase(row.city);
      const region = row.state;

      // Generate SQL
      sql.push(`INSERT OR IGNORE INTO nonprofits (id, slug, name, country, city, region, founded_year, annual_budget_usd, verified, ghd_aligned) VALUES ('${irsId}', '${sanitize(finalSlug)}', '${sanitize(name)}', 'United States', '${sanitize(city)}', '${sanitize(region)}', ${foundedYear || 'NULL'}, ${revenue || 'NULL'}, 0, 0);`);
      sql.push(`INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES ('${irsId}-reg', '${irsId}', 'United States', '501(c)(3)', '${row.ein}');`);
      sql.push(`INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('${irsId}', '${cause}');`);

      stateInserts++;
      totalInserted++;
    }

    stateStats[state] = { rows: lines.length, inserts: stateInserts, skips: stateSkips };
    console.log(`  ✅ ${state}: ${stateInserts} inserted, ${stateSkips} skipped`);
  }

  // Close PRAGMA
  sql.push('');
  sql.push('PRAGMA foreign_keys = ON;');

  // Write SQL
  if (!DRY_RUN) {
    const outPath = path.join(__dirname, '..', 'migrations', '007-irs-bmf-import.sql');
    fs.writeFileSync(outPath, sql.join('\n'), 'utf8');
    console.log(`\n📄 SQL written to: ${outPath}`);
  }

  // Write stats cache
  const statsPath = path.join(__dirname, '..', 'data', 'irs-bmf-stats.json');
  const dataDir = path.dirname(statsPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(statsPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    states: regions,
    totalParsed,
    total501c3,
    totalInserted,
    totalSkipped,
    stateStats,
  }, null, 2), 'utf8');

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  DONE                                          ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`  Total rows parsed:    ${totalParsed.toLocaleString()}`);
  console.log(`  Active 501(c)(3):     ${total501c3.toLocaleString()}`);
  console.log(`  New inserts:          ${totalInserted.toLocaleString()}`);
  console.log(`  Skipped (existing):   ${totalSkipped.toLocaleString()}`);
  console.log(`  SQL statements:       ${sql.length.toLocaleString()}`);
  if (!DRY_RUN) {
    console.log(`\n  Next: npx wrangler d1 execute giveready-db --remote --file=migrations/007-irs-bmf-import.sql`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
