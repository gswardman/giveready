# progress.html — page copy

Editable prose for <https://giveready.org/progress>.
Source of truth is `public/progress.html`; this file mirrors its text so the writing can be
worked on without touching markup. Headings below map 1:1 to the sections in the HTML.
Edit here, then say the word and the changes get ported back into the HTML.

---

## Meta (head)

**meta description:** Citation share went from 0 to 9 of 10 prompts in 71 days. The numbers downstream are still early. The honest scoreboard, the methodology, and what the result does and does not prove.

**og:description:** 0 to 9 of 10 cited prompts in 71 days. The honest scoreboard, with methodology and limitations.

## Hero

**H1:** Progress, in numbers.

What we proposed in the original Gates Foundation application, what the data has shown since, and how the approach has changed. The numbers are what they are, including the ones that stayed at zero. The snapshots below let any reviewer compare what we claimed against what we now claim, in our own words on both sides.

**Stamp line:** Last updated: 2026-08-02 · 2 snapshots on file

---

## What we've learned

### 2026-08-02 progress note

**The discovery half is working. The payment half is still early.**

The May pivot set Citation Share as the north star: of 10 fixed charity-discovery prompts, how many return an answer that cites giveready.org. On 2026-05-24 that number was 0 of 10. On 2026-08-02 it is 9 of 10 on Perplexity, 71 days later, on a prompt list written and frozen before the guides existed. The single miss is absent from Perplexity's source set entirely, which is an indexing gap rather than a lost citation.

The numbers downstream of that are still at zero, and we are publishing them anyway. Over the last 30 days: 314 guide views, none of which arrived from an AI assistant. No guide-attributed donations. Ten directory queries in the life of the site. One nonprofit has attempted to register, during a period when the registration form was returning an error, since fixed. Small numbers on a small base, early.

Industry data (SparkToro, 2025) puts roughly 93% of AI search sessions ending without a click, so a citation is a mention rather than a visit, and citation share can keep climbing while click-through stays flat. And the part of this that actually matters, an AI assistant paying a charity on a person's behalf, is not ready yet. The x402 rails GiveReady runs on work today and are largely unused, and on any realistic reading they are a year or so away from being something an assistant reaches for as a matter of course. The directory, the guides and the citation position are being built now so they are already in place when that changes.

So the near-term success condition moves, openly, and before the measurement that would have tested it. The May pivot said the thesis is proven by a non-operator donation attributable to an AI answer. At today's volume, and with agent payments where they are, that is not yet a fair test, so it is logged as unproven rather than refuted, with the amendment dated 2026-08-07 ahead of the 2026-08-08 reading. The check we applied to ourselves: would we have amended this rule if the test were about to pass? Readers can judge that for themselves.

The build pace now matches that timeline. New guide production pauses and crawl work stops, because citation share has held steady on days when crawl volume fell. The effort goes into keeping the directory, the donate rails and the daily measurement running while the payment layer catches up, and into writing the citation result up as evidence for AI-for-charitable-giving grant applications, which is what it is good for today. The next full review is 2026-11-23. Three things would bring work forward sooner: charity signups picking up, a grant application reaching interview stage, or an outside party asking for the citation methodology.

What funding changes: the constraint here is hours, not ideas. The measurement runs, the rails run, and the directory is 41,000 organisations deep. Funded, the work that resumes first is the citation-to-click measurement, verified depth across the thin entries, and putting the methodology in front of the charities and researchers who have asked for it. We are ready to do that work and would welcome a partner for it.

### 2026-05-23 honesty note

The Gates application proposed AI agents would autonomously enrich the nonprofit directory by writing data back through `/api/enrich`. Four to six weeks of live traffic showed otherwise. Training crawlers (GPTBot, ClaudeBot, Google AI) ingest the directory at high volume, but they cannot submit by design. Interactive agents (ChatGPT-User, Claude-User, Perplexity-User) rarely arrive at the site, and when they do, they read and leave. The autonomous-write thesis is dead at scale now, but that doesn't mean it will stay that way. So we keep tracking and training off of our live data looking for loopholes or methods that can change.

What does work, on today's evidence: document ingestion is real and high-volume, so the path to AI-mediated giving is being the structured-data source that models cite when users ask charity questions. The path to verified depth is human-in-loop enrichment via consortium partners (people who run the orgs use AI to draft their own profile updates, then submit). Both are measurable. Neither requires the autonomous-write magic.

So the approach has evolved. The directory is still live, the donate widget still ships zero-fee donations, the MCP server still indexes for every AI assistant that follows the standards. The metrics below now lead with what's measurable today, not what was aspirational at submission.

---

## Snapshots on file

Each snapshot is a frozen point-in-time record. None has been edited since the date on its banner. New snapshots are added on three triggers: a pivot decision, a grant milestone reached, or a quarterly review. The 2026-08-02 update is recorded on this page rather than as a new snapshot. Reverse chronological below.

- **2026-05-24 — Pivot snapshot** (`/progress/2026-05-24-pivot`)
  Six weeks of live data refuted half of theory 1 and all of theory 5. Autonomous-agent-write thesis retired. New north star: Citation Share. Hard kill trigger locked at 2026-11-23 if citation share is still 0%.

- **2026-04-25 — Hypothesis snapshot, as submitted to the Gates Foundation** (`/progress/2026-04-25-application`)
  The original five theories, the Months 1 through 12 build plan, and the donor-behaviour indicators that the application proposed to track. Frozen the day the application went in.

---

## What GiveReady is now

### Discovery side

Open structured data layer indexed by AI training crawlers and search crawlers. When models are trained on the web, GiveReady's nonprofit profiles are in the corpus. When users ask charity questions, GiveReady-sourced data appears in the answers. We measure this directly via the Citation Share metric below.

### Enrichment side

Human-in-loop, and so far ahead of demand. The design is that consortium partners use AI assistants to draft enrichments for their own profiles and then submit them, the "AI does the research, the human signs the submission" pattern every B2A platform with documented writes has converged on. One organisation has attempted to register so far and consortium submissions are still at zero. The rails work and are waiting on the charity side to arrive.

---

## Metrics

_Nonprofits indexed, Verified nonprofits and Causes covered are overwritten at page load by `/api/stats`. The values shown here are the static fallbacks in the HTML._

### Nonprofits indexed - **41,000+**

Total in the directory. Imported from the IRS 990 registry, Every.org seed list, and consortium-partner submissions.

### Verified nonprofits - **177**

Registration confirmed against the relevant national registry (UK Charity Commission, IRS 990, etc.). The non-verified entries are listed but flagged as "registry-thin" until a partner enriches them.

### AI training-crawler hits, 7 days - **7,907**

Visits from GPTBot, ClaudeBot, Google AI, Perplexity and Cohere crawlers. Read this one sceptically: 3,936 of the 7,907 hits went to a single file, /AGENTS.md, which our own logs classify as a bounded retry pattern rather than ingestion breadth. Crawl volume has also moved independently of citation share, so we no longer treat it as a leading indicator of anything.

### Citation share (north-star metric) - **9 / 10** _(Perplexity, 2026-08-02)_

Of 10 fixed charity-discovery prompts, how many return an answer citing giveready.org. Baseline 0 of 10 on 2026-05-24. The Perplexity arm is automated and is the number quoted here. The Claude and ChatGPT arms are manual and currently unfilled, so the combined figure would understate the result; treat the Perplexity number as the real one and the other two as unmeasured. Prompts frozen until 2026-11-23.

### AI-referred guide views, 30 days - **0** _(of 314 total)_

Guide page views arriving with an AI assistant as the referrer, out of 314 total guide views in the window. This is the number that decides whether a citation produces a visit. Referrer stripping by the answer engines is a real confound and cannot be fully excluded, but the donate path recorded 6 AI-assistant referrals over the same 30 days, so referrer data does survive on some routes.

### Donations attributable to a guide - **0**

Donate-path arrivals carrying a guide referral tag. Referral attribution shipped 2026-07-25 and the propagation bug found that day was fixed. Perfect attribution applied to zero AI-referred arrivals still yields zero.

### Directory queries, lifetime - **10**

Searches run against the directory API by anyone other than the operator, across the life of the site. Zero this week.

### Donations to anchor nonprofits - **$12.76**

Cumulative USDC donated to the three named anchors (Finn WEF, City Kids Surfing, Bridges for Music) via the x402 endpoint. Nine donations, all dated April 2026, all operator test donations. None of any origin in the 112 days since. The rails work and are ahead of the market they are built for.

### Causes covered - **29**

Distinct cause areas in the directory, spanning 4 countries (UK, US, South Africa, Bermuda).

### Agent enrichment submissions - **51**

Write submissions to /api/enrich from AI agents, from 22 unique agents, one applied as a manual demo. Quiet since 2026-07-12. Kept on the page because the original proposal leaned on autonomous agent writes, and this is what that has produced so far.

### Infrastructure cost - **~$50/yr**

Annual hosting cost on Cloudflare Workers + D1 + R2. Includes the API, the MCP server, the donate widget, and every static page.

---

## What the citation result does and does not prove

### It proves

That a single operator working with AI assistants can make small, unrated, niche charities citable by a general AI answer engine, using structured guides over an open data layer, in 71 days, on roughly $50 a year of infrastructure. The prompts were frozen before the guides were written. The result is externally observable: anyone can run the same 10 prompts and check.

### It does not prove

That citations produce visits, donations, or charity signups. None of those has moved yet, and the honest reading is that the agent-payment layer they depend on is not ready. The sample is also small and self-selected: 10 prompts, written by us, on one engine with automated source attribution. The Claude and ChatGPT arms are manual and currently unfilled. If Perplexity changed how it retrieves sources tomorrow, the number would move without anything about GiveReady changing.

---

## How we measure citation share

Ten fixed prompts run daily against Perplexity, Claude and ChatGPT, covering UK, US and South African youth charities plus surf therapy and music education. The Perplexity arm is automated and is the number quoted above; the Claude and ChatGPT arms are manual and currently unfilled. The prompt list was written and frozen before the guides existed and stays frozen until 2026-11-23, so the number cannot be improved by choosing easier questions, and the full methodology is available to any funder or researcher who asks.

---

## What's deferred

New guide production is paused, and crawl-lift work has stopped because citation share held steady across days when crawl volume fell, so the two are less connected than we assumed. Measuring citation-to-click directly is the piece of work most worth doing, and it waits too, since at this volume it would cost more hours than the answer is currently worth. Also waiting: charity dashboard and onboarding improvements, x402 work beyond the rails that already run, and the manual Claude and ChatGPT citation legs. Full list in the project repo's `TODOS.md`. All of it comes back up for review on 2026-11-23, or sooner if the charity side or a grant application moves.

---

## Footer (unchanged)

Open-source infrastructure for charitable giving. Built by TestVentures.net. Revenue supports the Finn Wardman World Explorer Fund.

Operated by TestVentures.net (Geordie Wardman). Based in Switzerland. Contact: geordie@testventures.net
