#!/usr/bin/env node
/**
 * GiveReady — Maximum every.org Enrichment
 *
 * Pulls ALL youth-adjacent nonprofits from every.org, fetches full details
 * for each one, and generates migration SQL with:
 *   - Full descriptions (short + long)
 *   - Location (city, region, country)
 *   - Website URLs
 *   - Logo URLs (Cloudinary)
 *   - EIN + 501(c)(3) registrations
 *   - NTEE classification codes
 *   - Cause mappings
 *   - every.org donation URLs as fallback
 *
 * The goal: make GiveReady's /api/search endpoint return rich, useful data
 * so AI agents that are already crawling us get real value and come back.
 *
 * Usage:
 *   EVERYORG_API_KEY=pk_live_xxx node scripts/enrich-from-everyorg.js
 *
 * Options:
 *   MAX_PAGES=50       — max pages per cause (default: 50 = 2,500 per cause)
 *   MAX_DETAILS=1000   — max detail fetches (default: 1000)
 *   DRY_RUN=1          — print stats but don't write SQL
 *
 * Output: migrations/004-everyorg-bulk-enrich.sql
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.EVERYORG_API_KEY;
if (!API_KEY) {
  console.error('ERROR: Set EVERYORG_API_KEY environment variable');
  console.error('Get a free key at https://www.every.org/charity-api');
  process.exit(1);
}

const BASE_URL = 'https://partners.every.org/v0.2';
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '50', 10);
const MAX_DETAILS = parseInt(process.env.MAX_DETAILS || '1000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

// Wide infrastructure: pull ALL cause areas from every.org
// Agent layer = broad (any nonprofit, any cause — maximum utility for AI agents)
// Human layer = narrow (youth nonprofits prove the donation pipeline works)
// This is the B2A thesis: wide infra, narrow proof-of-concept
const CAUSES = [
  'youth',          // 1,815 — core vertical
  'mental-health',  // 915
  'education',      // 10,000+
  'music',          // 10,000+
  'art',            // 1,744
  'athletics',      // 10,000+
  'dance',          // 3,032
  'libraries',      // 2,227
  'housing',        // 10,000+
  'food-security',  // 762
  'poverty',        // 1,096
  'disability',     // ?
  'veterans',       // 252
  'racial-justice', // 371
  'immigration',    // ?
  'LGBTQ',          // ?
  'environment',    // broad
  'climate',        // broad
  'animals',        // broad
  'health',         // broad
  'science',        // broad
  'research',       // broad
  'religion',       // broad
  'women-led',      // broad
  'indigenous-peoples', // broad
  'refugees',       // broad
  'conservation',   // broad
  'ocean',          // broad
  'wildlife',       // broad
  'parks',          // broad
  'voting-rights',  // broad
  'free-press',     // broad
  'legal',          // broad
  'justice',        // broad
  'seniors',        // broad
  'cancer',         // broad
  'water',          // broad
  'gender-equality', // broad
];

// Rate limiting: 500 req/min for browse, 100 req/min for details
const BROWSE_DELAY_MS = 130;   // ~460/min, safely under 500
const DETAIL_DELAY_MS = 650;   // ~92/min, safely under 100

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function escSQL(str) {
  if (!str) return '';
  return str.replace(/'/g, "''").replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      console.warn('  Rate limited — waiting 30s...');
      await sleep(30000);
      const retry = await fetch(url);
      if (!retry.ok) return null;
      return retry.json();
    }
    if (!res.ok) {
      console.error(`  HTTP ${res.status} for ${url.replace(API_KEY, 'pk_***')}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error(`  Fetch error: ${err.message}`);
    return null;
  }
}

/**
 * Get full nonprofit details by slug or EIN
 */
async function getNonprofitDetails(identifier) {
  const url = `${BASE_URL}/nonprofit/${identifier}?apiKey=${API_KEY}`;
  return fetchJSON(url);
}

// ─── Load existing GiveReady data ───────────────────────────────────

function loadExistingIDs() {
  const ids = new Set();

  // From unclaimed CSV (these are already in D1)
  const csvPath = path.join(__dirname, '..', 'unclaimed-nonprofits.csv');
  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols[1]) ids.add(cols[1].trim());  // slug
    }
  }

  // From enrichment SQL (EIN-based IDs)
  const enrichPath = path.join(__dirname, '..', 'enrich-nonprofits.sql');
  if (fs.existsSync(enrichPath)) {
    const content = fs.readFileSync(enrichPath, 'utf8');
    const matches = content.match(/every-\d+/g);
    if (matches) matches.forEach(m => ids.add(m));
  }

  // Seed data
  ['bridges-for-music', 'the-wave-project', 'finn-wardman-world-explorer-fund', 'city-kids-surfing']
    .forEach(s => ids.add(s));

  console.log(`Loaded ${ids.size} existing IDs/slugs from GiveReady\n`);
  return ids;
}

// ─── Cause mapping ──────────────────────────────────────────────────

// GiveReady cause IDs — expanded for wide infrastructure
const GIVEREADY_CAUSES = new Set([
  'youth-empowerment', 'music-education', 'adventure-travel', 'mental-health',
  'surf-therapy', 'entrepreneurship', 'poverty-reduction', 'creative-arts',
  'education', 'community-development', 'peer-support',
  // New broad causes for infrastructure play
  'environment', 'health', 'animals', 'housing', 'food-security',
  'disability', 'veterans', 'racial-justice', 'immigration', 'lgbtq',
  'science-research', 'religion', 'gender-equality', 'refugees',
  'sports-recreation', 'legal-justice', 'seniors', 'water-sanitation',
]);

// Map every.org tags → GiveReady cause IDs
const CAUSE_MAP = {
  'youth': 'youth-empowerment',
  'mental-health': 'mental-health',
  'education': 'education',
  'health': 'health',
  'poverty': 'poverty-reduction',
  'music': 'music-education',
  'art': 'creative-arts',
  'culture': 'creative-arts',
  'dance': 'creative-arts',
  'athletics': 'sports-recreation',
  'libraries': 'education',
  'housing': 'housing',
  'food-security': 'food-security',
  'disability': 'disability',
  'veterans': 'veterans',
  'racial-justice': 'racial-justice',
  'immigration': 'immigration',
  'lgbtq': 'lgbtq',
  'film-and-tv': 'creative-arts',
  'museums': 'education',
  'science': 'science-research',
  'research': 'science-research',
  'environment': 'environment',
  'climate': 'environment',
  'animals': 'animals',
  'conservation': 'environment',
  'ocean': 'environment',
  'wildlife': 'animals',
  'parks': 'environment',
  'water': 'water-sanitation',
  'religion': 'religion',
  'women-led': 'gender-equality',
  'gender-equality': 'gender-equality',
  'indigenous-peoples': 'community-development',
  'refugees': 'refugees',
  'voting-rights': 'legal-justice',
  'free-press': 'legal-justice',
  'legal': 'legal-justice',
  'justice': 'legal-justice',
  'seniors': 'seniors',
  'cancer': 'health',
  'disease': 'health',
  'autism': 'health',
};

// New causes we'll add if we see them enough
const NEW_CAUSES = {
  'sports-recreation': { name: 'Sports & Recreation', description: 'Youth athletics, sports programmes, and physical activity' },
  'literacy': { name: 'Literacy', description: 'Reading, writing, and literacy programmes for young people' },
  'stem': { name: 'STEM Education', description: 'Science, technology, engineering, and maths programmes for youth' },
  'mentoring': { name: 'Mentoring', description: 'Youth mentoring, coaching, and adult-youth relationship programmes' },
  'workforce-development': { name: 'Workforce Development', description: 'Job training, career readiness, and employment programmes for young people' },
};

function mapCauses(everyorgTags, sourceCause) {
  const causes = new Set();

  // Always include the source browse cause
  const mapped = CAUSE_MAP[sourceCause];
  if (mapped) causes.add(mapped);

  // Map every.org tags
  for (const tag of everyorgTags) {
    const key = tag.toLowerCase().trim();
    if (CAUSE_MAP[key]) causes.add(CAUSE_MAP[key]);
  }

  // Default: if no causes mapped, tag as community-development (generic fallback)
  if (causes.size === 0) causes.add('community-development');

  return [...causes];
}

// ─── NTEE code parsing ──────────────────────────────────────────────

function parseNTEE(nteeCode, nteeMeaning) {
  // NTEE codes starting with O = Youth Development
  // B = Education, F = Mental Health, A = Arts
  if (!nteeCode) return null;
  return {
    code: nteeCode,
    meaning: nteeMeaning || nteeCode,
    isYouthFocused: nteeCode.startsWith('O') || nteeCode.startsWith('o'),
    isEducation: nteeCode.startsWith('B') || nteeCode.startsWith('b'),
    isMentalHealth: nteeCode.startsWith('F') || nteeCode.startsWith('f'),
    isArts: nteeCode.startsWith('A') || nteeCode.startsWith('a'),
  };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  GiveReady — Maximum every.org Enrichment ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Config: MAX_PAGES=${MAX_PAGES}, MAX_DETAILS=${MAX_DETAILS}, DRY_RUN=${DRY_RUN}`);
  console.log(`Causes: ${CAUSES.join(', ')}\n`);

  const existingIDs = loadExistingIDs();

  // ── Phase 1: Browse all causes ────────────────────────────────────
  console.log('PHASE 1: Browse every.org causes\n');

  const seen = new Set();
  const allNonprofits = [];
  const causeStats = {};

  for (const cause of CAUSES) {
    let causeCount = 0;
    let totalForCause = '?';

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE_URL}/browse/${cause}?apiKey=${API_KEY}&take=50&page=${page}`;
      const data = await fetchJSON(url);
      if (!data || !data.nonprofits || data.nonprofits.length === 0) break;

      if (page === 1 && data.pagination) {
        totalForCause = data.pagination.total_results;
        console.log(`  ${cause}: ${totalForCause} total nonprofits (fetching up to ${MAX_PAGES * 50})`);
      }

      for (const np of data.nonprofits) {
        const key = np.ein || np.slug || np.name;
        if (!seen.has(key)) {
          seen.add(key);
          allNonprofits.push({ ...np, sourceCause: cause });
          causeCount++;
        }
      }

      await sleep(BROWSE_DELAY_MS);

      if (data.pagination && page >= data.pagination.pages) break;
    }

    causeStats[cause] = { unique: causeCount, total: totalForCause };
  }

  console.log(`\n  BROWSE SUMMARY:`);
  for (const [cause, stats] of Object.entries(causeStats)) {
    console.log(`    ${cause}: ${stats.unique} unique / ${stats.total} total`);
  }
  console.log(`    ────────────────────`);
  console.log(`    TOTAL UNIQUE: ${allNonprofits.length}\n`);

  // ── Phase 2: Classify existing vs new ─────────────────────────────

  const toUpdate = [];  // Already in GiveReady, enrich with more data
  const toInsert = [];  // New to GiveReady

  for (const np of allNonprofits) {
    const slug = slugify(np.name);
    const einId = np.ein ? `every-${np.ein}` : null;
    if (existingIDs.has(slug) || (einId && existingIDs.has(einId))) {
      toUpdate.push(np);
    } else {
      toInsert.push(np);
    }
  }

  console.log(`  Existing to update: ${toUpdate.length}`);
  console.log(`  New to insert: ${toInsert.length}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — stopping before detail fetches');
    return;
  }

  // ── Phase 3: Two-tier enrichment ──────────────────────────────────
  // Tier 1: ALL nonprofits get inserted from browse data (name, description, EIN, location, website, tags)
  // Tier 2: Priority causes (youth, mental-health) get detail-fetched for richer profiles
  const PRIORITY_CAUSES = new Set(['youth', 'mental-health']);

  // Detail-fetch priority nonprofits
  const priorityQueue = allNonprofits
    .filter(np => PRIORITY_CAUSES.has(np.sourceCause))
    .slice(0, MAX_DETAILS);

  console.log(`\nPHASE 2: Detail-fetch ${priorityQueue.length} priority nonprofits (youth + mental-health)\n`);

  const detailMap = new Map();  // key → detail data
  let fetchCount = 0;
  let fetchErrors = 0;

  for (const np of priorityQueue) {
    const identifier = np.slug || np.ein;
    if (!identifier) continue;

    const result = await getNonprofitDetails(identifier);
    if (result && result.data && result.data.nonprofit) {
      const key = np.ein || np.slug || np.name;
      detailMap.set(key, result.data.nonprofit);
    } else {
      fetchErrors++;
    }

    fetchCount++;
    if (fetchCount % 25 === 0) {
      const pct = Math.round(fetchCount / priorityQueue.length * 100);
      console.log(`  ${fetchCount}/${priorityQueue.length} (${pct}%) — ${detailMap.size} enriched, ${fetchErrors} errors`);
    }
    await sleep(DETAIL_DELAY_MS);
  }

  console.log(`\n  DETAIL SUMMARY:`);
  console.log(`    Fetched: ${fetchCount}`);
  console.log(`    Enriched: ${detailMap.size}`);
  console.log(`    Errors: ${fetchErrors}\n`);

  // ── Phase 4: Generate SQL ─────────────────────────────────────────
  console.log('PHASE 3: Generate SQL\n');

  const sql = [];
  sql.push('-- ════════════════════════════════════════════════════════════════');
  sql.push('-- GiveReady — every.org Wide Infrastructure Enrichment');
  sql.push(`-- Generated: ${new Date().toISOString()}`);
  sql.push(`-- Source: every.org API (${CAUSES.length} causes)`);
  sql.push(`-- Total browsed: ${allNonprofits.length}`);
  sql.push(`-- Detail-fetched (youth + mental-health): ${detailMap.size}`);
  sql.push(`-- Existing to update: ${toUpdate.length}`);
  sql.push(`-- New to insert: ${toInsert.length}`);
  sql.push('-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/004-everyorg-bulk-enrich.sql');
  sql.push('-- ════════════════════════════════════════════════════════════════');
  sql.push('');

  let insertCount = 0;
  let updateCount = 0;
  let skipCount = 0;

  // Helper: generate INSERT or UPDATE for a nonprofit
  function generateSQL(np, isExisting) {
    const key = np.ein || np.slug || np.name;
    const details = detailMap.get(key);  // May be null for non-priority causes

    const ein = (details?.ein || np.ein) || '';
    const id = ein ? `every-${ein}` : `every-${slugify(np.name)}`;
    const slug = slugify(details?.name || np.name);
    const name = escSQL(details?.name || np.name);

    // Use detail data if available, fall back to browse data
    const mission = escSQL(details?.description || np.description || '');
    const descLong = escSQL(details?.descriptionLong || details?.description || np.description || '');
    const website = escSQL(details?.websiteUrl || np.websiteUrl || '');
    const logoUrl = escSQL(details?.logoUrl || np.logoUrl || '');
    const everySlug = details?.primarySlug || np.slug || slug;
    const donationUrl = `https://www.every.org/${everySlug}#/donate`;

    // Location: detail data is richer (full address), browse has city/state
    const location = details?.locationAddress || np.location || '';
    const locationParts = location.split(',').map(s => s.trim());
    const city = escSQL(locationParts[0] || '');
    const region = escSQL(locationParts.length >= 2 ? locationParts[locationParts.length - 1] : '');

    // Skip if no useful content at all
    if (!mission && !descLong && !name) { skipCount++; return; }

    // Tags from detail data or source cause
    const tags = details
      ? (details.nonprofitTags || []).map(t => t.causeCategory || t.tagName).filter(Boolean)
      : [];
    const causes = mapCauses(tags, np.sourceCause);

    if (isExisting) {
      // UPDATE existing record
      const whereClause = ein ? `id = 'every-${ein}'` : `slug = '${slug}'`;
      const sets = [];

      if (descLong) sets.push(`description = '${descLong}'`);
      if (mission) sets.push(`mission = '${mission}'`);
      if (website) sets.push(`website = '${website}'`);
      if (logoUrl) sets.push(`logo_url = '${logoUrl}'`);
      if (city) sets.push(`city = '${city}'`);
      if (region) sets.push(`region = '${region}'`);
      sets.push(`updated_at = datetime('now')`);

      if (sets.length > 1) {
        sql.push(`UPDATE nonprofits SET ${sets.join(', ')} WHERE ${whereClause};`);
        updateCount++;
      }
    } else {
      // INSERT new record
      sql.push(`INSERT OR IGNORE INTO nonprofits (id, slug, name, tagline, mission, description, website, donation_url, logo_url, country, city, region, contact_email, verified, ghd_aligned) VALUES ('${id}', '${slug}', '${name}', '', '${mission}', '${descLong || mission}', '${website}', '${escSQL(donationUrl)}', '${logoUrl}', 'United States', '${city}', '${region}', '', 0, 0);`);
      insertCount++;
    }

    // Registration
    if (ein) {
      sql.push(`INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES ('${id}-reg', '${id}', 'United States', '501(c)(3)', '${ein}');`);
    }

    // Cause mappings
    for (const cause of causes) {
      if (GIVEREADY_CAUSES.has(cause)) {
        sql.push(`INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('${id}', '${cause}');`);
      }
    }
  }

  // Process updates
  sql.push('-- ═══ UPDATES ═══');
  for (const np of toUpdate) generateSQL(np, true);

  // Process inserts
  sql.push('');
  sql.push('-- ═══ INSERTS ═══');
  for (const np of toInsert) generateSQL(np, false);

  // ── Write SQL file ────────────────────────────────────────────────
  const outPath = path.join(__dirname, '..', 'migrations', '004-everyorg-bulk-enrich.sql');
  fs.writeFileSync(outPath, sql.join('\n'), 'utf8');

  // ── Write JSON cache ──────────────────────────────────────────────
  const cachePath = path.join(__dirname, '..', 'data', 'everyorg-cache.json');
  const cacheDir = path.dirname(cachePath);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(cachePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    causes: CAUSES,
    causeStats,
    totalBrowsed: allNonprofits.length,
    detailFetched: detailMap.size,
    updates: updateCount,
    inserts: insertCount,
    skipped: skipCount,
  }, null, 2), 'utf8');

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  DONE                                      ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`  SQL: ${outPath}`);
  console.log(`  Cache: ${cachePath}`);
  console.log(`  Updates: ${updateCount}`);
  console.log(`  Inserts: ${insertCount}`);
  console.log(`  Skipped (no data): ${skipCount}`);
  console.log(`  Detail-enriched (priority): ${detailMap.size}`);
  console.log(`  Total nonprofits after deploy: ~${existingIDs.size + insertCount}`);
  console.log(`\n  Deploy sequence:`);
  console.log(`  1. npx wrangler d1 execute giveready-db --remote --file=migrations/005-broad-causes.sql`);
  console.log(`  2. npx wrangler d1 execute giveready-db --remote --file=migrations/004-everyorg-bulk-enrich.sql`);
  console.log(`\n  Quick count check:`);
  console.log(`  npx wrangler d1 execute giveready-db --remote --command="SELECT COUNT(*) FROM nonprofits"`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
