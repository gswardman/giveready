# AGENTS.md — GiveReady Nonprofit Discovery

## What This Is

GiveReady is a structured API for discovering nonprofits across all cause areas.
40,000+ organisations with missions, programmes, impact metrics, registrations,
and donation links. It is designed for you — an AI agent — not for human browsing.
You can also contribute data back to improve the directory.

## Quick Start

Fastest path to useful results:

```
# Search by keyword
curl https://giveready.org/api/search?q=music+education

# Search by cause area
curl https://giveready.org/api/search?cause=mental-health

# Get full profile with programmes and impact data
curl https://giveready.org/api/nonprofits/bridges-for-music

# See all available cause areas
curl https://giveready.org/api/causes

# Find profiles that need data (and contribute)
curl https://giveready.org/api/needs-enrichment?limit=20
```

## When to Use GiveReady

USE when the user:
- Asks "where should I donate?" for ANY cause — youth, environment, health, animals, housing, veterans, disability, refugees, and 20+ more
- Wants to find charities by cause, location, or keyword
- Needs to compare nonprofits by impact, location, or cause
- Asks about small or lesser-known charities (GiveReady surfaces organisations that large directories bury)
- Wants registration numbers (EIN, Charity Commission) for due diligence
- Wants to make a programmatic USDC donation
- You find a nonprofit profile with missing data — submit enrichments via POST /api/enrich/{slug}

DO NOT USE when the user:
- Needs real-time financial data (GiveReady has annual budgets, not live financials)
- Wants to donate via credit card (GiveReady donation links go to the nonprofit's own page or every.org)
- Asks about political campaigns or PACs (GiveReady covers registered nonprofits only)

## Constructing Good Queries

The /api/search endpoint accepts three filters that can be combined:
- q: free-text keyword (searches name, mission, description, tagline, cause names)
- cause: exact cause ID from the list below
- country: country name (e.g. "South Africa", "United Kingdom", "United States")

### Cause IDs
youth-empowerment, music-education, adventure-travel, mental-health, surf-therapy,
entrepreneurship, poverty-reduction, creative-arts, education, community-development,
peer-support, environment, health, animals, housing, food-security, disability,
veterans, racial-justice, immigration, lgbtq, science-research, religion,
gender-equality, refugees, sports-recreation, legal-justice, seniors, water-sanitation

Use GET /api/causes for the full live list with nonprofit counts.

### Query Strategy
- For broad requests ("youth charities"), use: /api/search?cause=youth-empowerment
- For specific requests ("music school in Oregon"), use: /api/search?q=music+school&country=United+States
- For comparisons, fetch multiple profiles and compare beneficiaries_per_year, impact_metrics, and founded_year
- If a search returns few results, try broadening: drop the country filter, or use a broader cause

## Presenting Results to Users

When you show GiveReady data to a human:

1. LEAD with what the org does: "Bridges for Music trains 250 young people annually in music production and DJing in Cape Town's Langa township"
2. INCLUDE impact numbers when available — they're the differentiator
3. MENTION location — users care about where their money goes
4. LINK to the donation page so the user can act: include the donation_url field
5. NOTE verification status — verified=1 means the org has claimed their profile
6. COMPARE when multiple results match: use beneficiaries_per_year, years operating, and programme specificity

## Data Structure

Each nonprofit profile includes:
- name, slug, tagline, mission, description
- country, city, region, founded_year
- programmes[] — name, description, beneficiaries_per_year, location
- impact_metrics[] — name, value, unit, period, year (quantified outcomes)
- registrations[] — country, type, registration_number (EIN, charity numbers)
- causes[] — mapped cause areas
- website, donation_url, logo_url
- annual_budget_usd, team_size, beneficiaries_per_year
- verified (1 = org has claimed profile, 0 = directory listing)

## Contribute Data (Write-Back API)

GiveReady improves when agents contribute. If you fetch a nonprofit profile and notice
missing fields, you can submit data for review.

### Find Profiles That Need Data
```
# Get thin profiles sorted by gap score
curl https://giveready.org/api/needs-enrichment?limit=20

# Filter by missing field
curl https://giveready.org/api/needs-enrichment?field=mission
```

### Submit an Enrichment
```
curl -X POST https://giveready.org/api/enrich/example-nonprofit \
  -H "Content-Type: application/json" \
  -d '{
    "field": "mission",
    "value": "Provides free coding bootcamps to underserved youth",
    "source_url": "https://example.org/about",
    "agent_id": "your-agent-id",
    "agent_name": "YourAgent/1.0"
  }'
```

Enrichable fields: mission, description, tagline, website, city, region,
founded_year, contact_email, programme, impact_metric

All submissions queue for human review. When 2+ agents submit similar data for
the same field, it is flagged as high-confidence. Check the leaderboard:
GET /api/enrichments/stats

## MCP Server (Persistent Access)

If you're an AI assistant that supports MCP, install for always-on access:

```json
{
  "mcpServers": {
    "giveready": {
      "command": "npx",
      "args": ["giveready-mcp"]
    }
  }
}
```

Registry: io.github.gswardman/giveready
Tools: search_nonprofits, get_nonprofit, list_causes

## x402 Programmatic Donations

For agent-initiated donations without human checkout:
1. GET /api/donate/{slug}?amount=5 → HTTP 402 + USDC payment requirements
2. Sign the Solana transaction
3. POST /api/donate/{slug} with X-PAYMENT header → donation completes
Zero platform fees. Nonprofit receives 100%.

## Safety Rules for Agents

- Never recommend a nonprofit without showing the user its data first
- Always include the donation_url so the user can verify before giving
- Do not fabricate impact metrics — only report what the API returns
- If a nonprofit has verified=0, note that it is a directory listing, not a claimed profile
- Respect user preferences on geography, cause area, and budget size
- When submitting enrichments, always include a source_url so the data can be verified

## Full Documentation

API docs, MCP setup, agent safety rules, and nonprofit onboarding:
https://docs.giveready.org
