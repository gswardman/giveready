/**
 * GiveReady — AI agent / crawler user-agent classification and route classes for the traffic rollup.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

// Agent filter: allowlist of known AI agents and crawlers we want to track.
// Inverted from the old prefix-based blocklist after CSO audit finding H2:
// the old startsWith('Bun/') approach was trivially spoofed by prepending
// 'Mozilla' or any non-matching string to a noise UA. An attacker could also
// impersonate a real agent by using its prefix. The allowlist uses substring
// matching against verified crawler identifiers.
//
// Feature flag: set AGENT_FILTER_MODE=blocklist in env to revert to old behavior.
// Default: allowlist (new, secure).
export const KNOWN_AGENT_PATTERNS = [
  // AI model traffic, split by who is actually at the keyboard.
  //
  // type='training_crawler' = offline ingestion for the next model snapshot.
  //   Cannot POST /api/enrich because it is not at inference. Reads pages,
  //   stores them, never calls back. GPTBot, ClaudeBot, Google-Extended, etc.
  // type='interactive_agent' = at inference, on behalf of a user or another
  //   agent. CAN curl /api/enrich. These are the UAs we built the funnel for.
  //   ChatGPT-User, Claude-User, Perplexity-User, OAI-SearchBot, Claude-SearchBot.
  // type='search_crawler' = classic web/search index crawler. Reads /AGENTS.md,
  //   /llms.txt, /sitemap.xml. Never writes. Googlebot, bingbot, Applebot, etc.
  //
  // The split was added 2026-05-20 after the giveready-daily Hypothesis #1
  // showed that 8,335 of 8,338 "writing-agent" hits over 7d were training
  // crawlers (GPTBot+ClaudeBot) that physically cannot submit. The old
  // 'writing' bucket conflated two populations with opposite conversion
  // potential. The interactive_agent bucket is the only honest denominator
  // for "agents that could have enriched but did not."
  { pattern: 'GPTBot',             name: 'OpenAI GPT',                type: 'training_crawler' },
  { pattern: 'ClaudeBot',          name: 'Anthropic Claude',          type: 'training_crawler' },
  { pattern: 'Google-Extended',    name: 'Google AI',                 type: 'training_crawler' },
  { pattern: 'PerplexityBot',      name: 'Perplexity',                type: 'training_crawler' },
  { pattern: 'cohere-ai',          name: 'Cohere',                    type: 'training_crawler' },
  { pattern: 'ChatGPT-User',       name: 'OpenAI ChatGPT (User)',     type: 'interactive_agent' },
  { pattern: 'OAI-SearchBot',      name: 'OpenAI Search',             type: 'interactive_agent' },
  { pattern: 'Claude-User',        name: 'Anthropic Claude (User)',   type: 'interactive_agent' },
  { pattern: 'Claude-SearchBot',   name: 'Anthropic Claude Search',   type: 'interactive_agent' },
  { pattern: 'Perplexity-User',    name: 'Perplexity (User)',         type: 'interactive_agent' },
  // Search engine crawlers (they read /llms.txt, /agents.md, /mcp too — but don't write)
  { pattern: 'Googlebot',          name: 'Google Search',             type: 'search_crawler' },
  { pattern: 'bingbot',            name: 'Microsoft Bing',            type: 'search_crawler' },
  { pattern: 'Applebot',           name: 'Apple',                     type: 'search_crawler' },
  { pattern: 'DuckDuckBot',        name: 'DuckDuckGo',                type: 'search_crawler' },
  { pattern: 'YandexBot',          name: 'Yandex',                    type: 'search_crawler' },
  // Amzn-SearchBot removed 2026-05-14 per giveready-daily Hypothesis #2:
  // 99% of 24h discovery hits, zero submissions in 32d. Drowned the real
  // writing-agent funnel signal. Falls into noise_breakdown via
  // isKnownAgent → isNoiseAgent now. Re-add if Amazon ever ships a writing
  // agent that uses this UA, or if we want the search-crawler footprint
  // visible in the dashboard for SEO reasons.
  { pattern: 'SemrushBot',         name: 'SEMrush',                   type: 'search_crawler' },
  // Brave (added 2026-08-22). Load-bearing beyond ordinary SEO: Anthropic lists
  // Brave Search as the subprocessor behind Claude's web_search tool, so Brave's
  // index is what Claude retrieves from. A page absent from Brave cannot be cited
  // by Claude no matter how good it is. Confirmed 2026-08-22: giveready.org root,
  // causes/* and docs.giveready.org are in Brave's index; /guides/* is NOT, and
  // Claude scored 0/10 with all ten misses classed not-retrieved.
  // Until today Brave was absent from this allowlist entirely, so any BraveBot
  // visit fell into noise_breakdown and was invisible. The first Brave hit on a
  // /guides route is the signal that the 2026-08-22 URL submissions worked.
  { pattern: 'BraveBot',           name: 'Brave Search',              type: 'search_crawler' },
  { pattern: 'Bravebot',           name: 'Brave Search',              type: 'search_crawler' },
  { pattern: 'Brave-Search',       name: 'Brave Search',              type: 'search_crawler' },
  // MCP ecosystem crawlers
  { pattern: 'MCPRegistry',        name: 'MCP Registry',              type: 'search_crawler' },
  { pattern: 'Smithery',           name: 'Smithery',                  type: 'search_crawler' },
  { pattern: 'PulseMCP',           name: 'PulseMCP',                  type: 'search_crawler' },
  { pattern: 'GlamaMCP',           name: 'Glama MCP',                 type: 'search_crawler' },
];

export const KNOWN_TRAINING_CRAWLER_PATTERNS  = KNOWN_AGENT_PATTERNS.filter((e) => e.type === 'training_crawler');
export const KNOWN_INTERACTIVE_AGENT_PATTERNS = KNOWN_AGENT_PATTERNS.filter((e) => e.type === 'interactive_agent');
export const KNOWN_SEARCH_CRAWLER_PATTERNS    = KNOWN_AGENT_PATTERNS.filter((e) => e.type === 'search_crawler');

// Backward-compat aliases for callers that still read the old taxonomy.
// The old 'writing' super-bucket conflated training + interactive — keep an
// alias pointing at both so any cron still parsing discovery_hits_in_period_writing_agents
// returns a number, not null, during the rollover.
export const KNOWN_WRITING_AGENT_PATTERNS = [...KNOWN_TRAINING_CRAWLER_PATTERNS, ...KNOWN_INTERACTIVE_AGENT_PATTERNS];
const KNOWN_CRAWLER_PATTERNS = KNOWN_SEARCH_CRAWLER_PATTERNS;

// Fast UA → type lookup for funnel tagging.
export function agentTypeFor(ua) {
  if (!ua) return null;
  const hit = KNOWN_AGENT_PATTERNS.find((entry) => ua.includes(entry.pattern));
  return hit ? hit.type : null;
}

// UA → friendly name. Same lookup as agentTypeFor, different field. Used by the
// agent x route matrix so the output reads "Perplexity" rather than 140 chars of
// Mozilla boilerplate, and so two UA strings for the same crawler collapse into
// one row.
export function agentNameFor(ua) {
  if (!ua) return null;
  const hit = KNOWN_AGENT_PATTERNS.find((entry) => ua.includes(entry.pattern));
  return hit ? hit.name : null;
}

// Route → route class (added 2026-08-22).
//
// Why classes and not raw routes: the standing question is never "how many hits
// on /guides/best-surf-therapy-charities-for-at-risk-youth", it is "did this
// crawler touch the guides AT ALL". Raw routes scatter that across seven rows
// and hide it. The 2026-08-17..21 PerplexityBot sweep is the case in point:
// 446 hits, 223 of them on /AGENTS.md, 14 across all guide URLs combined, and
// answering that took two independent GROUP BYs and manual arithmetic.
//
// Order matters. First match wins.
export function routeClassFor(route) {
  if (!route) return 'other';
  // Read agents-manifest counts before 2026-09-09 with care: every nonprofit
  // page linked /AGENTS.md?from=np&slug=<slug>, one distinct URL per nonprofit,
  // and the query string is not stored, so a full-directory crawl logged one
  // manifest hit per page. GPTBot on 2026-09-08: 3,435 nonprofit hits, 3,435
  // manifest hits. The per-slug link is gone; the class now measures direct
  // fetches only.
  if (route === '/AGENTS.md' || route === '/agents.md') return 'agents-manifest';
  if (route === '/llms.txt') return 'llms';
  if (route === '/sitemap.xml') return 'sitemap';
  if (route === '/mcp' || route.startsWith('/mcp/')) return 'mcp';
  if (route.startsWith('/guides')) return 'guides';
  // Added 2026-09-17 with migration 026. These four classes are unreachable in
  // historical discovery_hits data: none of these routes has ever been in the
  // logging allowlist, so no stored row can carry them and no past figure is
  // reclassified by adding them. They exist for traffic_rollup, which counts
  // every request. Keep the SQL CASE in handleAdminTraffic identical.
  //
  // '/nonprofits' exactly (the directory listing and its ?page=N pagination,
  // query strings are not stored) is separated from '/nonprofits/<slug>'
  // deliberately. Conflating them is what would hide a paginated directory walk
  // inside the profile-page count, and a paginated walk is the leading
  // explanation for the 2026-09-16 burst. This branch must stay ABOVE the
  // startsWith('/nonprofits') branch below it.
  if (route === '/') return 'home';
  if (route === '/nonprofits') return 'nonprofits-list';
  if (route.startsWith('/out')) return 'out';
  if (route.startsWith('/search')) return 'search';
  if (route.startsWith('/nonprofits')) return 'nonprofits';
  if (route.startsWith('/causes')) return 'causes';
  if (route.startsWith('/donate')) return 'donate';
  if (route.startsWith('/api/agents') || route.startsWith('/api/enrich')
      || route.startsWith('/api/needs-enrichment') || route.startsWith('/api/enrichments')) {
    return 'agent-api';
  }
  if (route.startsWith('/api/')) return 'other-api';
  return 'other';
}

// Legacy blocklist kept for feature flag rollback (AGENT_FILTER_MODE=blocklist).
export const AGENT_NOISE_PREFIXES = [
  'Bun/', 'curl/', 'wget/', 'Go-http-client', 'Python-requests',
  'python-httpx', 'python-urllib', 'node-fetch', 'axios/', 'okhttp/',
  'libwww-perl', 'Apache-HttpClient', 'Java/', 'Ruby', 'PostmanRuntime',
];

export function isKnownAgent(ua) {
  if (!ua) return false;
  return KNOWN_AGENT_PATTERNS.some((entry) => ua.includes(entry.pattern));
}

export function isNoiseAgent(ua, env) {
  // Feature flag: AGENT_FILTER_MODE=blocklist reverts to old prefix-based filter
  if (env && env.AGENT_FILTER_MODE === 'blocklist') {
    if (!ua) return true;
    return AGENT_NOISE_PREFIXES.some((p) => ua.startsWith(p));
  }
  // Default (allowlist): anything not a known agent is noise
  return !isKnownAgent(ua);
}
