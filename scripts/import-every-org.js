/**
 * GiveReady — Bulk Import from Every.org
 *
 * Pulls youth nonprofits from Every.org's free API and generates
 * SQL INSERT statements for the GiveReady D1 database.
 *
 * Usage:
 *   EVERY_ORG_API_KEY=your_key node scripts/import-every-org.js
 *
 * Then run the output SQL:
 *   wrangler d1 execute giveready-db --remote --file=./import-every-org.sql
 */

const API_KEY = process.env.EVERY_ORG_API_KEY;
const API_BASE = 'https://partners.every.org/v0.2';

if (!API_KEY) {
  console.error('Set EVERY_ORG_API_KEY environment variable');
  console.error('Get your key at: https://www.every.org/charity-api');
  process.exit(1);
}

// Youth-related causes to search
const SEARCHES = [
  { query: 'youth empowerment', cause: 'youth-empowerment' },
  { query: 'youth music education', cause: 'music-education' },
  { query: 'youth surf therapy', cause: 'surf-therapy' },
  { query: 'youth adventure outdoor education', cause: 'adventure-travel' },
  { query: 'youth mental health', cause: 'mental-health' },
  { query: 'youth entrepreneurship', cause: 'entrepreneurship' },
  { query: 'youth arts creative', cause: 'creative-arts' },
  { query: 'children education developing countries', cause: 'education' },
  { query: 'youth community development', cause: 'community-development' },
  { query: 'youth poverty reduction', cause: 'poverty-reduction' },
];

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

function escapeSQL(str) {
  if (!str) return '';
  return str.replace(/'/g, "''").replace(/\n/g, ' ').trim();
}

async function searchEveryOrg(query, take = 50) {
  const url = `${API_BASE}/search/${encodeURIComponent(query)}?apiKey=${API_KEY}&take=${take}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`API error for "${query}": ${response.status}`);
    return [];
  }
  const data = await response.json();
  return data.nonprofits || [];
}

async function main() {
  const seen = new Set();
  const nonprofits = [];
  const causeMap = new Map(); // nonprofit slug -> set of causes

  console.error('Fetching youth nonprofits from Every.org...\n');

  for (const search of SEARCHES) {
    console.error(`  Searching: "${search.query}"...`);
    const results = await searchEveryOrg(search.query, 50);
    console.error(`    Found ${results.length} results`);

    for (const np of results) {
      const slug = slugify(np.name);
      if (seen.has(slug)) {
        // Already have this org, just add the cause
        if (causeMap.has(slug)) {
          causeMap.get(slug).add(search.cause);
        }
        continue;
      }
      seen.add(slug);

      // Filter: must have a name and description
      if (!np.name || !np.description) continue;

      // Determine if youth-focused (basic keyword check)
      const text = `${np.name} ${np.description || ''} ${np.mission || ''}`.toLowerCase();
      const youthKeywords = ['youth', 'young', 'children', 'kids', 'teen', 'adolescent', 'student', 'child', 'boys', 'girls', 'minor'];
      const isYouthFocused = youthKeywords.some(kw => text.includes(kw));
      if (!isYouthFocused) continue;

      nonprofits.push({
        id: `every-${np.ein || slug}`,
        slug,
        name: np.name,
        tagline: np.tagline || '',
        mission: (np.mission || np.description || '').substring(0, 500),
        description: (np.description || '').substring(0, 2000),
        website: np.websiteUrl || '',
        donation_url: `https://www.every.org/${np.slug}#/donate`,
        country: 'United States', // Every.org is US 501(c)(3) focused
        city: np.locationAddress || '',
        region: '',
        founded_year: null,
        annual_budget_usd: null,
        budget_year: null,
        team_size: null,
        beneficiaries_per_year: null,
        contact_email: '',
        verified: 1,
        ghd_aligned: 0,
        ein: np.ein || '',
      });

      causeMap.set(slug, new Set([search.cause, 'youth-empowerment']));
    }

    // Rate limit: wait 500ms between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.error(`\nTotal unique youth nonprofits found: ${nonprofits.length}\n`);

  // Generate SQL
  let sql = '-- GiveReady Import from Every.org\n';
  sql += `-- Generated: ${new Date().toISOString()}\n`;
  sql += `-- Total nonprofits: ${nonprofits.length}\n\n`;

  for (const np of nonprofits) {
    sql += `INSERT OR IGNORE INTO nonprofits (id, slug, name, tagline, mission, description, website, donation_url, country, city, region, founded_year, annual_budget_usd, budget_year, team_size, beneficiaries_per_year, contact_email, verified, ghd_aligned) VALUES (\n`;
    sql += `  '${escapeSQL(np.id)}',\n`;
    sql += `  '${escapeSQL(np.slug)}',\n`;
    sql += `  '${escapeSQL(np.name)}',\n`;
    sql += `  '${escapeSQL(np.tagline)}',\n`;
    sql += `  '${escapeSQL(np.mission)}',\n`;
    sql += `  '${escapeSQL(np.description)}',\n`;
    sql += `  '${escapeSQL(np.website)}',\n`;
    sql += `  '${escapeSQL(np.donation_url)}',\n`;
    sql += `  '${escapeSQL(np.country)}',\n`;
    sql += `  '${escapeSQL(np.city)}',\n`;
    sql += `  '${escapeSQL(np.region)}',\n`;
    sql += `  ${np.founded_year || 'NULL'},\n`;
    sql += `  ${np.annual_budget_usd || 'NULL'},\n`;
    sql += `  ${np.budget_year || 'NULL'},\n`;
    sql += `  ${np.team_size || 'NULL'},\n`;
    sql += `  ${np.beneficiaries_per_year || 'NULL'},\n`;
    sql += `  '${escapeSQL(np.contact_email)}',\n`;
    sql += `  ${np.verified},\n`;
    sql += `  ${np.ghd_aligned}\n`;
    sql += `);\n\n`;

    // Add cause mappings
    const causes = causeMap.get(np.slug) || new Set();
    for (const cause of causes) {
      sql += `INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES ('${escapeSQL(np.id)}', '${escapeSQL(cause)}');\n`;
    }
    sql += '\n';

    // Add registration (EIN)
    if (np.ein) {
      sql += `INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES ('${escapeSQL(np.id)}-us', '${escapeSQL(np.id)}', 'United States', '501(c)(3)', '${escapeSQL(np.ein)}');\n\n`;
    }
  }

  // Output SQL to stdout
  console.log(sql);
  console.error(`\nSQL written to stdout. Pipe to a file:`);
  console.error(`  EVERY_ORG_API_KEY=your_key node scripts/import-every-org.js > import-every-org.sql`);
  console.error(`  wrangler d1 execute giveready-db --remote --file=./import-every-org.sql`);
}

main().catch(console.error);
