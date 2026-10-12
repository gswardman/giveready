/**
 * GiveReady — Request telemetry: discovery-hit logging, the per-request traffic rollup, referrer classification.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { agentTypeFor, routeClassFor } from './user-agents.js';

// ============================================
// DISCOVERY HIT LOGGING
// ============================================

// Insert failures are counted, not swallowed.
//
// WHY (2026-09-01). This used to end in `.catch(() => {})`. That is silent by
// design: it keeps a logging failure from breaking a page render, which is
// right. But it also means a broken write path and a quiet day produce exactly
// the same observable — zero rows — and the digest cannot tell them apart. On
// 2026-09-01 a stale cached response was misread as a 42-hour logging outage,
// and nothing in the system could have refuted that, because there was no
// record of whether inserts were succeeding.
//
// The counter is per-isolate and in-memory. It is not durable and it is not a
// metric to trend. It answers exactly one question, on demand: "are inserts
// failing right now, and what was the last error." That is enough to separate
// the two cases in a diagnostic, which is all it is for.
//
// Still never throws into the request path. That part was correct.
export const DISCOVERY_LOG_HEALTH = {
  ok: 0,
  failed: 0,
  last_error: null,
  last_error_at: null,
};

export function logDiscoveryHit(db, route, userAgent, referrer, ref) {
  return db.prepare(
    `INSERT INTO discovery_hits (id, route, user_agent, referrer, ref) VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(crypto.randomUUID(), route, userAgent || null, referrer || null, ref || null).run()
    .then(() => {
      DISCOVERY_LOG_HEALTH.ok += 1;
    })
    .catch((e) => {
      DISCOVERY_LOG_HEALTH.failed += 1;
      DISCOVERY_LOG_HEALTH.last_error = String((e && e.message) || e).slice(0, 200);
      DISCOVERY_LOG_HEALTH.last_error_at = new Date().toISOString();
      // console.error lands in `wrangler tail`, which is where you look when the
      // digest says traffic went quiet. Deliberately not rethrown.
      console.error('discovery_hit insert failed:', DISCOVERY_LOG_HEALTH.last_error);
    });
}

// ============================================
// TRAFFIC ROLLUP (migration 026, added 2026-09-17)
// ============================================
//
// Counts EVERY request. logDiscoveryHit above counts twenty routes, which on
// 2026-09-17 turned out to be 4.0% of a day's edge requests (1,831 of 45,610 by
// Cloudflare's count, 16,992 of 78,550 over 7d). Every share the digest printed
// was against that subset. See migrations/026-traffic-rollup.sql for the full
// account, including the 40,000-request burst on 2026-09-16 that none of the
// reporting could see.
//
// Two counters, not rows. An upsert bumps an existing row, so a burst touches
// the same handful of rows repeatedly and the table does not grow. This is the
// opposite of discovery_hits, which has twice been the reason the site went down.
//
// Same failure discipline as logDiscoveryHit: counted, never thrown into the
// request path. A traffic counter must never be able to take a page down.
export const TRAFFIC_ROLLUP_HEALTH = {
  ok: 0,
  failed: 0,
  last_error: null,
  last_error_at: null,
};

export function recordTraffic(db, route, userAgent, country) {
  // UTC hour bucket. Matches the datetime('now') convention used everywhere
  // else in this schema, so a bucket joins cleanly against created_at windows.
  const bucket = new Date().toISOString().slice(0, 13);
  const routeClass = routeClassFor(route);
  // agentTypeFor returns null for anything outside KNOWN_AGENT_PATTERNS. That
  // null is the honest answer and it is the figure the digest calls
  // "unattributed", so it gets its own class rather than being dropped. Bulk
  // crawlers (Amazonbot, PetalBot) are deliberately NOT special-cased here:
  // they are excluded from agents_only in the digest by a separate rule, and
  // this table's job is the complete denominator, not the curated one.
  const agentClass = agentTypeFor(userAgent) || 'unattributed';
  const cc = (country && /^[A-Z]{2}$/.test(country)) ? country : 'XX';

  return db.batch([
    db.prepare(
      `INSERT INTO traffic_rollup (bucket, route_class, agent_class, hits) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(bucket, route_class, agent_class) DO UPDATE SET hits = hits + 1`
    ).bind(bucket, routeClass, agentClass),
    db.prepare(
      `INSERT INTO traffic_geo (bucket, country, hits) VALUES (?1, ?2, 1)
         ON CONFLICT(bucket, country) DO UPDATE SET hits = hits + 1`
    ).bind(bucket, cc),
  ])
    .then(() => {
      TRAFFIC_ROLLUP_HEALTH.ok += 1;
    })
    .catch((e) => {
      TRAFFIC_ROLLUP_HEALTH.failed += 1;
      TRAFFIC_ROLLUP_HEALTH.last_error = String((e && e.message) || e).slice(0, 200);
      TRAFFIC_ROLLUP_HEALTH.last_error_at = new Date().toISOString();
      console.error('traffic_rollup upsert failed:', TRAFFIC_ROLLUP_HEALTH.last_error);
    });
}

// The value stored in discovery_hits.ref for a logged request.
// ?ref= wins when present and well-formed (guide-<slug> links, unchanged).
// 2026-10-01: otherwise a well-formed ?utm_source= is kept as 'utm-<source>'.
// Assistants strip the Referer header, so classifyReferrer() never sees them,
// but OpenAI appends ?utm_source=openai to the links it cites. Before this the
// parameter was dropped and every human click from a ChatGPT answer logged as
// referrer 'none'. Rides the existing ref column and idx_discovery_ref, so no
// migration. The 'utm-' prefix keeps it clear of every ref LIKE 'guide-%' query.
export function discoveryRefFromUrl(url) {
  const ref = url.searchParams.get('ref');
  if (ref && /^[a-z0-9_-]{1,80}$/i.test(ref)) return ref;
  const utm = url.searchParams.get('utm_source');
  if (utm && /^[a-z0-9._-]{1,40}$/i.test(utm)) return 'utm-' + utm.toLowerCase();
  return null;
}

// Referrer classification for the guide->donation funnel (migration 018).
// Kept in code (not stored) so the AI-assistant list can grow without re-tagging rows.
export function classifyReferrer(referrer) {
  if (!referrer) return 'none';
  const r = referrer.toLowerCase();
  if (/(perplexity\.ai|chatgpt\.com|chat\.openai\.com|claude\.ai|copilot\.microsoft|gemini\.google|you\.com|phind\.com|poe\.com)/.test(r)) return 'ai_assistant';
  if (/(google\.|bing\.com|duckduckgo\.|search\.yahoo|ecosia\.|search\.brave)/.test(r)) return 'search';
  if (/giveready\.org/.test(r)) return 'internal';
  return 'other';
}
