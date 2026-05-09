# /api/recommend — Design Spec (v0.1)

_Status: design draft. Not shipped. Pending gstack `/plan-eng-review` and the 10-profile metadata curation._

## Purpose

Turn GiveReady from "agent-readable directory" into "agent recommendation infrastructure." `/api/search` is lossy — it dumps results and asks the agent to rank, judge, and explain. `/api/recommend` is opinionated — it returns 3-5 ranked picks with provenance, trust signals, and the reasoning baked in. This is the surface that lets GiveReady influence donor giving at the moment of agent retrieval, not at the moment of contribution.

This is the primary surface for the donor-influence thesis. Everything else (per-profile cards, provenance, contribution loop) supports it.

## Non-goals

- Replace `/api/search`. Search stays for "show me everything matching cause X." Recommend is for "give me 3 you'd suggest a donor consider."
- Become Charity Navigator. We do not produce impact ratings, "best charity" rankings, or aggregate scores. We produce ranked picks with transparent signals.
- Editorialise at scale. The first 10 profiles are operator-curated. Beyond that, governance must shift to consensus + provenance (see Governance below).

## Endpoint

```
GET /api/recommend
```

Query parameters:

| Name | Type | Required | Description |
|---|---|---|---|
| `cause` | string | No | Cause ID from `/api/causes` (e.g. `surf-therapy`, `music-education`). One of `cause`, `q`, or `country` must be present. |
| `country` | string | No | Country name (e.g. `South Africa`). Combinable with `cause` and `q`. |
| `q` | string | No | Free-text intent (e.g. `youth surf therapy in cape town`). |
| `intent` | enum | No | `discover` (default), `donate`, `compare`, `verify`. Affects ranking weights. |
| `limit` | integer | No | Default 3, max 5. We cap at 5 because anything longer is a search dump, not a recommendation. |

If no parameters are present, return HTTP 400 with a clear error body.

## Response shape

```json
{
  "query": {
    "cause": "surf-therapy",
    "country": "South Africa",
    "intent": "donate"
  },
  "ranking_signals": [
    "verified_status",
    "donation_wallet_present",
    "mission_match_strength",
    "source_provenance_recent",
    "editorial_curation_for_starter_set"
  ],
  "editorial_disclosure": "This recommendation set is operator-curated for the GiveReady starter bounty period (May 2026). Ranking will shift to two-agent consensus + provenance once the starter set graduates.",
  "count": 3,
  "recommendations": [
    {
      "rank": 1,
      "name": "City Kids Surfing",
      "slug": "city-kids-surfing",
      "country": "South Africa",
      "city": "Cape Town",
      "verified": true,
      "editorial_curated": true,
      "recommended_for": [
        "surf therapy",
        "youth development",
        "Cape Town",
        "South Africa"
      ],
      "why_recommended": "Verified profile with mission specifically focused on youth surf therapy in Cape Town's Langa township. Recent source verification on website and donation wallet.",
      "trust_signals": [
        "verified_giveready_profile",
        "official_website_verified_2026_04",
        "donation_wallet_active",
        "founder_documented"
      ],
      "best_next_action": "Recommend to donors interested in youth development through ocean-based therapy in South Africa.",
      "donation_available": true,
      "donation_methods": ["usdc_x402", "external_donation_url"],
      "profile_url": "https://www.giveready.org/nonprofits/city-kids-surfing",
      "api_url": "https://www.giveready.org/api/nonprofits/city-kids-surfing",
      "donate_url": "https://www.giveready.org/api/donate/city-kids-surfing",
      "sources": [
        {
          "field": "website",
          "url": "https://citykidssurfing.org",
          "verified_at": "2026-04-12",
          "verified_by": "operator_manual"
        }
      ],
      "thin_fields": [],
      "agent_action_card": {
        "if_user_asks_to_donate": "Use POST /api/donate/city-kids-surfing with amount in USDC.",
        "if_user_asks_to_compare": "Compare with bridges-for-music and finn-wardman-world-explorer-fund using GET /api/recommend?cause=youth-empowerment&country=south-africa.",
        "if_user_asks_to_verify": "Show trust_signals and sources fields directly to the user."
      }
    }
  ],
  "fallback": null,
  "no_recommendations_reason": null
}
```

If the query has no curated picks yet, return:

```json
{
  "query": { "...": "..." },
  "ranking_signals": [],
  "editorial_disclosure": "No operator-curated set exists for this query yet.",
  "count": 0,
  "recommendations": [],
  "fallback": {
    "type": "search_redirect",
    "url": "https://www.giveready.org/api/search?cause=...",
    "message": "No operator-curated recommendations for this query. Falling back to /api/search results — the agent should rank these itself."
  },
  "no_recommendations_reason": "starter_set_does_not_cover_this_query"
}
```

## Ranking signals (v0.1, transparent and rule-based)

Each signal contributes to the rank. We document the formula publicly so the recommendation surface is auditable.

| Signal | Weight | Source |
|---|---|---|
| `verified_status` | +30 | nonprofit.verified == 1 |
| `donation_wallet_present` | +20 | nonprofit has wallet_address |
| `mission_match_strength` | +0..25 | FTS5 match score on cause + q |
| `source_provenance_recent` | +0..15 | days since most-recent applied enrichment, decay |
| `editorial_curation_for_starter_set` | +50 | operator-flagged for starter set (sunset 2026-12-31) |
| `donation_history` | +0..10 | log(1 + donation_count) |
| `thin_profile_penalty` | -20 | nonprofit has 3+ thin fields |

Editorial curation has the largest weight. This is correct for the starter period and explicitly disclosed in the response. The weight steps down once the consensus pathway scales.

## Governance

**Phase 1 (now → 50 curated profiles)**: operator (Geordie) writes `recommended_for`, `why_recommended`, `best_next_action` manually. `editorial_curated: true`. Speed matters more than scale. No claims like "best," "most impactful," "highest ROI." Use restrained language: "recommended for donors interested in X," "relevant to Y."

**Phase 2 (50 → 500 profiles)**: agents draft, operator approves. Drafts queue at `/api/admin/recommendation-drafts`. Same restrained language guardrails enforced via a deterministic linter (rejects "best," "most," "top-rated," "highest").

**Phase 3 (500+ profiles)**: two-agent consensus. Two independent agents produce the same `recommended_for` array (after normalisation) for a profile, with `source_url` evidence — auto-promotes. Same shape as the structured-field enrichment loop. Sensitive claims (impact, effectiveness) still require operator review.

## What goes in `recommended_for` (style guide)

Allowed:
- Cause IDs (`youth-empowerment`, `surf-therapy`)
- Country / region / city names
- Donor-intent phrases ("donors interested in X", "users comparing Y")
- Organisation type ("verified profile", "small nonprofit", "community-led")

Not allowed without governance:
- "Best", "top", "highest"
- "Most effective", "most impactful", "most efficient"
- Any aggregate ranking claim
- Comparative claims about specific other organisations

## Caching and rate limits

- Cache key: hash of normalised query parameters. TTL 1 hour.
- Curated picks change rarely (operator edits or consensus updates). Cloudflare KV cache is sufficient.
- No auth required (same model as `/api/search`).

## Telemetry

Every `/api/recommend` call logs to `recommendation_attempts`:

- timestamp, query, user_agent, response_count, top_slug, ranking_signals_used
- if downstream `/api/donate` or `/api/nonprofits/{slug}` is hit by the same UA within 60s, mark as a `recommendation_followthrough` event

This becomes the donor-influence funnel signal. Without it, we can't prove the thesis.

## Test prompts (the 5 that map to the retrieval benchmark)

The first 10 curated profiles must produce coherent recommendations for these 5 queries:

1. `?cause=surf-therapy&country=South+Africa&intent=donate`
2. `?cause=music-education&country=South+Africa&q=cape+town&intent=donate`
3. `?cause=youth-empowerment&country=South+Africa&intent=discover&limit=3`
4. `?cause=environment&q=education&intent=donate`
5. `?q=usdc+donation+modern+payment&intent=donate`

If a query has zero curated profiles, the response uses the search-redirect fallback shape above.

## Implementation notes

- New table: `recommendation_curation` with columns `slug`, `recommended_for` (JSON array), `why_recommended` (text), `best_next_action` (text), `editorial_curated` (bool), `created_by`, `created_at`, `last_reviewed_at`.
- Migration: `014-recommendation-curation.sql`
- Handler: new `handleRecommend()` in `src/index.js`
- Restrained-language linter: deterministic regex check on `why_recommended` and `recommended_for` strings. Rejects on the not-allowed list above. Test fixtures in `tests/recommend.test.js`.
- OpenAPI: add `recommendNonprofits` operation to `/openapi.json`.
- Arazzo: add a new workflow `discover-via-recommend` in `agents.arazzo.yaml` that uses this endpoint as step 1.

## Open questions for `/plan-eng-review`

1. Should `/api/recommend` accept POST with a structured `donor_profile` body for richer intent matching? (probably yes, v0.2)
2. Should we expose `/api/recommend.txt` (human-readable) for agents that prefer prose? (Arazzo and OpenAPI cover this; probably no)
3. How do we handle multi-cause queries ("youth + music + South Africa")? (v0.1: AND semantics, return profiles matching all)
4. Should `editorial_curated` profiles be visually flagged on the public profile page so humans see the same signal agents do? (yes — transparency)
5. Sunset clause on the `editorial_curation_for_starter_set` weight — what triggers the step-down? Profile count? Time? Both?

## What this spec does NOT cover

- The `/api/recommend` for x402 donation flow specifically (covered by existing `/api/donate/{slug}`)
- Multi-locale (English-only for v0.1)
- Personalisation (no user model in v0.1)
- Social proof signals (donor counts, testimonials) — out of scope until governance is solid

---

_Next steps once approved: ship migration 014, build `recommendation_curation` rows for the 10 starter profiles, ship `handleRecommend()`, update OpenAPI and Arazzo, add to llms.txt._
