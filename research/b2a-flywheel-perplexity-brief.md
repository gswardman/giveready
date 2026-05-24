# Research Brief — Perplexity

**Target:** Reverse-engineer what other B2A (business-to-agent) SaaS platforms have done to convert interactive agents from reading docs to writing data.
**Owner:** Geordie Wardman, TestVentures.net / GiveReady.org
**Date:** 2026-05-21

---

## Our problem in one paragraph

GiveReady is a B2A directory of 41,216 nonprofits with two write endpoints — `/api/enrich` (crowdsourced data improvement) and `/api/donations` (USDC stablecoin donations). In the last 7 days we recorded 8,309 training-crawler hits (GPTBot, ClaudeBot, Google AI, Perplexity, Cohere) — these UAs ingest pages offline and cannot submit by design. We recorded 20 interactive-agent visits (ChatGPT-User, Claude User, Perplexity User) — these read `/AGENTS.md` and left. Zero wild submissions. The bottleneck is no longer discovery; it is conversion of an interactive agent's first read into its first write. We want concrete, evidence-backed patterns from platforms that have already solved this.

## What we want back

Patterns from real B2A platforms with shipped product. For each, return:

1. Platform name + canonical URL.
2. The exact mechanism they shipped — what their agent-facing docs page contains, their auth model, their first-call payload, whether they ship an MCP server, whether they offer a sandbox endpoint.
3. Evidence it worked — published numbers, dashboards, blog posts, case studies, engineering writeups. If no public numbers exist, say so explicitly.
4. Whether the agent reader and agent writer are the same entity, or separated by a registration / OAuth / API-key step.
5. The smallest first call an agent can make. Is it anonymous? Authenticated? Sandbox-only?

## Platforms worth investigating

**Tier 1 — known to have shipped a B2A write path:**

- Stripe Agent Toolkit / Stripe MCP
- Shopify agent integrations / Shop AI
- Linear MCP server (heavy developer agent traffic, public install numbers)
- Notion MCP / Notion AI integrations
- Composio (explicit B2A platform — hundreds of claimed integrations)
- Arcade.dev (explicit B2A auth platform)
- Zapier MCP
- HubSpot MCP
- Salesforce Agentforce (any externally-exposed endpoints)
- Anthropic's official MCP partner list (Notion, Linear, Asana, GitHub, Atlassian, Slack) — which of these report actual write usage?

**Tier 2 — registries with usage signal:**

- Smithery, Glama, PulseMCP, mcp.so
- The Anthropic-published MCP partner usage data, if any

**Tier 3 — failure cases (equally valuable):**

- OpenAI Plugin Store (deprecated April 2024) — why did it fail? Published post-mortems?
- ChatGPT Actions / custom GPTs — actual usage vs initial hype?
- Bing chat plugins (deprecated) — lessons?

## Specific questions to answer

1. What is the typical conversion rate from `agent reads docs` to `agent writes first call` across published B2A platforms? Single-digit percent? Lower?
2. Does any platform allow anonymous write on the first call (no auth, no signup)? Who tried it and what was the outcome — abuse, traction, both?
3. Of platforms with public usage data, who has the highest agent-write volume per agent-read? What is distinctive about their docs page or MCP server?
4. What belongs on an effective agent-facing landing page (`/AGENTS.md` equivalent)? An inline `curl -X POST` example above the prose? An MCP install URL? A sandbox endpoint? All of the above?
5. Has anyone published the time lag between training-crawler ingest (GPTBot, ClaudeBot) and downstream interactive-agent action (ChatGPT-User, Claude User) on the same content? Days, weeks, months?
6. For interactive-agent traffic that reads and leaves without writing, has any platform diagnosed the reason and published the diagnosis? (e.g. auth required mid-task, payload too complex, no idempotency, agent ran out of context, agent couldn't reason about the field schema.)
7. Has any platform deliberately optimised their docs separately for training crawlers vs interactive agents, and if so, what does the split look like?

## Out of scope

- Generic "agents are the future" think pieces
- Vendor marketing claims without numbers or mechanism detail
- B2C agent end-user products (Cursor, Claude Code, Replit Agent as user tools) — we are researching B2A platforms, not the agents themselves
- Theoretical proposals without shipped product

## Output format

A ranked list of 5-10 patterns, ordered by evidence strength: published numbers > case studies > engineering blog posts > inferred from public docs > speculation. For each, one paragraph and one source URL. We will cherry-pick 1-2 to test on GiveReady within a week.

## What we will do with this

The two tests we have already queued (instrument an interactive-agent funnel-drop event on `/AGENTS.md`; add a minimal copy-paste-ready `curl` example at the top of `/AGENTS.md`) are first-principles guesses. If the research surfaces a third or fourth pattern with better evidence, we re-rank and run that one first. The goal is to compress the next month of iteration into one week of reading.
