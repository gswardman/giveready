# Runbook: upgrade to Workers Paid, then stop hammering D1

Written 2026-09-04. Run from the Mac. Cowork cannot do any of this: `api.cloudflare.com`
returns 403 from the sandbox egress proxy, and the billing step has to be done by Geordie
in the dashboard regardless.

## Why this is happening (new, and it is not our traffic)

Cloudflare began **enforcing** D1 free-tier daily limits on **1 September 2026**. Before
that date the 5M rows_read/day limit was published but not hard-enforced, so the
`COUNT(*)`-per-request bug had been running for months and quietly cost nothing. The three
consecutive mid-morning outages on 1, 2 and 3 September are the enforcement date, not a
change in crawler volume.

Error text to expect in the logs:
`Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or
wait until tomorrow (midnight UTC) to continue.`

Two consequences worth being clear about:

1. The code bug is real and still needs fixing. It was always wasteful; it only became
   visible when enforcement started.
2. The bug cannot be fixed while the quota is spent, because `025a-stats-seed.sql` needs
   ~123k reads of its own. That is the deadlock we hit on 2 September. **The upgrade has to
   come first**, otherwise every fix attempt is a race against the daily reset.

## Cost, so the decision is not blind

| | Workers Free | Workers Paid |
|---|---|---|
| Base | $0 | **$5.00/month minimum, per account** |
| D1 rows read | 5 million/day | 25 **billion**/month included, then $0.001/million |
| D1 rows written | 100,000/day | 50 million/month included, then $1.00/million |
| D1 storage | 5 GB total | 5 GB included, then $0.75/GB-month |

Current burn is roughly 5M rows read/day, so about 150M/month. That is **0.6% of the
included 25 billion**. Even leaving the bug unfixed and letting traffic triple, D1 overage
is zero. Storage is 41,227 nonprofits plus ~240k discovery_hits rows, comfortably inside
5 GB.

Realistic bill: **$5/month, flat.** The fix below is still worth shipping, but for
correctness and latency, not to avoid a bill.

The one real downside of paid: an unbounded query bug now **bills** instead of **failing**.
On free, a runaway scan hits a wall. On paid it runs. Step 4 below sets the guardrail.

## STEP 1. Upgrade the account (Geordie does this, ~3 minutes)

I cannot do this step. Entering payment details is off-limits for me, so this one is yours.

1. Log in at `dash.cloudflare.com` on the account that owns the `giveready` Worker (the
   zone is `giveready.org`, zone_id `5ef15f7adb081b0117f2832bcfe44e0d`).
2. Left sidebar → **Workers & Pages**.
3. Right-hand panel → **Plans** (or **Workers & Pages** → **Plans** in the account menu).
4. Select **Workers Paid — $5/month**. Confirm the payment method already on file.
5. Note: Workers Paid is separate from any Cloudflare zone plan (Free/Pro/Business) on
   giveready.org. Upgrading here does not change the zone plan and does not change DNS,
   SSL, or anything customer-visible.

Cloudflare states the daily limits lift "typically within minutes".

## STEP 2. Verify the limit is actually gone

```bash
cd ~/TestVentures.net/giveready

# A query that reads more than a trivial number of rows. On free with a spent quota this
# returns error 1101; on paid it returns a number.
npx wrangler d1 execute giveready-db --remote --command \
  "SELECT COUNT(*) AS n FROM nonprofits;"
#    Expect: 41227. Note the rows_read in the meta output: ~41k, and that is the per-call
#    cost the fix in step 3 removes.

curl -s https://www.giveready.org/api/stats | jq
curl -s -o /dev/null -w "%{http_code}\n" https://www.giveready.org/sitemap.xml
#    Expect 200 on both, and no 1101.
```

Do this check **after** 07:54 UTC or on a day the site has already fallen over, otherwise a
fresh daily quota makes free and paid look identical and the check proves nothing.

## STEP 3. Ship the fix that stops the hammering

This is the existing runbook, unchanged and still correct:
`docs/DEPLOY-d1-rows-read-fix-2026-09-02.md`. Short form, now that quota pressure is off:

```bash
cd ~/TestVentures.net/giveready
rm -f migrations/.fuse_hidden* docs/.fuse_hidden* scripts/.fuse_hidden*
git status --porcelain
npm test                      # expect 43 pass, 0 fail

# 1. The fix. ~123k reads.
npx wrangler d1 execute giveready-db --remote --file=migrations/025a-stats-seed.sql

# 2. Verify it landed.
npx wrangler d1 execute giveready-db --remote --command \
  "SELECT key, value, updated_at FROM stats_cache ORDER BY key;"
#    nonprofit_count ~41227 with TODAY's updated_at. An April stamp means nothing is fixed.

# 3. Redeploy. Ships the batched-prune fix in scheduled(), plus the registry endpoints
#    and the noStore() work already sitting uncommitted in the tree.
npx wrangler deploy

# 4. Retention catch-up. Re-run until it reports 0 rows written. ~4 invocations.
npx wrangler d1 execute giveready-db --remote --file=migrations/025c-prune.sql

# 5. Cosmetic, after step 4 so the number describes the pruned table.
npx wrangler d1 execute giveready-db --remote --file=migrations/025b-discovery-total-seed.sql

# 6. Optional index. Skip freely.
npx wrangler d1 execute giveready-db --remote --file=migrations/025d-optional-list-index.sql
```

**Commit the tree afterwards.** `src/index.js` has been uncommitted and 025b/c/d untracked
for three days. That is why yesterday's digest could not tell whether the fix had shipped.

Expected result: daily burn under 500k rows, down from ~5M. Roughly a tenfold cut, and it
makes the `/api/stats` path ~41,000x cheaper per call.

## STEP 4. Set the billing guardrail (do not skip this)

Paid means a runaway query bills rather than fails. Add a usage notification so a regression
shows up as an email instead of an invoice.

Dashboard → **Notifications** → **Add** → Workers / billing usage alert. Set a threshold at
roughly 1 billion rows read per month, which is about 7x normal post-fix burn and still only
4% of the included allowance. Anything tripping that is a bug, not growth.

Also worth reading once a week for the first month:
**Workers & Pages → D1 → giveready-db → Metrics → Row Metrics.**

## STEP 5. Update the digest

Once step 3 lands, the daily digest freshness section should stop treating
`nonprofit_count_as_of` as an alarm. Leave the 48-hour fuse in place — it is the thing that
catches a broken cron — but the digest should read a fresh stamp as normal rather than as a
pending outage.

## MEASURED RESULTS, 2026-09-04 06:30 UTC

`scripts/d1-audit.sh`, run against the live database after the paid upgrade and after
`wrangler deploy`. These replace every estimate above.

| Path | rows_read | Duration | Verdict |
|---|---|---|---|
| nonprofit detail by slug | 1 | 0.3ms | Fine. Highest-volume route, costs one row. |
| sitemap (verified only) | 354 | 1.1ms | Fine. `idx_nonprofits_verified` working. |
| nonprofits full count | 41,227 | 2.2ms | The recount. Once a day is correct. |
| discovery_hits full count | 224,954 | 39ms | Daily `discovery_hits_total` recount. |
| prune backlog (>90d) | 52,256 | 50ms | 23% of the table is expired. |
| **/api/nonprofits list** | **82,454** | **75ms** | **Broken. Fix with 025d.** |
| **admin traffic matrix 720h** | **146,525** | **395ms** | **Unfixed by any index. See below.** |

Indexes present on the live database: `idx_discovery_hits_created_ua_route` **exists**, so
migration 023 did apply on 2026-08-22 despite the wrong-database-name comment.
`idx_nonprofits_verified` and `idx_discovery_hits_created` exist.
**`idx_nonprofits_list_order` is absent** — 025d has never been applied.

### /api/nonprofits reads 82,454 rows, which is 2 x 41,227

A full scan to gather, then a full temp B-tree sort for
`ORDER BY verified DESC, beneficiaries_per_year DESC, id`, then `LIMIT 50`. The sort is the
work, so caching cannot help and only the index can. 025d takes it to roughly 50 rows.
That is a ~1,600x cut on a public endpoint whose call volume has never been measured,
because `/api/nonprofits` is absent from the discovery-logged route list. **Promote 025d
from optional to required.**

### The admin traffic matrix is the one no index fixes

146,525 rows against a 720h window that held 73,154 raw rows this morning.
2 x 73,154 = 146,308, and the 217-row gap is the few hours since. So the query reads the
window **twice**: once as an index range scan on `created_at`, once more through the temp
B-tree that `GROUP BY user_agent, route` forces, because the index leads on `created_at`
and cannot deliver rows in group order.

Reordering the index to `(user_agent, route, created_at)` does not help: it would fix the
grouping and break the range filter, scanning all 224,954 entries instead.

The fix is architectural, not an index: a `discovery_daily` rollup table written by the
03:17 cron, one row per (day, user_agent, route). The admin windows then read ~60 agents x
~10 route classes x 30 days instead of 73k raw rows twice, and the digest's three windows
become nearly free. Schema change, so it carries an eng-review gate. Not urgent on paid.

### Correction to the fix order given earlier today

**025c-prune was ranked too high, including by me.** It removes rows older than 90 days.
The admin traffic query only reads the trailing 30 days, so pruning does not touch its cost
at all. What the prune actually saves is ~52k rows/day on the single daily
`discovery_hits_total` recount. Worth running as housekeeping; it is not a win. Ranking it
above 025d was wrong.

### CONFIRMED FIXED, 2026-09-04 06:40 UTC

**025a-stats-seed applied.** 123,892 rows read, 10 written. `nonprofit_count_as_of` went
from `2026-09-02 07:54:25` to `2026-09-04 06:40:40`, 74 minutes before the 48-hour fuse
would have reverted `/api/stats` to a live `COUNT(*)` for 19 hours.

**025d applied.** Index build cost 82,972 read / 41,228 written / +1.1 MB.

| /api/nonprofits list | Before | After |
|---|---|---|
| rows_read | 82,454 | **50** |
| duration | 75.21ms | **0.49ms** |

1,649x fewer rows, 152x faster. The index build pays for itself after one call.

### Still open

1. **Verify the cron at 03:17 UTC on 2026-09-05.** `nonprofit_count_as_of` must read
   `2026-09-05 03:17:xx`. If it still reads 2026-09-04, the `scheduled()` rewrite did not
   take and the recount needs seeding by hand until it does. This is the only outstanding
   proof that the deploy fixed the cause rather than the symptom.
2. **Commit the tree.** `src/index.js`, the 025 migrations and these docs are still
   untracked or modified as of 06:40 UTC. Three days of "is it deployed or not" confusion
   came from exactly this.
3. `025c-prune`, housekeeping, no hurry.
4. `discovery_daily` rollup for the 146k admin query, eng-review gate, not urgent on paid.

### Honest framing now that the plan is paid

At ~150M rows/month against 25 billion included, none of this costs money. The 025d fix is
worth shipping for **latency** — 75ms of database time on a public endpoint — and because an
unmeasured full scan is how the `/api/stats` leak grew unnoticed in the first place. Do not
let anyone re-justify this work on the basis of the bill.

## What I am deliberately not proposing

- **Recounting hourly to keep the cache warm.** 24 × 41,227 is ~989k rows/day spent
  maintaining a cache. Worse than the original bug. The 2026-09-02 runbook already rules
  this out; it stays ruled out on paid.
- **Caching `verified_count`.** It is ~177 indexed rows and it froze once already, on
  2026-08-02, which made a working registration flow read as broken. Leave it live.
- **Removing the 48-hour staleness fuse now that the limit is lifted.** The fuse is the only
  thing that turns a broken cron into a visible signal. Keep it.
