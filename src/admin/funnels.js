/**
 * GiveReady — Admin funnel telemetry: onboarding funnel, guide click-out funnel, guide crawl.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json } from '../lib/http.js';
import { classifyReferrer } from '../lib/telemetry.js';
import { KNOWN_AGENT_PATTERNS } from '../lib/user-agents.js';
import { checkAdminAuth } from './auth.js';

// Health checks and probes tag themselves with an RFC 2606 .invalid domain,
// which can never be a real address. Excluded from every funnel count so that
// monitoring the path does not pollute the path's own numbers.
const FUNNEL_SYNTHETIC = `(email_domain IS NOT NULL AND email_domain LIKE '%.invalid')`;

// GET /api/admin/funnel-onboarding?hours=N
// The operator-facing read of the charity path. Answers one question:
// where do charities stop, and why. Ordered by how far along the path each
// step sits, so the drop is readable top to bottom rather than by volume.
export async function handleOnboardingFunnel(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const hoursRaw = parseInt(url.searchParams.get('hours') || '168', 10);
  const hours = Math.min(Math.max(Number.isFinite(hoursRaw) ? hoursRaw : 168, 1), 8760);
  const since = `-${hours} hours`;

  // Path order. Anything not listed sorts last.
  const STEP_ORDER = [
    'register_attempt', 'register_fail', 'register_success',
    'claim_attempt',
    'signin_request', 'signin_no_charity', 'signin_success',
    'profile_edit', 'wallet_set', 'wallet_cleared',
    'signin_email_failed', 'claim_email_failed',
    'verified', 'donate_redirect', 'donate_quote', 'donate_settled', 'donate_reconciled',
  ];

  const steps = await db.prepare(`
    SELECT step, outcome, COUNT(*) AS hits, COUNT(DISTINCT actor_hash) AS actors,
           MAX(created_at) AS last_seen
    FROM onboarding_events
    WHERE created_at > datetime('now', ?1) AND NOT ${FUNNEL_SYNTHETIC}
    GROUP BY step, outcome
  `).bind(since).all();

  const failures = await db.prepare(`
    SELECT step, reason, COUNT(*) AS hits, MAX(created_at) AS last_seen
    FROM onboarding_events
    WHERE created_at > datetime('now', ?1) AND NOT ${FUNNEL_SYNTHETIC} AND outcome = 'fail' AND reason IS NOT NULL
    GROUP BY step, reason
    ORDER BY hits DESC
    LIMIT 20
  `).bind(since).all();

  const domains = await db.prepare(`
    SELECT email_domain, COUNT(DISTINCT actor_hash) AS actors, MIN(created_at) AS first_seen
    FROM onboarding_events
    WHERE created_at > datetime('now', ?1) AND NOT ${FUNNEL_SYNTHETIC} AND email_domain IS NOT NULL
    GROUP BY email_domain
    ORDER BY actors DESC
    LIMIT 15
  `).bind(since).all();

  const rows = steps.results || [];
  const counts = {};
  for (const r of rows) {
    counts[r.step] = (counts[r.step] || 0) + r.hits;
  }

  const attempts = counts.register_attempt || 0;
  const successes = counts.register_success || 0;
  const verified = counts.verified || 0;

  // The honest headline: of everyone who tried to register, how many got a
  // page a donor could actually give through.
  const completion = attempts > 0 ? Number(((verified / attempts) * 100).toFixed(1)) : null;

  // Biggest single drop between consecutive populated steps on the path.
  let worstDrop = null;
  const populated = STEP_ORDER.filter(s => !s.endsWith('_fail') && !s.endsWith('_no_charity') && counts[s] != null);
  for (let i = 0; i < populated.length - 1; i++) {
    const from = populated[i], to = populated[i + 1];
    const lost = (counts[from] || 0) - (counts[to] || 0);
    if (lost > 0 && (!worstDrop || lost > worstDrop.lost)) {
      worstDrop = { from, to, lost, from_count: counts[from], to_count: counts[to] };
    }
  }

  return json({
    period: `last ${hours} hours`,
    summary: {
      register_attempts: attempts,
      register_successes: successes,
      register_failures: counts.register_fail || 0,
      signin_requests: counts.signin_request || 0,
      signin_dead_ends: counts.signin_no_charity || 0,
      wallets_set: counts.wallet_set || 0,
      verified,
      donate_quotes: counts.donate_quote || 0,
      donate_redirects: counts.donate_redirect || 0,
      completion_rate_pct: completion,
    },
    biggest_drop: worstDrop,
    steps: rows.sort((a, b) => {
      const ia = STEP_ORDER.indexOf(a.step), ib = STEP_ORDER.indexOf(b.step);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }),
    top_failure_reasons: failures.results || [],
    domains: domains.results || [],
    notes: [
      'Instrumentation starts at migration 020 deploy (2026-08-01). Nothing before that date exists.',
      'actor counts are distinct hashed emails, not people. No raw emails or IPs are stored.',
      'completion_rate_pct is verified / register_attempts over the window, so it lags for orgs still in review.',
    ],
  });
}

// Guide -> nonprofit -> donate funnel (migration 018, anti-slop guardrail #5).
// Answers: are AI assistants sending humans to the guides, do those humans click
// through to nonprofit profiles, and does anything reach the donate path?
// Phase 1 is page-view attribution only; per-donation ref linkage is a separate
// eng-reviewed change if this shows real traffic.
// UA predicate for /out clicks that are not a person. Shared by the funnel row
// query and its uncapped totals so the two can never disagree. '%bot%' covers
// Amazonbot, PetalBot, GPTBot, ClaudeBot, bingbot, Applebot and the rest;
// the others are scripts and headless fetchers. SQLite LIKE is case-insensitive.
export const CLICK_OUT_BOT_SQL = [
  "user_agent IS NULL", "user_agent = ''",
  "user_agent LIKE 'GiveReady-Smoketest/%'",
  "user_agent LIKE '%bot%'", "user_agent LIKE '%crawl%'", "user_agent LIKE '%spider%'",
  "user_agent LIKE '%curl/%'", "user_agent LIKE '%wget%'", "user_agent LIKE '%python%'",
  "user_agent LIKE '%aiohttp%'", "user_agent LIKE '%node%'", "user_agent LIKE '%Go-http%'",
  "user_agent LIKE '%HeadlessChrome%'", "user_agent LIKE '%http-client%'",
].join(' OR ');

// Behavioural predicate for /out clicks, 2026-09-15. The string filter above
// missed a walker with a plain Chrome desktop UA that clicked Donate on every
// listed charity in alphabetical order, twice each: 541 click-outs on 09-13,
// 938 on 09-14, zero excluded, against 15 donate-page views. The UA rotates
// (three Chrome strings in one day), so any string match lags it. A person does
// not click Donate on more than 20 different charities in a week; a UA that
// does is a crawler whatever it calls itself. Same ?1 window as the outer
// query, so the rule is judged on the period being reported. There is no IP
// column on onboarding_events (by design, see migration 020), so UA is the
// only key available.
// Threshold history: 20 on first deploy (2026-09-15 09:09), which caught 951
// of 970 clicks in 24h but left one Chrome string at 19 hits on 19 slugs,
// alphabetical, plus 12/11 and 6/6 strings in 7d. The scraper rotates through
// ten-plus browser UAs and each one walks a slice under 100 charities, so a
// high bar lets each slice through until it crosses. Lowered to 5 the same
// morning: a person clicks Donate on one to three charities in a week. A
// shared human UA would need six distinct charities' donors in one window to
// trip this; today's real click-outs run at about five a week in total.
// Revisit when real 7d click-outs pass 50.
//
// 2026-09-16: the walker set is now judged over a FIXED lookback (?2, 30d),
// not the reported window. With N=5 judged inside each window, the 24h read
// (20) came out above the 7d read (18): a UA that walks four slugs a day never
// trips the rule in 24h but does in 7d, so the shorter window was the leakier
// one. The 24h survivors were nine browser strings at 1 to 5 slugs each, all
// one-per-slug to every.org on obscure listings, several claiming Chrome 99,
// 110 and 119. Judging every window against the same 30d set makes 24h a
// subset of 7d by construction, and a UA that walked 500 slugs last week stays
// excluded today even if it only clicked twice.
export const CLICK_OUT_WALKER_MIN_SLUGS = 5;
export const CLICK_OUT_WALKER_LOOKBACK_HOURS = 720;
export const CLICK_OUT_WALKER_SQL =
  `user_agent IN (SELECT user_agent FROM onboarding_events
     WHERE step = 'donate_click_out' AND created_at > datetime('now', ?2)
     GROUP BY user_agent HAVING COUNT(DISTINCT slug) > ${CLICK_OUT_WALKER_MIN_SLUGS})`;

export async function handleGuideFunnel(db, env, request, url) {
  const authFail = checkAdminAuth(env, request);
  if (authFail) return authFail;

  let hours = parseInt(url.searchParams.get('hours') || '168');
  if (!Number.isFinite(hours) || hours < 1) hours = 168;
  hours = Math.min(hours, 2160);
  const sinceArg = `-${hours} hours`;
  // Walker set is judged over the fixed lookback, never the reported window.
  const walkerSinceArg = `-${CLICK_OUT_WALKER_LOOKBACK_HOURS} hours`;

  const [guideRows, npRefRows, donateRows, donations, clickOutRows, clickOutTotals, clickOutHumanUAs, clickOutWalkerUAs, utmRows] = await Promise.all([
    db.prepare(
      `SELECT referrer, COUNT(*) as hits FROM discovery_hits
       WHERE route LIKE '/guides/%' AND created_at > datetime('now', ?1)
       GROUP BY referrer`
    ).bind(sinceArg).all(),
    db.prepare(
      `SELECT ref, route, COUNT(*) as hits FROM discovery_hits
       WHERE route LIKE '/nonprofits/%' AND ref LIKE 'guide-%'
         AND created_at > datetime('now', ?1)
       GROUP BY ref, route ORDER BY hits DESC LIMIT 25`
    ).bind(sinceArg).all(),
    db.prepare(
      `SELECT referrer, ref, COUNT(*) as hits FROM discovery_hits
       WHERE route LIKE '/donate/%' AND created_at > datetime('now', ?1)
       GROUP BY referrer, ref`
    ).bind(sinceArg).all(),
    db.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount_usdc), 0) as total_usdc
       FROM donations WHERE status = 'settled' AND created_at > datetime('now', ?1)`
    ).bind(sinceArg).first(),
    // Outbound clicks to a charity's own donation page (2026-09-07). This is
    // the far end of the funnel for every nonprofit without a wallet, which is
    // all of them. Before this existed the funnel stopped at the donate-page
    // view and the only completion metric was on-chain settlement, which no
    // real donor has ever used.
    //
    // 2026-09-11: crawlers count too. Two days after the listing Donate buttons
    // went through /out, the 24h reading was 54 clicks across 25 alphabetically
    // adjacent slugs at 2-3 hits each, all ref=direct, all to every.org: a
    // crawler walking /nonprofits and following every Donate button (robots.txt
    // disallows /out/, which Amazonbot ignores). Only the smoke test was being
    // excluded, and `total` was the sum of the 25 capped rows, so it was a floor
    // that could never exceed 75. Now: bot UAs are excluded from the rows AND
    // total is an uncapped COUNT over human UAs, with the bot count alongside so
    // the exclusion itself is visible. onboarding_events is small, so the LIKE
    // chain is cheap here (unlike discovery_hits, see /api/admin/traffic).
    //
    // 2026-09-15: the walker predicate (CLICK_OUT_WALKER_SQL) is applied after
    // the string filter, and its exclusions are counted separately so the
    // digest can see both instruments working.
    db.prepare(
      `SELECT slug, reason, COUNT(*) as hits FROM onboarding_events
       WHERE step = 'donate_click_out' AND created_at > datetime('now', ?1)
         AND NOT (${CLICK_OUT_BOT_SQL})
         AND NOT (${CLICK_OUT_WALKER_SQL})
       GROUP BY slug, reason ORDER BY hits DESC LIMIT 25`
    ).bind(sinceArg, walkerSinceArg).all().catch(() => ({ results: [] })),
    db.prepare(
      `SELECT
         SUM(CASE WHEN (${CLICK_OUT_BOT_SQL}) THEN 0
                  WHEN (${CLICK_OUT_WALKER_SQL}) THEN 0 ELSE 1 END) as human_hits,
         SUM(CASE WHEN (${CLICK_OUT_BOT_SQL}) THEN 1 ELSE 0 END) as bot_hits,
         SUM(CASE WHEN (${CLICK_OUT_BOT_SQL}) THEN 0
                  WHEN (${CLICK_OUT_WALKER_SQL}) THEN 1 ELSE 0 END) as walker_hits,
         COUNT(*) as raw_hits
       FROM onboarding_events
       WHERE step = 'donate_click_out' AND created_at > datetime('now', ?1)`
    ).bind(sinceArg, walkerSinceArg).first().catch(() => null),
    // Who the surviving "human" clicks are. Added 2026-09-11 after the bot
    // filter left 78 clicks in 7d that were still one-per-slug, alphabetical,
    // every.org: a crawler with a browser UA. Without this the residual cannot
    // be diagnosed except through /api/admin/traffic, which is too expensive.
    // Since 2026-09-15 this lists UAs that survive BOTH filters, so a row here
    // with slugs approaching CLICK_OUT_WALKER_MIN_SLUGS is the next walker.
    db.prepare(
      `SELECT user_agent, COUNT(*) as hits, COUNT(DISTINCT slug) as slugs
       FROM onboarding_events
       WHERE step = 'donate_click_out' AND created_at > datetime('now', ?1)
         AND NOT (${CLICK_OUT_BOT_SQL})
         AND NOT (${CLICK_OUT_WALKER_SQL})
       GROUP BY user_agent ORDER BY hits DESC LIMIT 10`
    ).bind(sinceArg, walkerSinceArg).all().catch(() => ({ results: [] })),
    // The walkers themselves, named, so the exclusion is auditable from the
    // response rather than taken on trust.
    db.prepare(
      `SELECT user_agent, COUNT(*) as hits, COUNT(DISTINCT slug) as slugs
       FROM onboarding_events
       WHERE step = 'donate_click_out' AND created_at > datetime('now', ?1)
         AND NOT (${CLICK_OUT_BOT_SQL})
         AND (${CLICK_OUT_WALKER_SQL})
       GROUP BY user_agent ORDER BY hits DESC LIMIT 10`
    ).bind(sinceArg, walkerSinceArg).all().catch(() => ({ results: [] })),
    // 2026-10-01: visits carrying ?utm_source= (stored as ref 'utm-<source>' by
    // discoveryRefFromUrl). The range predicate on ref uses idx_discovery_ref;
    // a LIKE would not. Bots split out with the same string filter as /out so
    // a crawler re-fetching a cited URL is not counted as a person.
    db.prepare(
      `SELECT ref, route,
         SUM(CASE WHEN (${CLICK_OUT_BOT_SQL}) THEN 0 ELSE 1 END) as human_hits,
         SUM(CASE WHEN (${CLICK_OUT_BOT_SQL}) THEN 1 ELSE 0 END) as bot_hits
       FROM discovery_hits
       WHERE ref >= 'utm-' AND ref < 'utm.' AND created_at > datetime('now', ?1)
       GROUP BY ref, route ORDER BY human_hits DESC LIMIT 50`
    ).bind(sinceArg).all().catch(() => ({ results: [] })),
  ]);

  const utmBySource = {};
  let utmHuman = 0;
  let utmBot = 0;
  for (const row of utmRows.results || []) {
    const src = String(row.ref).slice(4);
    utmBySource[src] = (utmBySource[src] || 0) + (row.human_hits || 0);
    utmHuman += row.human_hits || 0;
    utmBot += row.bot_hits || 0;
  }

  const guideViews = { ai_assistant: 0, search: 0, internal: 0, other: 0, none: 0, total: 0 };
  for (const row of guideRows.results || []) {
    const cls = classifyReferrer(row.referrer);
    guideViews[cls] += row.hits;
    guideViews.total += row.hits;
  }

  const donatePath = { ai_assistant: 0, search: 0, internal: 0, other: 0, none: 0, from_guide_ref: 0, total: 0 };
  for (const row of donateRows.results || []) {
    const cls = classifyReferrer(row.referrer);
    donatePath[cls] += row.hits;
    donatePath.total += row.hits;
    if (row.ref && row.ref.startsWith('guide-')) donatePath.from_guide_ref += row.hits;
  }

  return json({
    period_hours: hours,
    // See noStore() and handleAdminTraffic. The funnel endpoint replayed a stale
    // response alongside traffic on 2026-09-01, so it carries the same clock.
    generated_at: new Date().toISOString(),
    guide_views_by_referrer: guideViews,
    nonprofit_views_from_guides: {
      total: (npRefRows.results || []).reduce((s, r) => s + r.hits, 0),
      by_ref_and_route: npRefRows.results || [],
    },
    donate_path: donatePath,
    // The measurable end of the redirect funnel. total is clicks that left for
    // a charity's own donation page; by_guide attributes them to the guide in
    // utm_content. What happens after the click is in the charity's analytics,
    // not ours, which is why the UTMs exist.
    donate_click_out: {
      // Uncapped, human UAs only. Falls back to the row sum if the totals
      // query failed, and says so.
      total: clickOutTotals ? (clickOutTotals.human_hits || 0)
        : (clickOutRows.results || []).reduce((n, r) => n + (r.hits || 0), 0),
      total_is_uncapped: !!clickOutTotals,
      bot_hits_excluded: clickOutTotals ? (clickOutTotals.bot_hits || 0) : null,
      // 2026-09-15: clicks from a UA that hit Donate on more than
      // walker_min_slugs distinct charities in this window. Reported apart from
      // bot_hits_excluded so the two filters are separately auditable.
      walker_hits_excluded: clickOutTotals ? (clickOutTotals.walker_hits || 0) : null,
      walker_min_slugs: CLICK_OUT_WALKER_MIN_SLUGS,
      // 2026-09-16: the walker set is built over this fixed lookback and applied
      // to whatever window is reported, so 24h is always a subset of 7d.
      walker_lookback_hours: CLICK_OUT_WALKER_LOOKBACK_HOURS,
      walker_user_agents: clickOutWalkerUAs.results || [],
      raw_hits: clickOutTotals ? (clickOutTotals.raw_hits || 0) : null,
      by_slug_and_ref: clickOutRows.results || [],
      // hits and distinct slugs per surviving UA. A UA with hits ~= slugs
      // walking a listing is a crawler the filter missed, whatever it calls itself.
      human_by_user_agent: clickOutHumanUAs.results || [],
    },
    // Human visits arriving from an AI answer, identified by utm_source because
    // the Referer is stripped. Counts only routes that discovery_hits logs
    // (guides, causes, nonprofits, learn, donate and the agent files), not the
    // home page.
    ai_utm_visits: {
      total: utmHuman,
      bot_hits_excluded: utmBot,
      by_source: utmBySource,
      by_route: (utmRows.results || []).slice(0, 25),
    },
    donations_in_period_context: donations,
    notes: [
      'Attribution starts at migration 018 deploy; rows before that have null referrer/ref.',
      'ai_utm_visits starts at the 2026-10-01 deploy; visits before it carried utm_source but it was not stored. Logged routes only, home page excluded.',
      'ai_assistant = Referer from perplexity.ai, chatgpt.com, claude.ai, copilot, gemini, you.com, phind, poe.',
      'from_guide_ref counts donate-page views carrying ?ref=guide-<slug>.',
      'donations_in_period_context is all settled donations, NOT yet linked to referral rows.',
      'donate_click_out.total is an uncapped count over human user agents since 2026-09-11; bot_hits_excluded is what the crawler filter removed. by_slug_and_ref stays capped at 25 rows.',
      'Since 2026-09-15 a UA that clicked Donate on more than walker_min_slugs distinct charities is excluded as a walker; walker_hits_excluded and walker_user_agents show what that removed. Since 2026-09-16 the walker set is judged over walker_lookback_hours, not the reported period, so a short window cannot let a slow walker through.',
      'donations_in_period_context counts the on-chain x402 rail ONLY. 0 of 41,227 nonprofits have a wallet, so it cannot see a donation made on a charity own site. donate_click_out is the honest completion metric for the redirect path.',
    ],
  });
}

// ---------------------------------------------------------------------------
// GET /api/admin/guide-crawl?hours=720&token=...
// Per-guide, per-bot crawl recency over the /guides/* routes. Read-only over
// discovery_hits (no migration). Added 2026-07-16 to make the crawl-then-cite
// lag measurable per guide instead of via the 30d PerplexityBot aggregate.
// ---------------------------------------------------------------------------
export async function handleGuideCrawl(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const hours = parseInt(url.searchParams.get('hours') || '720'); // 30d default
  const since = `datetime('now', '-${hours} hours')`;

  const rows = (await db.prepare(
    `SELECT route, user_agent, COUNT(*) AS hits, MAX(created_at) AS last_seen
       FROM discovery_hits
      WHERE route LIKE '/guides/%'
        AND created_at > ${since}
        AND user_agent IS NOT NULL
      GROUP BY route, user_agent`
  ).all()).results;

  const classify = (ua) => {
    const hit = KNOWN_AGENT_PATTERNS.find((e) => ua.includes(e.pattern));
    return hit ? { name: hit.name, type: hit.type } : { name: 'other', type: 'other' };
  };

  const guides = {};
  for (const r of rows) {
    const g = (guides[r.route] ||= { route: r.route, perplexity_last_crawl: null, crawls: {} });
    const c = classify(r.user_agent);
    const cur = (g.crawls[c.name] ||= { type: c.type, hits: 0, last_seen: null });
    cur.hits += r.hits;
    if (!cur.last_seen || r.last_seen > cur.last_seen) cur.last_seen = r.last_seen;
    if (/perplex/i.test(r.user_agent)) {
      if (!g.perplexity_last_crawl || r.last_seen > g.perplexity_last_crawl) {
        g.perplexity_last_crawl = r.last_seen;
      }
    }
  }

  return json({
    period: `last ${hours} hours`,
    guides: Object.values(guides).sort((a, b) =>
      (a.perplexity_last_crawl || '').localeCompare(b.perplexity_last_crawl || '')),
  });
}
