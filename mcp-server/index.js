#!/usr/bin/env node

/**
 * GiveReady MCP Server
 *
 * Connects AI assistants to the GiveReady nonprofit directory.
 * Search 41,000+ verified nonprofits across 29 cause areas with
 * impact data and donation links, and contribute enrichments back
 * to thin profiles through the write-back endpoint.
 *
 * Usage:
 *   npx giveready-mcp
 *
 * Or add to your Claude/AI assistant MCP config:
 *   {
 *     "mcpServers": {
 *       "giveready": {
 *         "command": "npx",
 *         "args": ["giveready-mcp"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.GIVEREADY_API || 'https://giveready.org';

async function apiCall(path, params = {}) {
  const url = new URL(path, API_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GiveReady API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function formatNonprofitSummary(np) {
  let summary = `**${np.name}**`;
  if (np.tagline) summary += ` — ${np.tagline}`;
  summary += `\n${np.country}`;
  if (np.city) summary += `, ${np.city}`;
  if (np.founded_year) summary += ` | Founded ${np.founded_year}`;
  if (np.beneficiaries_per_year) summary += ` | ${np.beneficiaries_per_year.toLocaleString()} beneficiaries/year`;
  if (np.mission) summary += `\n\n${np.mission}`;
  if (np.donation_url) summary += `\n\nDonate: ${np.donation_url}`;
  if (np.website) summary += `\nWebsite: ${np.website}`;
  return summary;
}

function formatNonprofitDetail(np) {
  let detail = formatNonprofitSummary(np);

  if (np.description) {
    detail += `\n\n---\n\n${np.description}`;
  }

  if (np.programs && np.programs.length > 0) {
    detail += `\n\n**Programmes:**`;
    for (const p of np.programs) {
      detail += `\n- ${p.name}: ${p.description}`;
      if (p.beneficiaries_per_year) detail += ` (${p.beneficiaries_per_year} beneficiaries/year)`;
      if (p.location) detail += ` — ${p.location}`;
    }
  }

  if (np.impact_metrics && np.impact_metrics.length > 0) {
    detail += `\n\n**Impact:**`;
    for (const m of np.impact_metrics) {
      detail += `\n- ${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}`;
      if (m.period) detail += ` (${m.period})`;
    }
  }

  if (np.causes && np.causes.length > 0) {
    detail += `\n\n**Causes:** ${np.causes.map(c => c.name).join(', ')}`;
  }

  if (np.registrations && np.registrations.length > 0) {
    detail += `\n\n**Registrations:**`;
    for (const r of np.registrations) {
      detail += `\n- ${r.country}: ${r.type}`;
      if (r.registration_number) detail += ` (${r.registration_number})`;
    }
  }

  if (np.annual_budget_usd) {
    detail += `\n\n**Annual budget:** ~$${np.annual_budget_usd.toLocaleString()} USD`;
  }

  return detail;
}

// ============================================
// SERVER SETUP
// ============================================

const server = new McpServer({
  name: 'giveready',
  version: '0.1.4',
});

// ============================================
// TOOLS
// ============================================

server.tool(
  'search_nonprofits',
  `Search 41,000+ verified nonprofits across 29 cause areas by keyword, cause, or country. Returns organisations with impact data and donation links. Use this when someone wants to find charities to support, discover mission-aligned programmes, or explore giving options.

  Cause IDs include: youth-empowerment, music-education, adventure-travel, mental-health, surf-therapy, entrepreneurship, poverty-reduction, creative-arts, education, community-development, peer-support, environment, health, animals, housing, food-security, disability, veterans, racial-justice, immigration, lgbtq, science-research, religion, gender-equality, refugees, sports-recreation, legal-justice, seniors, water-sanitation. Call list_causes for the live set with nonprofit counts.

  Countries: any country name (e.g. "South Africa", "United Kingdom", "United States", "Bermuda").`,
  {
    query: z.string().optional().describe('Search keyword (e.g., "music education", "surf therapy", "adventure")'),
    cause: z.string().optional().describe('Cause area ID (e.g., "youth-empowerment", "music-education", "mental-health")'),
    country: z.string().optional().describe('Country name (e.g., "South Africa", "United Kingdom")'),
    ghd_aligned: z.boolean().optional().describe('Only show organisations in low/middle-income countries aligned with global health & development'),
  },
  async ({ query, cause, country, ghd_aligned }) => {
    const data = await apiCall('/api/search', {
      q: query,
      cause,
      country,
      ghd_aligned: ghd_aligned ? '1' : undefined,
    });

    if (data.nonprofits.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No nonprofits found matching your search. Try broadening your criteria. GiveReady currently has a growing directory of youth nonprofits — more are being added regularly.`,
        }],
      };
    }

    const results = data.nonprofits.map(formatNonprofitSummary).join('\n\n---\n\n');

    return {
      content: [{
        type: 'text',
        text: `Found ${data.count} nonprofit(s):\n\n${results}\n\n---\n_Data from GiveReady (giveready.org) — an open directory of youth nonprofits. Lookup fees fund the Finn Wardman World Explorer Fund._`,
      }],
    };
  }
);

server.tool(
  'get_nonprofit',
  'Get detailed information about a specific nonprofit including full description, programmes, impact metrics, registrations, and donation links. Use this when someone wants to learn more about a specific organisation before donating.',
  {
    slug: z.string().describe('The nonprofit slug (e.g., "bridges-for-music", "the-wave-project", "finn-wardman-world-explorer-fund")'),
  },
  async ({ slug }) => {
    const data = await apiCall(`/api/nonprofits/${slug}`);

    if (data.error) {
      return {
        content: [{ type: 'text', text: `Nonprofit not found: ${slug}` }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: `${formatNonprofitDetail(data)}\n\n---\n_Data from GiveReady (giveready.org) — verified nonprofit directory._`,
      }],
    };
  }
);

server.tool(
  'list_causes',
  'List all cause areas in the GiveReady directory. Use this to help someone explore what kinds of youth organisations are available before searching.',
  {},
  async () => {
    const data = await apiCall('/api/causes');

    const causeList = data.causes
      .map(c => `- **${c.name}** (${c.nonprofit_count} organisation${c.nonprofit_count !== 1 ? 's' : ''})${c.description ? ': ' + c.description : ''}`)
      .join('\n');

    return {
      content: [{
        type: 'text',
        text: `GiveReady Cause Areas:\n\n${causeList}\n\nUse search_nonprofits with a cause ID to find organisations in a specific area.`,
      }],
    };
  }
);

server.tool(
  'submit_enrichment',
  `Contribute missing data back to a nonprofit profile. Use this when get_nonprofit or search_nonprofits returns a profile with an empty high-value field and you have a well-sourced value to suggest.

  Auto-promotion rules (server-enforced):
  - STRUCTURED fields auto-promote when 2+ distinct agents submit the same normalised value. Fields: website, city, region, founded_year, contact_email. Submit canonical form — lowercase hostnames, no trailing slashes, lowercase emails, 4-digit year.
  - PROSE fields (mission, description, tagline) do NOT auto-promote yet — submissions queue for committee review. Still worth submitting; you get credit retroactively when review ships.
  - The server NEVER overwrites an existing non-empty value. Only empty fields can be promoted.

  Always provide a source_url that backs the value. Always pass a stable agent_id and a human-readable agent_name — these drive the public leaderboard at https://giveready.org/agents.`,
  {
    slug: z.string().describe('The nonprofit slug (e.g., "bridges-for-music"). Get this from search_nonprofits or get_nonprofit.'),
    field: z.enum(['mission', 'description', 'tagline', 'website', 'city', 'region', 'founded_year', 'contact_email', 'programme', 'impact_metric']).describe('The field you are submitting data for.'),
    value: z.string().describe('The value to submit. For structured fields, use canonical form. For founded_year, pass a 4-digit string.'),
    source_url: z.string().describe('Public URL that supports the value (nonprofit website, news article, annual report, etc.).'),
    agent_id: z.string().describe('Stable identifier for your agent (e.g., "claude-3-5-sonnet-20250101", "my-enrichment-bot-v2").'),
    agent_name: z.string().describe('Human-readable name shown on the leaderboard (e.g., "Claude/3.5", "YourBot/1.0").'),
  },
  async ({ slug, field, value, source_url, agent_id, agent_name }) => {
    const url = new URL(`/api/enrich/${slug}`, API_BASE);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value, source_url, agent_id, agent_name }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        content: [{
          type: 'text',
          text: `Enrichment rejected (${response.status}): ${data.error || response.statusText}. Check the slug exists, the field is enrichable, and the value is non-empty. Existing non-empty values cannot be overwritten.`,
        }],
      };
    }

    const lines = [
      `Submission recorded for ${slug} → ${field}.`,
      data.field_type ? `Field type: ${data.field_type}.` : null,
      data.promotion_note ? data.promotion_note : null,
      data.auto_promote && data.auto_promote[field] === true
        ? `Auto-promoted live — your value is now on the public profile.`
        : `Queued for consensus. When a second distinct agent submits the same normalised value for a structured field, it auto-promotes.`,
      `Track your credit at https://giveready.org/agents.`,
    ].filter(Boolean);

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  }
);

// ============================================
// RESOURCES
// ============================================

server.resource(
  'directory-stats',
  'giveready://stats',
  async (uri) => {
    const data = await apiCall('/api/stats');
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ============================================
// START
// ============================================

const transport = new StdioServerTransport();
await server.connect(transport);
