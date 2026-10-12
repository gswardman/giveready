/**
 * GiveReady — Agent write-back API: needs-enrichment, enrichment submissions, consensus promotion.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { json, error } from '../lib/http.js';

// ============================================
// AGENT ENRICHMENT — Lite version
// Agents discover thin profiles, submit data, consensus builds trust
// ============================================

export const ENRICHABLE_FIELDS = new Set([
  'mission', 'description', 'tagline', 'website', 'city', 'region',
  'founded_year', 'contact_email', 'programme', 'impact_metric',
  // donation_url (2026-09-09): where /out/<slug> sends a donor. It is the one
  // field that moves money, so it NEVER auto-promotes (deliberately absent from
  // AUTO_PROMOTE_STRUCTURED): submissions queue and a human applies them via
  // /api/admin/enrichments/{id}/apply. Validated by validDonationUrl() on the
  // way in and again at apply time.
  'donation_url',
]);

// A donation URL must be an absolute https URL on the charity's own domain,
// never on giveready.org (registration stamps our donate page there and /out
// would loop). Returns the cleaned URL or null. Path case and fragment are
// kept: hosted checkouts (Enthuse, Donorfy, Squarespace give.*) use both.
export function validDonationUrl(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 500) return null;
  let u;
  try { u = new URL(raw.trim()); } catch (_e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
  if (/(^|\.)giveready\.org$/i.test(u.hostname)) return null;
  if (u.username || u.password) return null;
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid' || key === 'ref') u.searchParams.delete(key);
  }
  return u.toString();
}

// SQL filter fragments used on PUBLIC surfaces only (AGENTS.md bounty list,
// /api/agents/leaderboard). Lifetime stats and edge logging stay unfiltered
// so historical visibility is preserved.
//
// Background: the open /api/enrich/{slug} endpoint accepts self-reported
// agent_name. Pre-2026-05-11, test agents (GeordieDebug, CSO-Test-Agent,
// GiveReady-EndpointProbe, Claude/Opus-4.6-Test) submitted placeholder
// values like `https://EXAMPLE.example.org` and `probe-only-mission-...`
// that surfaced on AGENTS.md as "30-Second Wins" — teaching wild agents to
// corroborate broken data. These filters exclude them from the surfaces
// wild agents read. Server-side rejection at submission time is a separate
// ship; this is the surface-level fix so we stop publishing pollution today.
export function nonTestAgentSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `${p}agent_name NOT LIKE '%Debug%' AND ${p}agent_name NOT LIKE '%Test%' AND ${p}agent_name NOT LIKE '%EndpointProbe%'`;
}
export function nonPlaceholderValueSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `${p}value NOT LIKE '%example.org%' AND ${p}value NOT LIKE '%example.com%' AND ${p}value NOT LIKE '%example.net%' AND LOWER(${p}value) NOT LIKE '%placeholder%' AND LOWER(${p}value) NOT LIKE '%probe-only%'`;
}

// Fat-skill / thin-harness split (learning from 2026-04-14 test):
// Exact-string consensus works for STRUCTURED fields where the right answer
// is a single canonical value. It fails for PROSE fields because every agent
// writes its own sentence. For now, structured auto-promotes on exact match
// after light normalisation; prose stays in the review queue awaiting a
// committee-vote endpoint (next iteration — agents judge each other).
export const AUTO_PROMOTE_STRUCTURED = new Set([
  'website', 'city', 'region', 'founded_year', 'contact_email',
]);

export const AUTO_PROMOTE_PROSE_PENDING = new Set([
  'mission', 'description', 'tagline',
]);

// Trusted-agent prose path REMOVED 2026-04-16 after CSO audit (finding C1).
// The previous design let whitelisted foundation model names (claude / gpt /
// gemini / anthropic) auto-apply prose on first submission when the field was
// empty. Because agent_name is self-reported in the request body and the
// match used `includes` rather than `startsWith`, an unauthenticated caller
// could impersonate a trusted model ("i-claude-poison-charities" matches
// "claude") and mass-poison mission/description/tagline across the ~40k
// directory at rate-limit ceiling (30 writes/min/IP, cyclable across isolates).
// Prose fields now stay queued for the committee-vote mechanism. The planned
// route back is an HMAC-signed trusted-agent v2 (security audit, 2026-04-16).

// Light normalisation so trivial formatting differences don't block consensus.
// URLs: lowercase host + path, strip www., strip trailing slash, strip tracking
// params (utm_*, fbclid, ref) and fragment. Path is lowercased because virtually
// all web servers are case-insensitive and the old case-sensitive path was hiding
// real consensus behind false rejections (/About vs /about). See CSO-Audit
// 2026-04-23 recommendation. Year fields coerce to 4-digit integer string.
function normaliseFieldValue(field, raw) {
  if (raw == null) return '';
  let v = String(raw).trim().replace(/\s+/g, ' ');
  if (field === 'website') {
    try {
      const u = new URL(v.startsWith('http') ? v : `https://${v}`);
      u.hostname = u.hostname.toLowerCase();
      u.pathname = u.pathname.toLowerCase();
      // Strip www. prefix — www.example.org and example.org are the same site
      if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4);
      // Strip tracking params that agents pick up from different sources
      for (const key of [...u.searchParams.keys()]) {
        if (key.startsWith('utm_') || key === 'fbclid' || key === 'ref' || key === 'gclid') {
          u.searchParams.delete(key);
        }
      }
      // Strip fragment
      u.hash = '';
      let out = u.toString();
      if (out.endsWith('/') && u.pathname === '/') out = out.slice(0, -1);
      return out;
    } catch (_) { /* fall through */ }
  }
  if (field === 'contact_email') return v.toLowerCase();
  if (field === 'city' || field === 'region') return v.replace(/\s*,\s*$/, '');
  if (field === 'founded_year') {
    const m = v.match(/(\d{4})/);
    return m ? m[1] : v;
  }
  return v;
}

// Attempt to promote an enrichment to live on the nonprofit row.
// Safety rules:
//   1. Never overwrite an existing non-empty value.
//   2. Only auto-promote fields in AUTO_PROMOTE_STRUCTURED.
//   3. Require 2+ distinct agents posting the same NORMALISED value.
// Returns { promoted: bool, reason: string } so the caller can tell the
// agent what actually happened.
async function promoteIfConsensus(db, nonprofit, field) {
  if (AUTO_PROMOTE_PROSE_PENDING.has(field)) {
    return { promoted: false, reason: 'prose-pending' };
  }
  if (!AUTO_PROMOTE_STRUCTURED.has(field)) {
    return { promoted: false, reason: 'not-auto-promotable' };
  }

  const current = await db.prepare(
    `SELECT ${field} AS val FROM nonprofits WHERE id = ?1`
  ).bind(nonprofit.id).first();
  if (current && current.val !== null && String(current.val).trim() !== '') {
    return { promoted: false, reason: 'already-has-value' };
  }

  // Pull all pending values, normalise in JS, group to find a winner.
  // D1 lacks a portable normalise function, so we do the grouping here.
  const rows = await db.prepare(
    `SELECT id, value, agent_id FROM agent_enrichments
     WHERE nonprofit_id = ?1 AND field = ?2 AND status = 'pending'`
  ).bind(nonprofit.id, field).all();

  const buckets = new Map(); // normValue -> { agents:Set, rawCanonical:string }
  for (const r of (rows.results || [])) {
    const n = normaliseFieldValue(field, r.value);
    if (!n) continue;
    if (!buckets.has(n)) buckets.set(n, { agents: new Set(), raw: r.value });
    buckets.get(n).agents.add(r.agent_id || 'unknown');
  }

  let winner = null;
  for (const [norm, info] of buckets) {
    if (info.agents.size < 2) continue;
    if (!winner || info.agents.size > winner.agents) {
      winner = { norm, raw: info.raw, agents: info.agents.size };
    }
  }

  if (!winner) return { promoted: false, reason: 'no-consensus' };

  // Apply the winner's canonical raw value (first submission for that bucket).
  await db.prepare(
    `UPDATE nonprofits SET ${field} = ?1 WHERE id = ?2`
  ).bind(winner.raw, nonprofit.id).run();

  // Mark matching (by normalised value) enrichments applied, others rejected.
  // We do this in JS because SQLite can't re-run our normaliser.
  const matchingIds = [];
  const losingIds = [];
  for (const r of (rows.results || [])) {
    const n = normaliseFieldValue(field, r.value);
    (n === winner.norm ? matchingIds : losingIds).push(r.id);
  }
  if (matchingIds.length) {
    const placeholders = matchingIds.map((_, i) => `?${i + 1}`).join(',');
    await db.prepare(
      `UPDATE agent_enrichments SET status='applied', reviewed_at=datetime('now')
       WHERE id IN (${placeholders})`
    ).bind(...matchingIds).run();
  }
  if (losingIds.length) {
    // Record WHY each losing submission was rejected, and the value that won.
    // The next agent that retries this field on this nonprofit gets this
    // back in their submission response so they can self-correct.
    const rejectionReason = `Normalised value did not match the winning consensus for '${field}'. Winner had ${winner.agents} agreeing agents. Aim for the winning canonical form when retrying.`;
    const placeholders = losingIds.map((_, i) => `?${i + 3}`).join(',');
    await db.prepare(
      `UPDATE agent_enrichments
         SET status='rejected',
             reviewed_at=datetime('now'),
             rejection_reason=?1,
             winning_value=?2
       WHERE id IN (${placeholders})`
    ).bind(rejectionReason, winner.raw, ...losingIds).run();
  }

  return { promoted: true, reason: 'consensus', agents: winner.agents };
}

export async function handleNeedsEnrichment(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
  const cause = url.searchParams.get('cause');
  const field = url.searchParams.get('field');

  // Fast approach: filter for genuinely thin profiles first, then rank
  let where = [`(n.description IS NULL OR n.description = '' OR n.mission IS NULL OR n.mission = '' OR n.website IS NULL OR n.website = '')`];
  const params = [];

  if (field === 'mission') where.push(`(n.mission IS NULL OR n.mission = '')`);
  else if (field === 'description') where.push(`(n.description IS NULL OR n.description = '')`);
  else if (field === 'website') where.push(`(n.website IS NULL OR n.website = '')`);
  else if (field === 'contact_email') where.push(`(n.contact_email IS NULL OR n.contact_email = '')`);

  let joinClause = '';
  if (cause) {
    joinClause = ` JOIN nonprofit_causes nc ON n.id = nc.nonprofit_id`;
    where.push(`nc.cause_id = ?${params.length + 1}`);
    params.push(cause);
  }

  params.push(limit);

  const query = `
    SELECT n.id, n.slug, n.name, n.country, n.city, n.website, n.verified,
           n.mission, n.description, n.founded_year, n.contact_email
    FROM nonprofits n${joinClause}
    WHERE ${where.join(' AND ')}
    ORDER BY n.name ASC
    LIMIT ?${params.length}
  `;

  const results = await db.prepare(query).bind(...params).all();

  // For each result, list which fields need data
  const npIds = results.results.map((np) => np.id);

  // Batch-fetch pending single-agent submissions for these nonprofits.
  // These are "second-opinion needed" items: one agent submitted a value but
  // no second agent has corroborated it yet. A new agent can validate the
  // pending value (POST the same value to agree) instead of researching from
  // scratch. This is the lower-cost path to consensus.
  let pendingByNpField = new Map(); // key: `${nonprofit_id}:${field}` → { value, agent_name, submitted_at }
  if (npIds.length > 0) {
    const placeholders = npIds.map((_, i) => `?${i + 1}`).join(',');
    const pending = await db.prepare(
      `SELECT nonprofit_id, field, value, agent_name, created_at
         FROM agent_enrichments
        WHERE nonprofit_id IN (${placeholders})
          AND status = 'pending'
        ORDER BY created_at DESC`
    ).bind(...npIds).all();

    // Group by nonprofit+field, keep only fields with exactly 1 distinct agent_id
    // (true single-agent pending). If 2+ agents already submitted, consensus logic
    // handles it — we don't need to surface those here.
    const grouped = new Map();
    for (const r of (pending.results || [])) {
      const key = `${r.nonprofit_id}:${r.field}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }
    for (const [key, rows] of grouped) {
      const distinctAgents = new Set(rows.map((r) => r.agent_name));
      if (distinctAgents.size === 1) {
        const r = rows[0];
        pendingByNpField.set(key, {
          value: r.field === 'mission' || r.field === 'description' || r.field === 'tagline'
            ? r.value.substring(0, 120) + (r.value.length > 120 ? '...' : '')
            : r.value,
          agent_name: r.agent_name,
          submitted_at: r.created_at,
          submissions: rows.length,
        });
      }
    }
  }

  const enrichable = results.results.map(np => {
    const needs = [];
    if (!np.description || np.description === np.mission) needs.push('description');
    if (!np.website) needs.push('website');
    if (!np.city) needs.push('city', 'region');
    if (!np.mission) needs.push('mission');
    if (!np.founded_year) needs.push('founded_year');
    if (!np.contact_email) needs.push('contact_email');

    // Attach pending second-opinion items per field
    const secondOpinion = [];
    for (const f of needs) {
      const pending = pendingByNpField.get(`${np.id}:${f}`);
      if (pending) {
        secondOpinion.push({
          field: f,
          pending_value: pending.value,
          submitted_by: pending.agent_name,
          submitted_at: pending.submitted_at,
          action: `To corroborate: POST the same value to /api/enrich/${np.slug}. To disagree: POST a different value. Either way, you move this field closer to resolution.`,
        });
      }
    }

    return {
      slug: np.slug,
      name: np.name,
      country: np.country,
      needs_fields: needs,
      second_opinion_needed: secondOpinion.length > 0 ? secondOpinion : undefined,
      current_data: {
        mission: np.mission ? np.mission.substring(0, 100) + '...' : null,
        website: np.website,
        city: np.city,
      },
      enrich_url: `POST https://giveready.org/api/enrich/${np.slug}`,
    };
  });

  const totalEnrichments = await db.prepare(
    `SELECT COUNT(*) as count FROM agent_enrichments`
  ).first();

  // Count only actionable second-opinion items (ones that actually appear in responses)
  const pendingCount = enrichable.reduce((n, np) =>
    n + (np.second_opinion_needed ? np.second_opinion_needed.length : 0), 0);

  return json({
    message: 'These nonprofit profiles need enrichment. Submit data via POST /api/enrich/SLUG, replacing SLUG with the slug field of the nonprofit you want to enrich. Each item below includes an enrich_url with the slug already substituted.',
    hint: pendingCount > 0
      ? `${pendingCount} field(s) below have a pending submission from one agent and need a second opinion. Corroborating an existing value (POST the same value) is faster than researching from scratch.`
      : undefined,
    total_enrichments_received: totalEnrichments.count,
    second_opinions_available: pendingCount,
    nonprofits: enrichable,
  });
}

// Log every POST to /api/enrich/SLUG, regardless of outcome, so the daily
// digest can show "tried-and-bounced" as a distinct funnel stage. Failures
// here must NEVER break the user-facing response — wrap the insert in
// try/catch and swallow.
//
// On 4xx responses we also persist the request body (truncated to 2KB) and
// content-type so the digest can see the actual payload shape that failed.
// On 2xx we only store body if the caller chose to pass it — most success
// paths skip it to keep the table small.
export async function logEnrichmentAttempt(db, attempt) {
  try {
    const bodyTrunc =
      typeof attempt.request_body === 'string' && attempt.request_body.length
        ? attempt.request_body.slice(0, 2048)
        : null;
    await db.prepare(
      `INSERT INTO enrichment_attempts
         (id, slug, user_agent, ip, referrer, status_code, error_class, fields_count, payload_bytes, request_body, content_type)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(
      crypto.randomUUID(),
      attempt.slug || null,
      attempt.ua || null,
      attempt.ip || null,
      attempt.referrer || null,
      attempt.status_code | 0,
      attempt.error_class || 'unknown',
      attempt.fields_count | 0,
      attempt.payload_bytes | 0,
      bodyTrunc,
      attempt.content_type || null
    ).run();
  } catch (_e) {
    // Funnel logging must not be load-bearing. Swallow.
  }
}

// Build the GET brief for /api/enrich/<slug>. Returns null if no such slug.
//
// Added 2026-09-04. This is what a GET now answers with instead of a bare 405.
// The contract it has to meet: an agent that reads ONLY this response should be
// able to construct a valid POST without fetching anything else. That means the
// slug echoed back, the fields that are actually empty, whatever is already
// pending a second opinion, and a literal ready-to-send body.
//
// Deliberately reuses the same emptiness rules as handleNeedsEnrichment so the
// bounty list and this brief cannot disagree about what is missing. If those
// rules change, change them in both places or extract them.
export async function buildEnrichmentBrief(db, slug) {
  const np = await db.prepare(
    `SELECT id, slug, name, country, mission, description, tagline, website,
            city, region, founded_year, contact_email
       FROM nonprofits WHERE slug = ?1`
  ).bind(slug).first();
  if (!np) return null;

  const missing = [];
  if (!np.website) missing.push('website');
  if (!np.city) missing.push('city');
  if (!np.region) missing.push('region');
  if (!np.founded_year) missing.push('founded_year');
  if (!np.contact_email) missing.push('contact_email');
  if (!np.mission) missing.push('mission');
  if (!np.description || np.description === np.mission) missing.push('description');
  if (!np.tagline) missing.push('tagline');

  // Anything one agent has already submitted is worth more than a fresh field:
  // a matching second submission promotes it live immediately.
  const pending = await db.prepare(
    `SELECT field, value, agent_name, created_at
       FROM agent_enrichments
      WHERE nonprofit_id = ?1 AND status = 'pending'
        AND ${nonTestAgentSql()} AND ${nonPlaceholderValueSql()}
      ORDER BY created_at DESC LIMIT 10`
  ).bind(np.id).all();

  // CAN THIS PENDING ITEM ACTUALLY PROMOTE?
  //
  // promoteIfConsensus() has a hard safety rule: "never overwrite an existing
  // non-empty value". It returns `already-has-value` BEFORE it even counts
  // consensus. So a pending submission against a field that is already
  // populated can never be applied, no matter how many agents agree.
  //
  // Found 2026-09-04 on waves-for-change: three agents independently submitted
  // founded_year=2009 and three submitted city="Cape Town", all correct, all
  // still pending, because those fields were already filled. The first cut of
  // this brief cheerfully told agents to go corroborate them. That is sending
  // an agent to do work the server will refuse. Never do that.
  //
  // So: mark each row honestly, and never make an unpromotable field the
  // suggested target.
  const missingSet = new Set(missing);
  const pendingRows = (pending.results || []).map(r => {
    const isProse = AUTO_PROMOTE_PROSE_PENDING.has(r.field);
    const fieldIsEmpty = missingSet.has(r.field);
    const canPromote = !isProse && AUTO_PROMOTE_STRUCTURED.has(r.field) && fieldIsEmpty;
    return {
      field: r.field,
      value_to_corroborate_or_correct: r.value,
      submitted_by: r.agent_name,
      submitted_at: r.created_at,
      can_promote: canPromote,
      note: canPromote
        ? 'One matching POST from a different agent promotes this live.'
        : isProse
          ? 'Prose field. Queues for committee review, still earns leaderboard credit.'
          : 'This field is already populated, so the server will not overwrite it. Corroborating earns leaderboard credit but cannot promote. Prefer a field in missing_fields.',
    };
  });

  // Target selection, in priority order:
  //   1. a pending item that can actually promote (one POST finishes it)
  //   2. any genuinely empty field
  //   3. nothing useful — say so rather than inventing a target
  const promotable = pendingRows.find(r => r.can_promote);
  const target = promotable?.field || missing[0] || null;

  return {
    endpoint: `POST https://www.giveready.org/api/enrich/${np.slug}`,
    method_note:
      'You sent GET. This is the submission brief. Send the body below as POST to contribute.',
    nonprofit: {
      slug: np.slug,
      name: np.name,
      country: np.country,
    },
    current_values: {
      website: np.website || null,
      city: np.city || null,
      region: np.region || null,
      founded_year: np.founded_year || null,
      contact_email: np.contact_email || null,
      mission: np.mission || null,
      tagline: np.tagline || null,
    },
    missing_fields: missing,
    auto_promote_fields: [...AUTO_PROMOTE_STRUCTURED],
    review_queue_fields: [...AUTO_PROMOTE_PROSE_PENDING],
    highest_value_next: promotable
      ? `Corroborate or correct the pending "${target}" below — one matching POST promotes it live.`
      : target
        ? `No pending item can promote right now. "${target}" is empty and open — verify it and POST.`
        : 'This profile is complete on every auto-promotable field. Try https://www.giveready.org/api/needs-enrichment for open targets.',
    pending_second_opinion: pendingRows,
    example_post_body: target === null ? null : {
      field: target,
      value: 'REPLACE_WITH_THE_VALUE_YOU_VERIFIED',
      source_url: 'REPLACE_WITH_THE_PAGE_WHERE_YOU_VERIFIED_IT',
      agent_name: 'YOUR_AGENT_NAME',
      agent_id: 'YOUR_AGENT_NAME',
    },
    curl: target === null
      ? null
      : `curl -X POST https://www.giveready.org/api/enrich/${np.slug} -H 'Content-Type: application/json' -d '{"field":"${target}","value":"REPLACE","source_url":"REPLACE","agent_name":"YOUR_AGENT_NAME","agent_id":"YOUR_AGENT_NAME"}'`,
    credit: 'https://www.giveready.org/agents — you appear within seconds. No login, no key.',
    more_targets: 'https://www.giveready.org/api/needs-enrichment',
    docs: 'https://www.giveready.org/AGENTS.md',
  };
}

export async function handleEnrich(db, request, slug) {
  const ua = request.headers.get('User-Agent') || null;
  const ip = request.headers.get('CF-Connecting-IP') || null;
  const referrer = request.headers.get('Referer') || null;
  const contentType = request.headers.get('Content-Type') || null;

  // Read raw body once so we can both parse it AND measure size, without
  // double-consuming the Request stream.
  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch (_e) {
    await logEnrichmentAttempt(db, { slug, ua, ip, referrer, status_code: 400, error_class: 'body_unreadable', fields_count: 0, payload_bytes: 0, request_body: null, content_type: contentType });
    return error('Invalid JSON body', 400);
  }
  const payloadBytes = bodyText ? new TextEncoder().encode(bodyText).length : 0;

  // Look up the nonprofit
  const nonprofit = await db.prepare(
    `SELECT id, slug, name FROM nonprofits WHERE slug = ?1`
  ).bind(slug).first();

  if (!nonprofit) {
    await logEnrichmentAttempt(db, { slug, ua, ip, referrer, status_code: 404, error_class: 'nonprofit_not_found', fields_count: 0, payload_bytes: payloadBytes, request_body: bodyText, content_type: contentType });
    return error('Nonprofit not found. The slug "' + slug + '" does not match any nonprofit in the directory. See GET /api/needs-enrichment for live targets.', 404);
  }

  // Parse the submission
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (e) {
    await logEnrichmentAttempt(db, { slug, ua, ip, referrer, status_code: 400, error_class: 'invalid_json', fields_count: 0, payload_bytes: payloadBytes, request_body: bodyText, content_type: contentType });
    return error('Invalid JSON body', 400);
  }

  const agentId = body.agent_id || ua || 'unknown';
  const agentName = body.agent_name || agentId.substring(0, 100);
  const submissions = [];

  // Accept either a single field or multiple fields
  const fields = body.fields || [];
  if (body.field && body.value) {
    fields.push({ field: body.field, value: body.value, source_url: body.source_url });
  }

  if (fields.length === 0) {
    await logEnrichmentAttempt(db, { slug, ua, ip, referrer, status_code: 400, error_class: 'no_fields', fields_count: 0, payload_bytes: payloadBytes, request_body: bodyText, content_type: contentType });
    return error('No enrichment data provided. Send { "fields": [{ "field": "description", "value": "...", "source_url": "..." }] }', 400);
  }

  for (const f of fields) {
    if (!f.field || !f.value) continue;
    if (!ENRICHABLE_FIELDS.has(f.field)) continue;
    if (f.field === 'donation_url') {
      const clean = validDonationUrl(f.value);
      if (!clean) continue;
      f.value = clean;
    }

    const id = crypto.randomUUID();

    // Check for consensus: has another agent already submitted similar data for this field?
    const existing = await db.prepare(
      `SELECT COUNT(*) as count FROM agent_enrichments
       WHERE nonprofit_id = ?1 AND field = ?2 AND agent_id != ?3 AND status = 'pending'`
    ).bind(nonprofit.id, f.field, agentId).first();

    const confidence = existing.count > 0 ? existing.count + 1 : 1;

    // Fetch prior rejections for THIS (nonprofit, field). If any exist,
    // surface them in the response so the agent learns why its last
    // attempt (or a peer's) lost. This is the self-learning feedback loop.
    const priorRejectedRows = await db.prepare(
      `SELECT agent_name, value, rejection_reason, winning_value, reviewed_at
         FROM agent_enrichments
        WHERE nonprofit_id = ?1 AND field = ?2 AND status = 'rejected'
        ORDER BY reviewed_at DESC
        LIMIT 5`
    ).bind(nonprofit.id, f.field).all();
    const priorRejections = (priorRejectedRows.results || []).map((r) => ({
      agent: r.agent_name,
      rejected_value: r.value,
      reason: r.rejection_reason || 'No reason recorded.',
      winning_value: r.winning_value || null,
      rejected_at: r.reviewed_at,
    }));

    await db.prepare(
      `INSERT INTO agent_enrichments (id, nonprofit_id, nonprofit_slug, field, value, source_url, agent_id, agent_name, confidence)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(id, nonprofit.id, slug, f.field, f.value.substring(0, 5000), f.source_url || null, agentId, agentName, confidence).run();

    // If confidence >= 2 (2+ agents agree), update the confidence score on all matching submissions
    if (confidence >= 2) {
      await db.prepare(
        `UPDATE agent_enrichments SET confidence = ?1 WHERE nonprofit_id = ?2 AND field = ?3 AND status = 'pending'`
      ).bind(confidence, nonprofit.id, f.field).run();
    }

    // Close the loop: if this submission pushes a field to consensus AND
    // the nonprofit's current value is empty, promote it live right now.
    // Structured fields (website, city, founded_year, etc.) auto-promote on
    // normalised exact match.
    let promoResult = { promoted: false, reason: 'not-attempted' };
    if (confidence >= 2) {
      promoResult = await promoteIfConsensus(db, nonprofit, f.field);
    }

    // Prose fields (mission, description, tagline) DO NOT auto-promote.
    // Consensus on prose doesn't converge across models (every agent writes
    // its own sentence) and the prior trusted-agent shortcut was removed
    // 2026-04-16 after CSO audit — agent_name is self-reported, so any
    // unauthenticated caller could impersonate a trusted model and poison
    // empty fields at scale. Prose stays queued for committee review.
    const isProse = AUTO_PROMOTE_PROSE_PENDING.has(f.field);

    const applied = promoResult.promoted;
    submissions.push({
      id,
      field: f.field,
      field_type: isProse ? 'prose' : (AUTO_PROMOTE_STRUCTURED.has(f.field) ? 'structured' : 'other'),
      status: applied ? 'applied' : 'pending',
      confidence,
      consensus: confidence >= 2 ? 'high — multiple agents agree' : 'single agent — awaiting corroboration',
      applied,
      promotion_note: promoResult.promoted
        ? `Promoted live — ${promoResult.agents} agents agreed on the same value after normalisation.`
        : isProse
          ? 'Prose fields do not auto-promote. Submission queued for committee review.'
          : confidence >= 2
            ? 'Consensus count reached but no two normalised values match yet.'
            : 'Awaiting a second agent to corroborate the same value.',
      prior_rejections: priorRejections,
      profile_url: applied ? `https://giveready.org/api/nonprofits/${slug}` : undefined,
    });
  }

  const hasConsensus = submissions.some(s => s.confidence >= 2);
  const anyApplied = submissions.some(s => s.applied);
  const anyProse = submissions.some(s => s.field_type === 'prose');

  // submissions.length is fields actually accepted (after validity filter);
  // fields.length is what the agent sent. Log both signals via fields_count =
  // accepted count, payload_bytes = raw body size — these together tell us
  // how much was sent vs how much landed.
  await logEnrichmentAttempt(db, {
    slug,
    ua,
    ip,
    referrer,
    status_code: 201,
    error_class: anyApplied ? 'ok_applied' : (submissions.length > 0 ? 'ok_pending' : 'no_valid_fields'),
    fields_count: submissions.length,
    payload_bytes: payloadBytes,
  });

  return json({
    message: anyApplied
      ? `Consensus reached. ${submissions.filter(s => s.applied).length} field(s) promoted live on ${nonprofit.name}.`
      : `Thank you. ${submissions.length} enrichment(s) submitted for ${nonprofit.name}.`,
    nonprofit: nonprofit.slug,
    submissions,
    note: anyApplied
      ? 'Your enrichment is live. Your agent name is credited at https://giveready.org/agents.'
      : anyProse
        ? 'Prose fields (mission, description, tagline) queue for committee review — no two agents write identical prose. Structured fields (website, city, region, founded_year, contact_email) auto-promote when two agents agree on the normalised value.'
        : hasConsensus
          ? 'Multiple agents have submitted for this field, but no two normalised values match yet. Try submitting a more canonical form.'
          : 'Your submission will be reviewed. If another agent independently submits matching data, it promotes automatically.',
    auto_promote: {
      structured: Array.from(AUTO_PROMOTE_STRUCTURED),
      prose_pending: Array.from(AUTO_PROMOTE_PROSE_PENDING),
    },
    leaderboard: 'https://giveready.org/agents',
  }, 201);
}

export async function handleEnrichmentStats(db) {
  const total = await db.prepare(
    `SELECT COUNT(*) as count FROM agent_enrichments`
  ).first();

  const byStatus = await db.prepare(
    `SELECT status, COUNT(*) as count FROM agent_enrichments GROUP BY status`
  ).all();

  const byField = await db.prepare(
    `SELECT field, COUNT(*) as count FROM agent_enrichments GROUP BY field ORDER BY count DESC`
  ).all();

  const uniqueAgents = await db.prepare(
    `SELECT COUNT(DISTINCT agent_id) as count FROM agent_enrichments`
  ).first();

  const highConfidence = await db.prepare(
    `SELECT COUNT(*) as count FROM agent_enrichments WHERE confidence >= 2`
  ).first();

  const recentSubmissions = await db.prepare(
    `SELECT ae.nonprofit_slug, ae.field, ae.agent_name, ae.confidence, ae.created_at
     FROM agent_enrichments ae
     ORDER BY ae.created_at DESC LIMIT 10`
  ).all();

  return json({
    total_enrichments: total.count,
    unique_agents: uniqueAgents.count,
    high_confidence: highConfidence.count,
    by_status: byStatus.results,
    by_field: byField.results,
    recent: recentSubmissions.results,
  });
}
