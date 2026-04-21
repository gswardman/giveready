# GiveReady Strategy — 2026 & 2027

**Status as of 17 April 2026.** Single source of truth for direction.
Supersedes any older strategy docs. Code changes and the v4 Gates grant
proposal should reconcile to this document.

## One-line thesis

GiveReady is an open-source, agent-native donation directory that lets AI
assistants discover youth nonprofits and send them money directly via x402
(USDC) or Stripe Connect (fiat). 2026 is charity-only and free forever.
2027 extends the same platform into a for-profit rail for independent
authors (and adjacent creators) selling supplementary content via x402
micropayments.

## Legal + commercial entities

- **TestVentures.net** — Grant applicant / lead. Fractional-AI-ops service
  business. This is the entity Gates sees as the applicant.
- **Clean Tactile Ventures UK Ltd (CTV)** — UK limited company. Platform
  operator. Holder of the Stripe Connect platform account at
  `info@giveready.org`. The legal wrapper for GiveReady-the-product.
- **GiveReady.org** — Open-source product / brand. MIT licensed.
- Dual-entity structure keeps the service business and the platform legally
  separate. Grant funds flow to TestVentures; platform operations run
  under CTV.

## 2026 pilot partners

Only two orgs are formal pilots for the Gates application.

- **City Kids Surfing (CKS)** — UK youth surf charity. Joe Taylor is the
  point person. Named design partner. Receives lifetime free platform
  access (fiat + USDC). Live donation flow, quarterly case study, intros
  to similar UK youth charities, public testimonial at 6 and 12 months.
  Compensation: £3k cash partner fee (or whatever Joe says is fair,
  within reason), plus platform build retail-equivalent ~£20-30k as
  in-kind value. Total package framed ~£23-33k on the application.
- **Finn Wardman World Explorer Fund (WEF)** — Bermuda-based youth
  adventure grants endowment. Internal pilot. Eat-your-own-cooking. Not
  named on the application to avoid self-dealing optics, but used to
  prove the rail on a charity we already control.

Explicitly NOT involved (as of today):

- **The Wave Project** — previously listed in README, `wallet-messages.md`,
  `public/index.html` and `public/preview.html`. Removed from all.
- **Bridges for Music** — previously listed. Removed from README,
  `public/preview.html`, and `public/index.html`. Did not commit.
  Historical outreach preserved in `wallet-messages.md` with a
  partner-status note.

## 2026 product scope (charity-first)

### Non-negotiables

- Charity side is free forever. 0% take rate. Public brand promise.
- Crypto-first identity preserved. Fiat is a reassurance rail, not a pivot.
- Every feature shipped in 2026 must still make sense in 2027 when the
  commercial flip goes live.

### Payment architecture

Two rails, one `/api/donate/:slug` endpoint.

- **x402 + USDC on Solana** — already live in `src/index.js`. Direct-to-
  charity-wallet. No custody by CTV. No platform fee.
- **Stripe Connect, destination-charge mode** — new build. Funds settle
  directly into the charity's connected Stripe account. CTV never holds
  donor funds. Application Fee set to 0 for charities. MoR is the charity.
- **Statement descriptor viral loop** — set
  `statement_descriptor_prefix` to `GIVEREADY*` on the CTV platform
  account. Every donor's bank statement reads `GIVEREADY* CITY KIDS
  SURFING` (22 char total, 10 char prefix). Organic discovery channel.

### Gift Aid (UK)

- **Fiat (Stripe):** capture Gift Aid declarations (`donor_first_name`,
  `donor_last_name`, `donor_address_line_1`, `donor_postcode`,
  `gift_aid_confirmed`). Export to the charity. Charity claims from HMRC.
  GiveReady is not an HMRC intermediary.
- **USDC (x402):** do NOT auto-claim Gift Aid. Current UK HMRC guidance
  treats cryptoasset donations as property not cash, so Gift Aid does not
  straightforwardly apply. Revisit after formal opinion (see Legal below).

### Attribution v1

Ship in v1 alongside the fiat rail. Three fields on the donation record:

- `source_url` — where the donation flow started.
- `agent_identifier` — which AI agent initiated (null for human-direct).
- `campaign_id` — optional, for future.

No multi-touch, no cohort analysis. Just "where did this donation come from."
Same plumbing will carry the 2027 `unlock` flow.

### Discovery layer (already built)

- REST API, MCP server, `llms.txt`, `agents.md`, `.well-known/ai-plugin.json`,
  widget. No changes in 2026.

## 2027 commercial extension (for-profit, dormant in 2026)

Same codebase. Same database. Same directory. One flag on the entity record
flips the commercial side on.

- `entity_type` — `charity` (default) or `business`.
- `transaction_fee_rate` — `0.00` for `charity`, `0.02` for `business`.
- Two verbs on one substrate:
  - `/api/donate/:slug` for charities.
  - `/api/unlock/:slug/:item` for businesses.

### First commercial design partner

- **Likely-NYT-bestseller author** (name held). Wants to sell bonus
  content (companion lessons, bonus chapters, exclusive interviews) behind
  an x402 rail so an AI assistant in the reading loop can pay a small
  amount (~$1-5) and unlock content with no human checkout, no Stripe
  form, no subscription.
- Geordie will build this for him free as the commercial design partner.
  Trade is real-world feedback.
- Pitch delivered in bullet form, stored in session memory, queued as
  task #4.

### Commercial wedge shape

- **v2.0:** Indie authors (spearhead). Bonus-content unlocks via x402.
- **v2.1:** Independent journalists and newsletter writers.
- **v2.2:** Podcasters with transcripts.
- **v3+ (if at all):** coaches / course sellers. Different product shape,
  reassess later.

### Held architectural decisions for the commercial flip

- Creator hosts their own content. CTV gates access via signed token. CTV
  is a payment rail + directory, never a content host.
- 2% Application Fee on Stripe Connect for `entity_type=business`.
- 2% platform fee on x402 `unlock` flow.
- Authors pay 0 SaaS. Revenue only at transaction time.

## Biggest risks (acknowledged, managed)

1. **Agent micropayment demand in 2026 is near-zero.** Load-bearing. Build
   assuming it materialises in 2027; hedge with fiat rail + charity
   value-prop that works even if it doesn't.
2. **Gates may resist crypto framing.** Application language must say
   "programmable global payment rail for underbanked nonprofits,
   triggered by AI agents acting on behalf of donors." Avoid "crypto."
   Avoid "Solana." Use "USD-pegged stablecoin regulated by Circle" on
   first mention of USDC.
3. **HMRC treatment of USDC donations is murky.** Must have formal
   opinion before Gates submission.
4. **Bus factor of 1.** CTV + GiveReady is Geordie only. Governance
   resilience needs a second director (Kirsten most likely) and an
   advisory board (Joe post-CKS-partnership is a candidate, with COI
   managed).
5. **Zero demonstrable agent traffic today.** Must measure agent visits
   in Cloudflare logs before submission. Seed `llms.txt`, `agents.md`,
   MCP directories, agent-registry listings.

## Legal checkpoints (required before Gates submission)

Ordered by urgency. All tasks held until post-Joe-conversation per
Geordie's direction.

1. **UK HMRC crypto-charity tax opinion.** Stewardship
   (stewardship.org.uk) or Buzzacott charity tax team. 1-hr call
   £250-500, full opinion £1,500-2,000. First. (Task #2.)
2. **UK Fundraising Regulator registration check.** Is CTV operating
   GiveReady a "third-party fundraising platform" under the Code of
   Fundraising Practice? Same lawyer meeting as #1.
3. **FCA / PSR 2017 posture.** Confirm destination-charge Stripe Connect
   keeps CTV out of PSP status. Same meeting.
4. **MOU template** for charity partners. £300-500.
5. **Terms of Service + Privacy Policy** explicit on "platform, not PSP;
   funds flow direct to charity's Stripe Connect account; we do not hold
   donor funds; Gift Aid is charity's responsibility."
6. **GDPR DPA** for charity partners. Template, £150.
7. **"GiveReady" trademark check.** UK IPO + USPTO. £200-400.
8. **Review Stripe Connect Platform Agreement.** Free.
9. **CTV Companies House filings current.** DIY.
10. **Kirsten as CTV co-director.** Governance resilience. Conversation
    with Kirsten.

Total budget: £2,000-4,000 for all checkpoints.

## Governance resilience

- **Kirsten as CTV co-director** — no legal COI (spouses as co-directors
  of a UK private Ltd is standard). Solves legal continuity (second
  signatory, Companies House filings, company does not dissolve on a
  single point of failure). Does NOT on its own solve Gates' operational
  continuity / independent oversight concern. Confirmed as the direction
  pending Kirsten's conversation.
- **One named independent advisor on the Gates application** — to complement
  the Kirsten co-director structure. Joe (CKS) is the obvious first
  candidate once the partnership is signed (manageable COI: he is a paid
  partner, not a CTV director). Recommended to add one further UK
  charity-sector advisor for posture.
- **Joe on advisory board, not as a CTV director** — preserves the
  no-legal-COI structure on the company side while giving the application
  an independent voice.

## 6-month milestone sequence (April - October 2026)

- **April (this month):** Reply to Joe with partnership offer. Fix files
  (done: README, wallet-messages). Queue Stewardship HMRC call (task #2).
  Open CTV Stripe Connect platform application. Start UK
  Fundraising-Regulator / FCA opinion.
- **May:** Stripe Connect destination-charge integration. Gift Aid
  declaration capture (fiat only). Attribution v1. MOU with CKS signed.
  WEF onboarded. Legal checkpoints 4-6 complete. Gates application
  drafted.
- **June:** CKS + WEF live with real donation flow. Gates application
  submitted. First public case study.
- **July:** Measure agent traffic. Third-wave charity onboarding. First
  synthetic-but-real agent-donation demo.
- **August:** Gates follow-up (if advanced). Fourth-wave onboarding. Draft
  2027 commercial TOS / pricing.
- **September:** 50-100 live charities. Author design-partner commitment
  if in. `/api/unlock` scaffold (dormant, flag-gated).
- **October:** 6-month review. Green-light or adjust 2027 commercial flip.

## Currently tabled / held

Per Geordie's direction 17 April 2026:

- All 2026 build work beyond small file fixes is paused until after the
  Joe / CKS follow-up conversation.
- Stewardship call held until Joe conversation complete.
- v4 Gates grant proposal update held until more theories are proven.
  Proposal lives outside this repo (ask Geordie for location when ready).
- Author pitch sent (17 Apr 2026). Awaiting response. Close friend,
  expected yes.

## Decision log

- **17 Apr 2026** — TestVentures is grant lead. CTV UK Ltd is platform
  operator. CKS is sole named charity partner at £3k cash + lifetime
  platform build (~£20-30k in-kind). WEF is internal pilot. Wave Project
  and Bridges for Music are out. Both removed from README, `public/
  index.html`, `public/preview.html` and (historically noted) in
  `wallet-messages.md`.
- **17 Apr 2026** — Author pitch sent to commercial design partner.
  Expected yes.
- **17 Apr 2026** — Kirsten confirmed as planned CTV co-director
  (pending her conversation). Adds legal continuity, not a full
  governance solve. Pairing with a named independent advisor on the
  Gates application.
- **17 Apr 2026** — Crypto-first, fiat via Stripe Connect as reassurance
  rail. Destination-charge mode only.
- **17 Apr 2026** — Commercial flip is 2027, author-led, with journalists
  and podcasters as fast-follows. Coaches deferred to v3+ if at all.
- **17 Apr 2026** — Attribution ships in v1 (charity side).
- **17 Apr 2026** — Gift Aid: capture on fiat, do NOT auto-claim on USDC
  pending HMRC opinion.
- **17 Apr 2026** — Kirsten as CTV co-director for governance resilience
  (pending her conversation). Joe on advisory board, not a CTV director.
- **17 Apr 2026** — All building tabled pending Joe conversation.

## Open questions for Geordie

- Does Kirsten want the CTV co-director seat?
- Who is the second independent advisor for the Gates application
  (complementing Joe on the advisory board)?
- Where does the v4 grant proposal live so we can update it when ready?
