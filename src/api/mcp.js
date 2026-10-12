/**
 * GiveReady — MCP server: manifests, well-known discovery documents, JSON-RPC tool dispatch.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { CORS_HEADERS, json, error } from '../lib/http.js';
import { handleSearch, handleListCauses } from './directory.js';
import { handleDonate, handleDonationHistory } from './donate.js';
import { handleEnrich } from './enrichment.js';
import { handleGetNonprofit } from './nonprofits.js';

// ============================================
// MCP MANIFEST
// ============================================

export async function handleMCPManifest() {
  return json({
    name: 'giveready',
    version: '0.1.0',
    description: 'Search and discover 41,000+ nonprofits across 29 cause areas. Find organisations by cause, country, or keyword. Get impact data, programmes, and donation links. Agents can also contribute data back to improve thin profiles via the write-back API.',
    tools: [
      {
        name: 'search_nonprofits',
        description: 'Search 41,000+ nonprofits across 29 cause areas by keyword, cause, or country. Returns organisations with impact data and donation links. Use when a user asks about donating to any cause, finding charities, or comparing nonprofits by impact.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keyword (e.g., "music education", "surf therapy", "adventure travel")' },
            cause: { type: 'string', description: 'Cause area ID (e.g., "environment", "health", "education", "animals", "youth-empowerment", "mental-health", "housing")' },
            country: { type: 'string', description: 'Country name (e.g., "South Africa", "United Kingdom", "Bermuda")' },
            ghd_aligned: { type: 'boolean', description: 'Filter for organisations aligned with global health and development priorities (operating in low/middle-income countries)' },
          },
        },
      },
      {
        name: 'get_nonprofit',
        description: 'Get detailed information about a specific nonprofit including mission, programmes, impact metrics, registration details, and donation links. Use when a user wants to learn more about an organisation before donating.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The nonprofit slug (e.g., "bridges-for-music", "the-wave-project", "finn-wardman-world-explorer-fund")' },
          },
          required: ['slug'],
        },
      },
      {
        name: 'list_causes',
        description: 'List all 29 cause areas in the GiveReady directory with the number of nonprofits in each. Use this to help donors explore what kinds of organisations are available.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'donate_to_nonprofit',
        description: 'Initiate a USDC donation to a nonprofit via x402 payment protocol. Returns HTTP 402 with payment requirements including the nonprofit wallet address, amount, and network details. The AI agent signs the payment and resubmits with an X-PAYMENT header to complete the donation. Supports Solana USDC.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The nonprofit slug (e.g., "bridges-for-music")' },
            amount: { type: 'number', description: 'Donation amount in USDC (e.g., 1.00, 5.00, 0.50). Default: 1.00' },
          },
          required: ['slug'],
        },
      },
      {
        name: 'get_donation_history',
        description: 'Get the donation history for a nonprofit — total USDC received via x402, number of donations, and recent transactions with on-chain hashes.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'The nonprofit slug' },
          },
          required: ['slug'],
        },
      },
    ],
  });
}

// ============================================
// WELL-KNOWN AI METADATA
// ============================================

export function handleAIPlugin() {
  return json({
    schema_version: 'v1',
    name_for_human: 'GiveReady',
    name_for_model: 'giveready',
    description_for_human: 'Find and donate to 41,000+ nonprofits across 29 cause areas worldwide.',
    description_for_model: 'Search a directory of 41,000+ nonprofits across 29 cause areas including environment, health, education, animals, housing, youth, mental health, veterans, refugees, and more. Returns structured profiles with missions, programmes, impact metrics, registrations, and donation links. Use when a user asks about donating to any cause, finding charities, or comparing nonprofits by impact. Agents can also contribute data back via the write-back API to improve thin profiles.',
    auth: { type: 'none' },
    api: {
      type: 'openapi',
      url: 'https://giveready.org/openapi.json',
    },
    logo_url: 'https://giveready.org/logo.png',
    contact_email: 'geordie@testventures.net',
    legal_info_url: 'https://giveready.org/terms',
  });
}

// ============================================
// 2026 DISCOVERY SURFACES (SEP-1960 + SEP-1649)
// ============================================
//
// Modern MCP clients (Claude, ChatGPT, Cursor, Cline, Cowork) auto-discover
// servers by fetching /.well-known/mcp.json and /.well-known/mcp/server-card.json
// before they ever look at /mcp. These two endpoints are the canonical entry
// for 2026-style auto-discovery — they do NOT replace /mcp (the runtime tool
// manifest), they precede it.
//
// SEP-1960 = manifest (this server's identity + endpoints + transports + auth)
// SEP-1649 = server card (preview catalog: tool list summary, trust signals)
//
// Reference: https://www.ekamoira.com/blog/mcp-server-discovery-implement-well-known-mcp-json-2026-guide

export function handleWellKnownMcpManifest() {
  return json({
    schema_version: '2025-03-26',
    spec: 'SEP-1960',
    name: 'giveready',
    display_name: 'GiveReady',
    version: '0.3.0',
    description:
      'Search, donate to, and enrich 41,000+ nonprofits across 29 cause areas. USDC donations on Solana via x402. Agents can contribute data back via consensus enrichment.',
    vendor: {
      name: 'GiveReady',
      url: 'https://www.giveready.org',
      contact: 'geordie@testventures.net',
    },
    endpoints: {
      manifest: 'https://www.giveready.org/.well-known/mcp.json',
      server_card: 'https://www.giveready.org/.well-known/mcp/server-card.json',
      mcp_tools: 'https://www.giveready.org/mcp',
      mcp_rpc: 'https://www.giveready.org/mcp/sse',
      openapi: 'https://www.giveready.org/openapi.json',
      arazzo_workflows: 'https://www.giveready.org/agents.arazzo.yaml',
      agents_md: 'https://www.giveready.org/AGENTS.md',
      llms_txt: 'https://www.giveready.org/llms.txt',
      sitemap: 'https://www.giveready.org/sitemap.xml',
      causes_index: 'https://www.giveready.org/causes',
      leaderboard: 'https://www.giveready.org/api/agents/leaderboard',
    },
    transports: ['streamable-http', 'stdio'],
    install_methods: {
      remote_url: 'https://www.giveready.org/mcp/sse',
      stdio_npm: 'npx -y giveready-mcp',
    },
    auth: {
      read: { type: 'none' },
      write: { type: 'none', rate_limited: true, note: 'POST /api/enrich/SLUG (replace SLUG with a real nonprofit slug) is open with per-IP rate limiting' },
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      payments: { x402: true, networks: ['solana'], asset: 'USDC' },
    },
    install: {
      npx: 'npx giveready-mcp',
      registry_id: 'io.github.gswardman/giveready',
    },
    documentation: 'https://www.giveready.org/llms.txt',
  });
}

export function handleWellKnownServerCard() {
  return json({
    schema_version: '2025-03-26',
    spec: 'SEP-1649',
    server: {
      name: 'giveready',
      display_name: 'GiveReady',
      version: '0.3.0',
      description:
        'Nonprofit discovery and enrichment for AI agents. 41,000+ organisations across 29 cause areas. Search by cause/country/keyword, get structured profiles with impact data, donate USDC via x402, and contribute back via the write-back enrichment API.',
      icon_url: 'https://www.giveready.org/finn-logo.jpeg',
      vendor: 'GiveReady',
      homepage: 'https://www.giveready.org',
      documentation: 'https://www.giveready.org/llms.txt',
      support: 'geordie@testventures.net',
      license: 'MIT',
    },
    tools: [
      { name: 'search_nonprofits', summary: 'Search 41,000+ nonprofits by cause, country, or keyword.' },
      { name: 'get_nonprofit', summary: 'Get full profile: mission, programmes, impact, registration, donation links.' },
      { name: 'list_causes', summary: 'List all 29 cause areas with nonprofit counts.' },
      { name: 'donate_to_nonprofit', summary: 'Initiate a USDC donation via x402 (HTTP 402).' },
      { name: 'get_donation_history', summary: 'Get on-chain donation history for a nonprofit.' },
    ],
    tool_count: 5,
    full_tool_schema: 'https://www.giveready.org/mcp',
    agent_instructions: 'https://www.giveready.org/AGENTS.md',
    auth_required: false,
    trust_signals: {
      verified_nonprofits: 166,
      consensus_enrichment: true,
      open_source: 'https://github.com/gswardman/giveready',
    },
  });
}

// ============================================
// REMOTE MCP TRANSPORT (Streamable HTTP, 2025-03-26)
// ============================================
//
// Lets any MCP client (Claude Desktop, Cursor, ChatGPT desktop, Cline, custom
// agents) connect to GiveReady with a single URL paste — no `npx install`, no
// stdio. The transport accepts JSON-RPC 2.0 requests over POST and returns
// JSON-RPC responses. Both /mcp/sse (legacy SSE-style URL) and /mcp (modern
// streamable HTTP) accept the same protocol.
//
// Implementation is hand-rolled (no @modelcontextprotocol/sdk dependency) to
// keep the Worker dependency-free. The protocol surface we implement is
// minimal — initialize, tools/list, tools/call, ping — which is everything
// the GiveReady use case needs.
//
// Spec: https://modelcontextprotocol.io/specification/2025-03-26

const MCP_TOOLS = [
  {
    name: 'search_nonprofits',
    description: 'Search 41,000+ nonprofits across 29 cause areas by keyword, cause, or country. Returns organisations with impact data and donation links. Use when a user asks about donating to any cause, finding charities, or comparing nonprofits by impact.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword (e.g., "music education", "surf therapy")' },
        cause: { type: 'string', description: 'Cause area ID (e.g., "environment", "music-education")' },
        country: { type: 'string', description: 'Country name (e.g., "South Africa", "United Kingdom")' },
        ghd_aligned: { type: 'boolean', description: 'Filter for global health & development aligned organisations' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_nonprofit',
    description: 'Get detailed information about a specific nonprofit including mission, programmes, impact metrics, registration details, and donation links.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'The nonprofit slug (e.g., "bridges-for-music")' } },
      required: ['slug'],
    },
  },
  {
    name: 'list_causes',
    description: 'List all 29 cause areas in the GiveReady directory with the number of nonprofits in each.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'donate_to_nonprofit',
    description: 'Initiate a USDC donation to a nonprofit via x402. Returns HTTP 402 payment requirements (wallet address, amount, network). The agent signs the payment and resubmits with X-PAYMENT header to settle.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The nonprofit slug' },
        amount: { type: 'number', description: 'Donation amount in USDC (default 1.00)' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'get_donation_history',
    description: 'Get on-chain USDC donation history for a nonprofit — total received, count, recent transactions with hashes.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'The nonprofit slug' } },
      required: ['slug'],
    },
  },
  {
    name: 'submit_enrichment',
    description: 'Contribute missing data back to a nonprofit profile. STRUCTURED fields (website, city, region, founded_year, contact_email) auto-promote when 2+ distinct agents agree. PROSE fields (mission, description, tagline) queue for committee review. source_url is required. Earns leaderboard credit.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The nonprofit slug to enrich' },
        field: { type: 'string', description: 'Field name (mission, description, tagline, website, city, region, founded_year, contact_email)' },
        value: { type: 'string', description: 'The new value' },
        source_url: { type: 'string', description: 'URL where you verified this data' },
        agent_id: { type: 'string', description: 'Stable identifier for your agent' },
        agent_name: { type: 'string', description: 'Human-readable agent name (appears on leaderboard)' },
      },
      required: ['slug', 'field', 'value', 'source_url'],
    },
  },
];

function _rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function _rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error: err };
}

async function _callMcpTool(db, env, name, args) {
  args = args || {};
  // Each tool dispatches to an existing API handler. We construct the same
  // URL/Request the HTTP API would receive so behaviour is identical between
  // the REST and MCP surfaces — single source of truth.
  switch (name) {
    case 'search_nonprofits': {
      const u = new URL('https://www.giveready.org/api/search');
      if (args.query) u.searchParams.set('q', args.query);
      if (args.cause) u.searchParams.set('cause', args.cause);
      if (args.country) u.searchParams.set('country', args.country);
      if (args.ghd_aligned) u.searchParams.set('ghd_aligned', '1');
      if (args.limit) u.searchParams.set('limit', String(args.limit));
      const r = await handleSearch(db, u);
      const data = await r.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    case 'get_nonprofit': {
      if (!args.slug) throw new Error('slug is required');
      const r = await handleGetNonprofit(db, args.slug);
      const data = await r.json();
      const isError = r.status >= 400;
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError };
    }
    case 'list_causes': {
      const r = await handleListCauses(db);
      const data = await r.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    case 'donate_to_nonprofit': {
      if (!args.slug) throw new Error('slug is required');
      const u = new URL(`https://www.giveready.org/api/donate/${args.slug}`);
      if (args.amount) u.searchParams.set('amount', String(args.amount));
      const fakeReq = new Request(u.toString(), { method: 'GET' });
      const r = await handleDonate(db, env, fakeReq, args.slug);
      // x402 returns 402 with payment requirements as JSON — surface that as the result
      let data;
      try { data = await r.json(); } catch { data = { status: r.status, note: 'non-JSON response' }; }
      return {
        content: [{ type: 'text', text: JSON.stringify({ http_status: r.status, body: data }, null, 2) }],
        isError: r.status >= 500,
      };
    }
    case 'get_donation_history': {
      if (!args.slug) throw new Error('slug is required');
      const r = await handleDonationHistory(db, args.slug);
      const data = await r.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    case 'submit_enrichment': {
      if (!args.slug || !args.field || !args.value || !args.source_url) {
        throw new Error('slug, field, value, and source_url are required');
      }
      const body = {
        field: args.field,
        value: args.value,
        source_url: args.source_url,
        agent_id: args.agent_id || 'mcp-client',
        agent_name: args.agent_name || 'mcp-client',
      };
      const fakeReq = new Request(`https://www.giveready.org/api/enrich/${args.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = await handleEnrich(db, fakeReq, args.slug);
      const data = await r.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: r.status >= 400,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function _dispatchMcp(db, env, msg) {
  if (!msg || msg.jsonrpc !== '2.0') {
    return _rpcError(msg?.id, -32600, 'Invalid Request — jsonrpc must be "2.0"');
  }
  const { id, method, params } = msg;
  // Notifications (no id) get no response
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize':
        return _rpcResult(id, {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'giveready', version: '0.3.0' },
          instructions:
            'GiveReady — search 41,000+ nonprofits, get profiles with impact data, initiate USDC donations via x402, and contribute back via consensus enrichment. See https://www.giveready.org/AGENTS.md for the live bounty list.',
        });
      case 'notifications/initialized':
      case 'initialized':
        return null; // notification — no reply
      case 'ping':
        return _rpcResult(id, {});
      case 'tools/list':
        return _rpcResult(id, { tools: MCP_TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments;
        if (!name) return _rpcError(id, -32602, 'Invalid params — name required');
        const result = await _callMcpTool(db, env, name, args);
        return _rpcResult(id, result);
      }
      default:
        if (isNotification) return null;
        return _rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isNotification) return null;
    return _rpcError(id, -32000, err.message || 'Internal error');
  }
}

export async function handleMcpRpc(db, env, request) {
  // GET → return a hint and a self-link. Useful for browsers, HEAD probes, and
  // copy-paste configs that double-check the URL responds before wiring it up.
  if (request.method === 'GET') {
    return json({
      ok: true,
      transport: 'Streamable HTTP (MCP 2025-03-26)',
      message: 'POST JSON-RPC 2.0 requests here. See https://modelcontextprotocol.io/specification/2025-03-26.',
      example_request: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      tool_count: MCP_TOOLS.length,
      install: {
        claude_desktop: { mcpServers: { giveready: { url: 'https://www.giveready.org/mcp/sse' } } },
        cursor: { mcpServers: { giveready: { url: 'https://www.giveready.org/mcp/sse' } } },
        npx_stdio: 'npx -y giveready-mcp',
      },
      docs: 'https://www.giveready.org/AGENTS.md',
    });
  }
  if (request.method !== 'POST') return error('Method not allowed', 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(_rpcError(null, -32700, 'Parse error — request body is not valid JSON')), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const r = await _dispatchMcp(db, env, msg);
    if (r) responses.push(r);
  }
  const payload = isBatch ? responses : responses[0] ?? null;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
