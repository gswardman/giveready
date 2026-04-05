#!/usr/bin/env node

/**
 * GiveReady MCP Server
 *
 * Connects AI assistants to the GiveReady nonprofit directory.
 * When a donor asks their AI about youth charities, this server
 * returns verified organisations with real impact data and donation links.
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
  version: '0.1.0',
});

// ============================================
// TOOLS
// ============================================

server.tool(
  'search_nonprofits',
  `Search for verified youth nonprofits by keyword, cause area, or country. Returns organisations with impact data and donation links. Use this when someone wants to find charities to support, discover youth programmes, or explore giving options.

  Available causes: youth-empowerment, music-education, adventure-travel, mental-health, surf-therapy, entrepreneurship, poverty-reduction, creative-arts, education, community-development

  Available countries include: South Africa, United Kingdom, Bermuda (and growing)`,
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
