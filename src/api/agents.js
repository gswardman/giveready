/**
 * GiveReady — Public agent telemetry: leaderboard, exemplars, funnel, named-agent first-seen.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json } from '../lib/http.js';
import {
  KNOWN_AGENT_PATTERNS,
  agentTypeFor,
  AGENT_NOISE_PREFIXES,
  isNoiseAgent,
} from '../lib/user-agents.js';
import { nonTestAgentSql } from './enrichment.js';

// ============================================
// SELF-LEARNING ENDPOINTS (2026-04-16)
// exemplars / funnel / named-first-seen
// ============================================

// ============================================
// AGENT LEADERBOARD — public surface
// ============================================

export async function handleAgentLeaderboard(db) {
  // Public leaderboard — excludes self-reported test/debug/probe agents so
  // wild agents don't learn the pattern that test traffic counts.
  // See nonTestAgentSql() definition near ENRICHABLE_FIELDS for context.
  const agents = await db.prepare(
    `SELECT agent_name,
            COUNT(*) AS submissions,
            SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS applied,
            COUNT(DISTINCT nonprofit_id) AS nonprofits_touched,
            MAX(created_at) AS last_seen
     FROM agent_enrichments
     WHERE agent_name IS NOT NULL AND agent_name <> ''
       AND ${nonTestAgentSql()}
     GROUP BY agent_name
     ORDER BY applied DESC, submissions DESC, last_seen DESC
     LIMIT 50`
  ).all();

  const recent = await db.prepare(
    `SELECT agent_name, nonprofit_slug, field, status, created_at
     FROM agent_enrichments
     WHERE ${nonTestAgentSql()}
     ORDER BY created_at DESC
     LIMIT 20`
  ).all();

  const totals = await db.prepare(
    `SELECT
       COUNT(*) AS total_submissions,
       SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS total_applied,
       COUNT(DISTINCT agent_name) AS unique_agents,
       COUNT(DISTINCT nonprofit_id) AS nonprofits_improved
     FROM agent_enrichments
     WHERE ${nonTestAgentSql()}`
  ).first();

  return json({
    message: 'Public leaderboard of agents that have contributed enrichments. Applied = promoted live after 2+ agent consensus.',
    totals,
    top_agents: agents.results,
    recent_activity: recent.results,
  });
}

// /api/agents/exemplars — returns recently applied submissions as templates.
// Agents that read this BEFORE submitting converge on the shape that worked.
// This is the reinforcement half of the self-learning loop.
export async function handleAgentExemplars(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
  const field = url.searchParams.get('field');

  const where = field ? `WHERE status = 'applied' AND field = ?1` : `WHERE status = 'applied'`;
  const binds = field ? [field] : [];

  const rows = await db.prepare(
    `SELECT ae.nonprofit_slug, ae.field, ae.value, ae.agent_name, ae.source_url, ae.reviewed_at
       FROM agent_enrichments ae
       ${where}
       ORDER BY ae.reviewed_at DESC
       LIMIT ${limit}`
  ).bind(...binds).all();

  return json({
    message: 'Recent applied enrichments, exposed as templates. Match the shape of these values when submitting to POST /api/enrich/SLUG (replace SLUG with a real nonprofit slug from /api/needs-enrichment) and your chance of applied status goes up.',
    hint: 'Filter by ?field=website (or city, region, founded_year, contact_email, mission, description, tagline).',
    count: (rows.results || []).length,
    exemplars: rows.results,
  });
}

// /api/agents/funnel — named crawlers that hit a discovery route but
// did not submit an enrichment in the following window. This is the
// read-and-leave gap the daily digest cares about. Excludes noise.
export async function handleAgentFunnel(db, url, env) {
  const hours = parseInt(url.searchParams.get('hours') || '168', 10) || 168;
  const since = `datetime('now', '-${hours} hours')`;

  // All discovery hits from NOT-noise user-agents in the period.
  const hits = await db.prepare(
    `SELECT user_agent, route, MIN(created_at) AS first_hit, MAX(created_at) AS last_hit, COUNT(*) AS hits
       FROM discovery_hits
      WHERE created_at > ${since}
        AND user_agent IS NOT NULL AND user_agent <> ''
      GROUP BY user_agent, route
      ORDER BY last_hit DESC`
  ).all();

  // Submissions in the same window, keyed by user_agent (agent_id is the UA).
  const submissions = await db.prepare(
    `SELECT agent_id, agent_name, COUNT(*) AS submitted
       FROM agent_enrichments
      WHERE created_at > ${since}
      GROUP BY agent_id, agent_name`
  ).all();
  const submittedByAgent = new Set((submissions.results || []).map((s) => s.agent_id));

  // Tag every named row with its agent_type so callers can filter to
  // interactive_agent only. Training crawlers and search crawlers also show
  // up here but they can't submit by design — the digest moves them into a
  // footnote rather than the conversion math.
  const tagged = (hits.results || [])
    .filter((h) => !isNoiseAgent(h.user_agent, env))
    .map((h) => ({ ...h, agent_type: agentTypeFor(h.user_agent) }));
  const readAndLeft = tagged.filter((h) => !submittedByAgent.has(h.user_agent));
  const readAndSubmitted = tagged.filter((h) => submittedByAgent.has(h.user_agent));

  const useBlocklist = env && env.AGENT_FILTER_MODE === 'blocklist';
  return json({
    message: `Named crawlers in the last ${hours}h — who read a discovery route and never submitted. agent_type lets you filter to interactive_agent only.`,
    window_hours: hours,
    filter_mode: useBlocklist ? 'blocklist' : 'allowlist',
    read_and_left: readAndLeft,
    read_and_submitted: readAndSubmitted,
    noise_excluded: useBlocklist ? AGENT_NOISE_PREFIXES : KNOWN_AGENT_PATTERNS.map((e) => e.name),
  });
}

// /api/agents/named-first-seen — new NAMED user-agents seen in the period
// that weren't seen before. Cuts through Bun/curl noise. This is the
// "what actually changed today" signal.
export async function handleAgentNamedFirstSeen(db, url, env) {
  const hours = parseInt(url.searchParams.get('hours') || '24', 10) || 24;
  const since = `datetime('now', '-${hours} hours')`;

  // All distinct user-agents seen in the window.
  const recent = await db.prepare(
    `SELECT user_agent, MIN(created_at) AS first_hit_in_window, COUNT(*) AS hits
       FROM discovery_hits
      WHERE created_at > ${since}
        AND user_agent IS NOT NULL AND user_agent <> ''
      GROUP BY user_agent`
  ).all();

  // For each, find its lifetime first_hit.
  const out = [];
  for (const r of (recent.results || [])) {
    if (isNoiseAgent(r.user_agent, env)) continue;
    const lifetime = await db.prepare(
      `SELECT MIN(created_at) AS lifetime_first FROM discovery_hits WHERE user_agent = ?1`
    ).bind(r.user_agent).first();
    const isNew = lifetime.lifetime_first >= r.first_hit_in_window;
    out.push({
      user_agent: r.user_agent,
      hits_in_window: r.hits,
      first_seen_lifetime: lifetime.lifetime_first,
      first_hit_in_window: r.first_hit_in_window,
      is_new: isNew,
    });
  }
  out.sort((a, b) => (b.is_new - a.is_new) || (b.hits_in_window - a.hits_in_window));

  const useBlocklist = env && env.AGENT_FILTER_MODE === 'blocklist';
  return json({
    message: `Named agents in the last ${hours}h — ${useBlocklist ? 'noise prefixes' : 'non-allowlisted UAs'} filtered out.`,
    window_hours: hours,
    filter_mode: useBlocklist ? 'blocklist' : 'allowlist',
    agents: out,
    first_time_named_crawlers: out.filter((a) => a.is_new),
  });
}
