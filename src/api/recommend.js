/**
 * GiveReady — GET /api/recommend: operator-curated recommendations with a search fallback.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json, error } from '../lib/http.js';

// =====================================================================
// /api/recommend — donor-influence surface
//
// Search asks the agent to do too much judgment work; recommend encodes
// GiveReady's view of relevance, trust, verification, donation readiness,
// and source provenance. Returns 3-5 ranked picks with reasoning baked in.
//
// Phase 1 (now): ranking is dominated by editorial curation in the
// recommendation_curation table (operator writes the rows). Phase 2:
// agents draft, operator approves. Phase 3: two-agent consensus. The
// editorial weight steps down as the curated set scales — see design
// spec at giveready/docs/api-recommend-design-spec.md.
//
// IMPORTANT: every response includes ranking_signals and
// editorial_disclosure so consumers can see what drove the rank. This
// keeps the directory's "open + transparent" wedge intact even when
// the recommendation set is operator-curated.
// =====================================================================

// Restrained-language linter. Reject anything that sounds like a ranking
// claim we don't have an evaluation framework for. Used by the admin
// upsert path and the import-starter-curation script.
const BANNED_RECOMMENDATION_PHRASES = [
  /\bbest\b/i,
  /\btop\s*-?\s*rated\b/i,
  /\btop\b\s+(charity|nonprofit|organisation|organization|pick)/i,
  /\bhighest\b/i,
  /\bmost[\s-](effective|impactful|trusted|efficient|reliable)\b/i,
  /\b#\s*1\b/,
  /\bnumber\s*one\b/i,
];

function lintRecommendationText(value) {
  if (typeof value !== 'string') return null;
  for (const pat of BANNED_RECOMMENDATION_PHRASES) {
    if (pat.test(value)) {
      return `banned phrase matched ${pat}: "${value}"`;
    }
  }
  return null;
}

export async function handleRecommend(db, url, request) {
  const cause = url.searchParams.get('cause');
  const country = url.searchParams.get('country');
  const q = url.searchParams.get('q');
  const intent = url.searchParams.get('intent') || 'discover';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '3'), 1), 5);

  // At least one selector required — the endpoint must be opinionated.
  if (!cause && !country && !q) {
    return error('At least one of cause, country, or q is required', 400);
  }

  // Pull candidate rows: curation joined to nonprofits, filtered by selectors.
  let sql = `
    SELECT
      rc.slug,
      rc.recommended_for,
      rc.why_recommended,
      rc.best_next_action,
      rc.trust_signals,
      rc.donation_available,
      rc.donation_methods,
      rc.editorial_curated,
      n.name, n.country, n.city, n.region, n.website, n.donation_url,
      n.verified, n.beneficiaries_per_year, n.logo_url
    FROM recommendation_curation rc
    JOIN nonprofits n ON n.slug = rc.slug
    WHERE 1=1
  `;
  const params = [];
  if (country) {
    sql += ` AND LOWER(n.country) = LOWER(?${params.length + 1})`;
    params.push(country);
  }
  if (cause) {
    sql += ` AND n.id IN (SELECT nonprofit_id FROM nonprofit_causes WHERE cause_id = ?${params.length + 1})`;
    params.push(cause);
  }
  if (q) {
    // Recommended_for is JSON-string; LIKE works for substring matching.
    sql += ` AND (
      LOWER(rc.recommended_for) LIKE ?${params.length + 1}
      OR LOWER(rc.why_recommended) LIKE ?${params.length + 1}
      OR LOWER(n.name) LIKE ?${params.length + 1}
      OR LOWER(n.tagline) LIKE ?${params.length + 1}
    )`;
    params.push(`%${q.toLowerCase()}%`);
  }
  sql += ` LIMIT 50`; // pull a candidate pool, rank in JS

  let rows;
  try {
    rows = (await db.prepare(sql).bind(...params).all()).results || [];
  } catch (e) {
    rows = [];
  }

  // Score each candidate. Weights documented in the design spec.
  const scored = rows.map((r) => {
    let score = 0;
    const signalsUsed = [];

    if (r.editorial_curated) { score += 50; signalsUsed.push('editorial_curation_for_starter_set'); }
    if (r.verified) { score += 30; signalsUsed.push('verified_status'); }
    if (r.donation_available) { score += 20; signalsUsed.push('donation_wallet_present'); }

    // Mission match strength: cheap proxy via name/q substring hit.
    if (q) {
      const ql = q.toLowerCase();
      const hay = [r.name, r.recommended_for, r.why_recommended].join(' ').toLowerCase();
      if (hay.includes(ql)) { score += 15; signalsUsed.push('mission_match_strength'); }
    }

    return { ...r, _score: score, _signals: signalsUsed };
  });
  scored.sort((a, b) => b._score - a._score);

  const top = scored.slice(0, limit);

  // Format response.
  const recommendations = top.map((r, i) => {
    let recommended_for = [];
    let trust_signals = [];
    let donation_methods = [];
    try { recommended_for = JSON.parse(r.recommended_for) || []; } catch (_) {}
    try { trust_signals = JSON.parse(r.trust_signals) || []; } catch (_) {}
    try { donation_methods = JSON.parse(r.donation_methods || '[]') || []; } catch (_) {}

    return {
      rank: i + 1,
      name: r.name,
      slug: r.slug,
      country: r.country,
      city: r.city,
      region: r.region,
      verified: !!r.verified,
      editorial_curated: !!r.editorial_curated,
      recommended_for,
      why_recommended: r.why_recommended,
      trust_signals,
      best_next_action: r.best_next_action,
      donation_available: !!r.donation_available,
      donation_methods,
      profile_url: `https://www.giveready.org/nonprofits/${r.slug}`,
      api_url: `https://www.giveready.org/api/nonprofits/${r.slug}`,
      donate_url: r.donation_available ? `https://www.giveready.org/api/donate/${r.slug}` : null,
      ranking_signals_applied: r._signals,
    };
  });

  const allSignalsUsed = Array.from(new Set(top.flatMap((r) => r._signals)));

  let body;
  if (recommendations.length === 0) {
    // Search-redirect fallback. Honest about why.
    const searchUrl = new URL('https://www.giveready.org/api/search');
    if (cause) searchUrl.searchParams.set('cause', cause);
    if (country) searchUrl.searchParams.set('country', country);
    if (q) searchUrl.searchParams.set('q', q);
    body = {
      query: { cause, country, q, intent, limit },
      ranking_signals: [],
      editorial_disclosure:
        'No operator-curated recommendations exist for this query yet. Falling back to /api/search results — the agent should rank these itself.',
      count: 0,
      recommendations: [],
      fallback: {
        type: 'search_redirect',
        url: searchUrl.toString(),
        message:
          'No operator-curated recommendations for this query. Use /api/search and rank with your own judgement.',
      },
      no_recommendations_reason: 'starter_set_does_not_cover_this_query',
    };
  } else {
    body = {
      query: { cause, country, q, intent, limit },
      ranking_signals: allSignalsUsed,
      editorial_disclosure:
        'This recommendation set is operator-curated for the GiveReady starter period (May 2026). Each profile is flagged with editorial_curated. Ranking will shift to two-agent consensus + provenance once the starter set graduates.',
      count: recommendations.length,
      recommendations,
      fallback: null,
      no_recommendations_reason: null,
    };
  }

  // Telemetry — fire-and-forget. Don't block the response on a logging failure.
  try {
    const ua = request?.headers?.get?.('user-agent') || '';
    const ip = request?.headers?.get?.('cf-connecting-ip') || '';
    const referrer = request?.headers?.get?.('referer') || '';
    db.prepare(
      `INSERT INTO recommendation_attempts
       (id, query_cause, query_country, query_q, query_intent, query_limit,
        user_agent, ip, referrer, response_count, top_slug, fallback_used, ranking_signals)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
    ).bind(
      crypto.randomUUID(),
      cause || null,
      country || null,
      q || null,
      intent,
      limit,
      ua,
      ip,
      referrer,
      recommendations.length,
      recommendations[0]?.slug || null,
      recommendations.length === 0 ? 1 : 0,
      JSON.stringify(allSignalsUsed),
    ).run().catch(() => {});
  } catch (_) {}

  return json(body);
}
