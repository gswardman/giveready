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
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API_BASE = process.env.GIVEREADY_API || 'https://giveready.org';

// ============================================
// AUTONOMOUS DONATION CONFIG
// ============================================
// Hard safety caps. These are floors not ceilings — env vars can lower them
// but never raise them. The defaults are intentionally tiny because this is a
// test surface, not a production treasury.
const DONATE_PER_CALL_CAP_USDC = Math.min(
  parseFloat(process.env.GIVEREADY_PER_CALL_USDC_CAP || '1'),
  1
);
const DONATE_DAILY_CAP_USDC = Math.min(
  parseFloat(process.env.GIVEREADY_DAILY_USDC_CAP || '5'),
  5
);
const DONATE_RECEIPTS_DIR = join(homedir(), '.giveready');
const DONATE_RECEIPTS_LOG = join(DONATE_RECEIPTS_DIR, 'donations.log');
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const USDC_MINT_SOLANA = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

function getSpendTodayUSDC() {
  if (!existsSync(DONATE_RECEIPTS_LOG)) return 0;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const text = readFileSync(DONATE_RECEIPTS_LOG, 'utf8');
  let total = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.settled_at && r.settled_at.startsWith(today) && typeof r.amount_usdc === 'number') {
        total += r.amount_usdc;
      }
    } catch (_e) {
      // skip malformed line
    }
  }
  return total;
}

function appendReceipt(receipt) {
  if (!existsSync(DONATE_RECEIPTS_DIR)) {
    mkdirSync(DONATE_RECEIPTS_DIR, { recursive: true });
  }
  appendFileSync(DONATE_RECEIPTS_LOG, JSON.stringify(receipt) + '\n');
}

async function executeAutonomousDonation({ slug, amount_usdc }) {
  // 1. Pre-flight: keys present?
  const privateKeyBs58 = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKeyBs58) {
    throw new Error(
      'SOLANA_PRIVATE_KEY is not set in the MCP server environment. ' +
      'Autonomous donations are disabled. To enable: set SOLANA_PRIVATE_KEY ' +
      'in your Claude Desktop config or shell environment to a base58-encoded ' +
      'Solana keypair for a DEDICATED test wallet (do not use your main wallet). ' +
      'See https://giveready.org/AGENTS.md for the agent contract.'
    );
  }

  // 2. Cap checks
  if (!(amount_usdc > 0)) {
    throw new Error(`Amount must be positive. Got: ${amount_usdc}`);
  }
  if (amount_usdc > DONATE_PER_CALL_CAP_USDC) {
    throw new Error(
      `Per-call cap exceeded. Tried $${amount_usdc} USDC, max $${DONATE_PER_CALL_CAP_USDC}. ` +
      `Raise GIVEREADY_PER_CALL_USDC_CAP up to a hard ceiling of $1 to change this.`
    );
  }
  const spentToday = getSpendTodayUSDC();
  if (spentToday + amount_usdc > DONATE_DAILY_CAP_USDC) {
    throw new Error(
      `Daily cap exceeded. Already spent $${spentToday.toFixed(4)} USDC today, ` +
      `proposed $${amount_usdc} would push total to $${(spentToday + amount_usdc).toFixed(4)}, ` +
      `cap $${DONATE_DAILY_CAP_USDC}. Resets at 00:00 UTC.`
    );
  }

  // 3. Decode signing key
  let signer;
  try {
    signer = Keypair.fromSecretKey(bs58.decode(privateKeyBs58));
  } catch (e) {
    throw new Error(`SOLANA_PRIVATE_KEY is not a valid base58 keypair: ${e.message}`);
  }

  // 4. Get payment requirements (HTTP 402)
  const donateUrl = `${API_BASE}/api/donate/${slug}?amount=${amount_usdc}`;
  const reqRes = await fetch(donateUrl);
  if (reqRes.status !== 402) {
    const body = await reqRes.text();
    throw new Error(`Expected HTTP 402 from ${donateUrl}, got ${reqRes.status}: ${body.slice(0, 300)}`);
  }
  const xPaymentRequired = reqRes.headers.get('x-payment-required');
  if (!xPaymentRequired) {
    throw new Error('Server did not return X-PAYMENT-REQUIRED header. Endpoint may not support x402 for this nonprofit.');
  }
  const requirements = JSON.parse(Buffer.from(xPaymentRequired, 'base64').toString('utf8'));
  const accept = requirements.accepts && requirements.accepts[0];
  if (!accept || !accept.payTo) {
    throw new Error('Malformed payment requirements: no recipient wallet.');
  }

  // 5. Build SPL token transfer (USDC, 6 decimals)
  const recipient = new PublicKey(accept.payTo);
  const amountAtomic = BigInt(accept.maxAmountRequired);
  const connection = new Connection(SOLANA_RPC, 'confirmed');

  const senderATA = await getAssociatedTokenAddress(
    USDC_MINT_SOLANA,
    signer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const recipientATA = await getAssociatedTokenAddress(
    USDC_MINT_SOLANA,
    recipient,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Pre-flight balance check — fail fast with a clear message instead of an
  // opaque on-chain error.
  try {
    const balance = await connection.getTokenAccountBalance(senderATA);
    if (BigInt(balance.value.amount) < amountAtomic) {
      throw new Error(
        `Insufficient USDC in test wallet ${signer.publicKey.toBase58()}. ` +
        `Have ${balance.value.uiAmountString}, need $${amount_usdc}.`
      );
    }
  } catch (e) {
    if (e.message.includes('Insufficient')) throw e;
    // Non-existent ATA or RPC hiccup — proceed and let the broadcast surface
    // the real error.
  }

  const transferIx = createTransferCheckedInstruction(
    senderATA,
    USDC_MINT_SOLANA,
    recipientATA,
    signer.publicKey,
    amountAtomic,
    USDC_DECIMALS,
    [],
    TOKEN_PROGRAM_ID
  );

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const messageV0 = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [transferIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(messageV0);
  tx.sign([signer]);
  const serialized = Buffer.from(tx.serialize()).toString('base64');

  // 6. POST signed tx with X-PAYMENT header — server broadcasts + confirms
  const xPaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: accept.network,
    payload: { transaction: serialized, nonce: accept.extra && accept.extra.nonce },
  };
  const xPayment = Buffer.from(JSON.stringify(xPaymentPayload)).toString('base64');

  const postRes = await fetch(donateUrl, {
    method: 'POST',
    headers: { 'X-PAYMENT': xPayment, 'Content-Type': 'application/json' },
  });
  const postBody = await postRes.json().catch(() => ({}));
  if (postRes.status !== 200) {
    throw new Error(`Settlement rejected (${postRes.status}): ${JSON.stringify(postBody).slice(0, 400)}`);
  }

  // 7. Append receipt and return
  const receipt = {
    slug,
    nonprofit: accept.extra && accept.extra.name,
    amount_usdc,
    tx_hash: postBody.donation && postBody.donation.tx_hash,
    confirmed: postBody.donation && postBody.donation.confirmed,
    sender_wallet: signer.publicKey.toBase58(),
    settled_at: new Date().toISOString(),
    spent_today_after: spentToday + amount_usdc,
  };
  appendReceipt(receipt);
  return receipt;
}

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

server.tool(
  'donate_autonomous',
  `Send a small USDC donation to a verified nonprofit on the GiveReady directory, signed and broadcast directly from this MCP server's configured Solana keypair via the x402 protocol.

  AUTHORISATION & SAFETY (read carefully — the user is trusting you with funds):
  - Only fires if the MCP server has SOLANA_PRIVATE_KEY set in its environment. Otherwise the tool throws a clear error and no transaction is built.
  - Hard caps: max $${1} USDC per single call, max $${5} USDC per day across all calls. The caps are enforced server-side; you cannot exceed them by retrying.
  - Wallet balance check happens before signing. If insufficient USDC, the tool fails fast.
  - Every successful donation appends a receipt to ~/.giveready/donations.log on the host machine.
  - The keypair MUST be a dedicated test wallet provisioned for this purpose, not the user's main wallet. The MCP user is responsible for that pre-commitment.

  WHAT THIS TOOL DOES:
  1. Hits GET /api/donate/{slug}?amount=N — server returns HTTP 402 with payment requirements (recipient wallet, USDC mint, network).
  2. Builds an SPL token transfer for the exact atomic amount, signs with the configured keypair.
  3. POSTs the signed transaction back as the X-PAYMENT header. Server broadcasts to Solana mainnet via its own RPC, confirms, and writes to the donations table.
  4. Returns the on-chain transaction hash and a Solscan link.

  WHEN TO USE:
  Use only when the user has clearly asked you to donate, named the recipient nonprofit (slug), and named an amount. Never default a donation. Never round up. If the user says "donate something" without an amount, ask for one before calling — this tool is not the place for guesses.`,
  {
    slug: z.string().describe('Verified-nonprofit slug (e.g., "finn-wardman-world-explorer-fund", "city-kids-surfing"). Must be a slug returned from search_nonprofits or known to have a usdc_wallet — endpoints without a wallet redirect rather than settling.'),
    amount_usdc: z.number().describe(`Donation amount in USDC. Hard cap $${1} per call, $${5} per day. The user must have explicitly named this amount; never invent it.`),
    confirm: z.literal(true).describe('Pass true to confirm the user has explicitly authorised this exact donation. Refuse to set this if the user has not named the amount and recipient.'),
  },
  async ({ slug, amount_usdc, confirm }) => {
    if (confirm !== true) {
      return {
        content: [{
          type: 'text',
          text: 'Donation refused: confirm flag was not set. The user must explicitly authorise the recipient and amount before this tool fires.',
        }],
      };
    }
    try {
      const r = await executeAutonomousDonation({ slug, amount_usdc });
      const lines = [
        `Donation settled: $${r.amount_usdc} USDC to ${r.nonprofit || r.slug}.`,
        `Transaction: ${r.tx_hash || '(no hash returned)'}`,
        r.tx_hash ? `Solscan: https://solscan.io/tx/${r.tx_hash}` : null,
        `Confirmed: ${r.confirmed ? 'yes' : 'broadcast — confirmation pending'}`,
        `Sender wallet: ${r.sender_wallet}`,
        `Spent today after this donation: $${r.spent_today_after.toFixed(4)} USDC of $${DONATE_DAILY_CAP_USDC} daily cap.`,
        `Receipt logged to ~/.giveready/donations.log.`,
      ].filter(Boolean);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    } catch (e) {
      return {
        content: [{
          type: 'text',
          text: `Donation did not complete: ${e.message}`,
        }],
        isError: true,
      };
    }
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
