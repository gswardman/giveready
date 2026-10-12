/**
 * GiveReady — AI traffic figures for the home page and per-charity profile (2026-09-24).
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { CORS_HEADERS, json } from '../lib/http.js';

// ── AI traffic summary for the public home page (2026-09-24) ─────────────
//
// The home page shows "N AI visits to charity pages this week" and a feed of
// the latest reads. That must NOT scan discovery_hits per page view: a 7-day
// window is ~17k rows, and ~150 home page views would spend the 5M/day D1
// free tier (see docs/DEPLOY-d1-rows-read-fix-2026-09-02.md).
//
// So: refreshAiTraffic() runs the scan in scheduled() every third hour and
// writes one JSON row to stats_cache ('ai_traffic_7d'). /api/ai-traffic reads
// that single row. If the row is missing or older than 6 hours (first deploy,
// or the cron stopped), the endpoint recomputes once and writes it back, so the
// next request is cheap again. Only OpenAI, Anthropic and Perplexity count, and
// only charity, cause and guide pages, so "AI visits" means what it says.
const AI_VENDORS = [
  ['OpenAI (ChatGPT)', /GPTBot|OAI-SearchBot|ChatGPT-User/i],
  ['Anthropic (Claude)', /ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai/i],
  ['Perplexity', /PerplexityBot|Perplexity-User/i],
];
export function aiVendorFor(ua) {
  for (const [name, re] of AI_VENDORS) if (re.test(ua || '')) return name;
  return null;
}

// The wider set for the monthly "AI and search companies" figure (2026-09-24).
// Each of these companies runs an AI assistant fed by the pages its bots read:
// ChatGPT, Claude, Perplexity, Gemini, Copilot, Siri, Alexa, Meta AI.
// Deliberately excluded: SEO tools (Semrush, Ahrefs), PetalBot, Yandex, and
// anything unattributed, so the number never counts a visitor as "AI" on a guess.
const AI_COMPANIES = [
  ['OpenAI', /GPTBot|OAI-SearchBot|ChatGPT-User/i],
  ['Anthropic', /ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai/i],
  ['Perplexity', /PerplexityBot|Perplexity-User/i],
  ['Google', /Googlebot|Google-Extended|GoogleOther|Google-CloudVertexBot/i],
  ['Microsoft', /bingbot|BingPreview/i],
  ['Apple', /Applebot/i],
  ['Amazon', /Amazonbot/i],
  ['Meta', /meta-externalagent|FacebookBot/i],
];
export function aiCompanyFor(ua) {
  for (const [name, re] of AI_COMPANIES) if (re.test(ua || '')) return name;
  return null;
}
const AI_COMPANY_SQL = `(user_agent LIKE '%GPTBot%' OR user_agent LIKE '%OAI-SearchBot%' OR user_agent LIKE '%ChatGPT-User%'
  OR user_agent LIKE '%ClaudeBot%' OR user_agent LIKE '%Claude-User%' OR user_agent LIKE '%Claude-SearchBot%' OR user_agent LIKE '%anthropic-ai%'
  OR user_agent LIKE '%PerplexityBot%' OR user_agent LIKE '%Perplexity-User%'
  OR user_agent LIKE '%Googlebot%' OR user_agent LIKE '%Google-Extended%' OR user_agent LIKE '%GoogleOther%' OR user_agent LIKE '%Google-CloudVertexBot%'
  OR user_agent LIKE '%bingbot%' OR user_agent LIKE '%BingPreview%' OR user_agent LIKE '%Applebot%' OR user_agent LIKE '%Amazonbot%'
  OR user_agent LIKE '%meta-externalagent%' OR user_agent LIKE '%FacebookBot%')`;

// Every 3rd hour: the 7-day feed (OpenAI/Anthropic/Perplexity on charity,
// cause and guide pages) plus the 7-day bot count from traffic_rollup (every
// route, tens of rows a day, so a few thousand rows to sum).
export async function refreshAiTraffic(db) {
  const rows = await db.prepare(
    `SELECT user_agent, route, COUNT(*) AS hits, MAX(created_at) AS last_hit
       FROM discovery_hits
      WHERE created_at > datetime('now', '-7 days')
        AND (route LIKE '/nonprofits/%' OR route LIKE '/causes/%' OR route LIKE '/guides/%')
        AND (user_agent LIKE '%GPTBot%' OR user_agent LIKE '%OAI-SearchBot%' OR user_agent LIKE '%ChatGPT-User%'
          OR user_agent LIKE '%ClaudeBot%' OR user_agent LIKE '%Claude-User%' OR user_agent LIKE '%Claude-SearchBot%'
          OR user_agent LIKE '%anthropic-ai%' OR user_agent LIKE '%PerplexityBot%' OR user_agent LIKE '%Perplexity-User%')
      GROUP BY user_agent, route`
  ).all();
  const byVendor = {};
  let total = 0;
  const recent = [];
  for (const r of rows.results || []) {
    const vendor = aiVendorFor(r.user_agent);
    if (!vendor) continue;
    total += r.hits;
    byVendor[vendor] = (byVendor[vendor] || 0) + r.hits;
    recent.push({ vendor, route: r.route, last_hit: r.last_hit });
  }
  recent.sort((a, b) => (a.last_hit < b.last_hit ? 1 : -1));
  let botVisits7d = null;
  try {
    const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 13);
    const rb = await db.prepare(
      `SELECT SUM(hits) AS n FROM traffic_rollup WHERE bucket >= ?1 AND agent_class <> 'unattributed'`
    ).bind(cutoff).first();
    botVisits7d = rb && rb.n != null ? Number(rb.n) : null;
  } catch (e) { /* rollup table missing: leave null */ }
  const value = {
    window_hours: 168,
    total,
    by_vendor: byVendor,
    bot_visits_7d: botVisits7d,
    recent: recent.slice(0, 8),
    computed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
  await db.prepare(
    `INSERT OR REPLACE INTO stats_cache (key, value, updated_at) VALUES ('ai_traffic_7d', ?1, datetime('now'))`
  ).bind(JSON.stringify(value)).run();
  return value;
}

// Once a day (03:xx UTC): 30 days, the wider AI_COMPANIES set, every logged
// route, plus a slug -> visits map for the "Did AI read your charity?" lookup.
// ~75k index rows once a day. Never per request.
export async function refreshAiTraffic30d(db) {
  const rows = await db.prepare(
    `SELECT user_agent, route, COUNT(*) AS hits
       FROM discovery_hits
      WHERE created_at > datetime('now', '-30 days') AND ${AI_COMPANY_SQL}
      GROUP BY user_agent, route`
  ).all();
  const byCompany = {};
  const profiles = {};
  let total = 0;
  for (const r of rows.results || []) {
    const co = aiCompanyFor(r.user_agent);
    if (!co) continue;
    total += r.hits;
    byCompany[co] = (byCompany[co] || 0) + r.hits;
    const m = (r.route || '').match(/^\/nonprofits\/([a-z0-9-]+)$/);
    if (m) profiles[m[1]] = (profiles[m[1]] || 0) + r.hits;
  }
  const value = {
    window_days: 30,
    total,
    by_company: byCompany,
    profiles_read: Object.keys(profiles).length,
    profiles,
    computed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
  await db.prepare(
    `INSERT OR REPLACE INTO stats_cache (key, value, updated_at) VALUES ('ai_traffic_30d', ?1, datetime('now'))`
  ).bind(JSON.stringify(value)).run();
  return value;
}

async function readCache(db, key, maxAgeHours) {
  try {
    const row = await db.prepare(
      `SELECT value FROM stats_cache WHERE key = ?1 AND updated_at > datetime('now', ?2)`
    ).bind(key, `-${maxAgeHours} hours`).first();
    return row && row.value ? JSON.parse(row.value) : null;
  } catch (e) { return null; }
}

function cachedJson(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', ...CORS_HEADERS },
  });
}

export async function handleAiTraffic(db) {
  let week = await readCache(db, 'ai_traffic_7d', 6);
  // A row written before a field existed counts as stale, so a deploy that adds
  // a field shows it at once instead of after the next cron refresh.
  if (week && !('bot_visits_7d' in week)) week = null;
  if (!week) {
    try { week = await refreshAiTraffic(db); }
    catch (e) { week = { window_hours: 168, total: null, by_vendor: {}, recent: [], error: 'unavailable' }; }
  }
  let month = await readCache(db, 'ai_traffic_30d', 30);
  if (!month) {
    try { month = await refreshAiTraffic30d(db); }
    catch (e) { month = null; }
  }
  const out = { ...week };
  if (month) {
    out.month = { window_days: 30, total: month.total, by_company: month.by_company,
                  profiles_read: month.profiles_read, computed_at: month.computed_at };
  }
  return cachedJson(out);
}

// /api/ai-traffic/profile?slug=<slug>: one cached row, no scan.
export async function handleAiTrafficProfile(db, url) {
  const slug = (url.searchParams.get('slug') || '').toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return json({ error: 'slug required' }, 400);
  const month = await readCache(db, 'ai_traffic_30d', 48);
  if (!month) return cachedJson({ slug, window_days: 30, visits: null });
  return cachedJson({ slug, window_days: 30, visits: (month.profiles && month.profiles[slug]) || 0 });
}
