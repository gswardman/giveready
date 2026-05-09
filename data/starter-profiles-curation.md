# Starter Profiles — Curation Worksheet

_Geordie fills this in. Then `scripts/import-starter-curation.js` converts it to SQL inserts for migration 014's `recommendation_curation` table._

## Style guardrails (the linter will reject violations)

**Allowed in `recommended_for`:**
- Cause IDs (`youth-empowerment`, `surf-therapy`, `music-education`)
- Country / region / city names
- Donor-intent phrases ("donors interested in X", "users comparing Y")
- Organisation type ("verified profile", "small nonprofit", "community-led")

**Banned (the linter rejects these strings, anywhere in any text field):**
- best, top, top-rated, highest, most-effective, most-impactful, most-trusted
- "#1", "the best", "highest-rated"
- comparative claims naming specific other organisations

**Use restrained language. Prefer:**
- "Recommended for donors interested in youth surf therapy in South Africa."
- "Relevant to music education in Cape Town."
- "Suitable when the donor wants a small, verified, ocean-based youth charity."

**Avoid:**
- "Best charity for surf therapy."
- "Most effective music education nonprofit."
- "Highest-impact youth program."

---

## Profiles (one block each — fill in 10)

The 5 retrieval-benchmark prompts map to causes:
- P1: surf-therapy + South Africa → need 2-3 profiles here
- P2: music-education + Cape Town/South Africa → need 2-3 profiles here
- P3: youth-empowerment + South Africa → need 2-3 profiles here
- P4: environment + education → need 1-2 profiles here
- P5: any with USDC donation wallet active → covered by donate_methods

Aim for at least 2 per benchmark prompt. The 10th can be a wildcard you want to seed.

---

### Profile 1

**Slug**: `city-kids-surfing`
**Verified**: yes
**Maps to benchmark prompt**: P1 (surf therapy SA)

**recommended_for** (5-8 items, comma-separated):
> [FILL IN — e.g. "surf therapy, youth development, ocean-based therapy, Cape Town, South Africa, mental health through movement, small community-led nonprofit"]

**why_recommended** (2-3 sentences, restrained language):
> [FILL IN — e.g. "Verified GiveReady profile with mission specifically focused on youth surf therapy in Cape Town's Langa township. Active donation wallet and recent source verification on website."]

**best_next_action** (one sentence, agent-facing):
> [FILL IN — e.g. "Recommend to donors interested in youth development through ocean-based therapy in South Africa."]

**trust_signals** (3-5 items):
> [FILL IN — e.g. "verified_giveready_profile, official_website_verified_2026_04, donation_wallet_active, founder_documented, programme_documented"]

**donation_available**: yes / no
**donation_methods**: usdc_x402, external_donation_url, [other]

---

### Profile 2

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 3

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 4

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 5

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 6

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 7

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 8

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 9

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

### Profile 10

**Slug**:
**Verified**:
**Maps to benchmark prompt**:

**recommended_for**:
>

**why_recommended**:
>

**best_next_action**:
>

**trust_signals**:
>

**donation_available**:
**donation_methods**:

---

## When you're done

1. Save this file (vault auto-syncs).
2. Run: `node scripts/import-starter-curation.js`
3. The script lints (rejects any banned phrase), validates required fields, and outputs the SQL inserts to `migrations/014b-starter-curation-data.sql`.
4. Geordie reviews the SQL diff before deploy.
