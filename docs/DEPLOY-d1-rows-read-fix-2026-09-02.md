# Deploy: D1 rows_read fix, 2026-09-02

Run from the Mac. Cowork cannot do this: `api.cloudflare.com` returns 403 from the sandbox
egress proxy, so neither `wrangler deploy` nor `wrangler d1 execute` works there.

Diagnosis: `01-Projects/GiveReady/2026-09-02-d1-rows-read-diagnosis.md`

## THE DATABASE IS CALLED `giveready-db`, NOT `giveready`

`wrangler.toml` line 26: `database_name = "giveready-db"`. The comments in migrations 023
and 024 said `giveready`, this runbook copied them, and the first attempt on 2026-09-02
failed with `Couldn't find DB with name 'giveready'`. All of them are now corrected, along
with `scripts/registry-check-daily.sh` line 79, which carried the same wrong name and would
have failed at its apply step the moment the registry endpoint went live.

## State as of 2026-09-02 07:20 UTC

The Worker IS deployed (version `e9b93a6d`). The migration is NOT applied, because of the
name above. That is the wrong order: the new `handleStats` reads a `nonprofit_count` still
stamped April, trips its 48-hour staleness fuse and falls back to the live `COUNT(*)`, so
the site is currently paying the old price.

The quota was already exhausted at 07:20 UTC, thirteen hours earlier in the day than
yesterday's 20:15. Every database route returns 1101; `/`, `/guides` and `/AGENTS.md` still
serve. **The migration cannot run while the quota is spent** — `DELETE ... WHERE` and
`COUNT(*)` both need reads. There is no engineering path to restoring the site today. Only
the Workers Paid plan lifts the limit before 00:00 UTC.

## The migration was split after `D1_RESET_DO`

The 07:49 UTC attempt returned `✘ [ERROR] {"D1_RESET_DO":true}` and rolled back. Two causes,
and both had to be fixed regardless of which dominated:

1. The rows_read quota was already spent, so nothing touching D1 succeeds.
2. The file contained one unbounded `DELETE` covering ~165,000 rows. That is a single
   transaction large enough to restart the Durable Object behind D1, and it would have
   failed the same way on an idle unmetered database.

Bundling also meant the cheap important part could not land without the expensive optional
part succeeding, because wrangler applies a file as one batch. `025-d1-rows-read-fix.sql` is
now a stub that explains this and does nothing. Four independently retryable files replace
it, cheapest and most important first.

**The same unbounded DELETE was in `scheduled()`.** It is fixed there too, bounded to
2,000 rows per statement and 5 passes per night, so a backlog drains over several nights
instead of in one dangerous transaction. That bug was already deployed and would have fired
at 03:17 UTC with nobody watching. `wrangler deploy` again to ship the fix.

## Run order

```bash
cd ~/TestVentures.net/giveready

# 0. Clear the .fuse_hidden leftovers from the Cowork edit, then confirm the tree.
rm -f migrations/.fuse_hidden* docs/.fuse_hidden* scripts/.fuse_hidden*
git status --porcelain
npm test                      # expect 43 pass, 0 fail

# 1. THE FIX. ~123k reads. If you run nothing else, run this.
npx wrangler d1 execute giveready-db --remote --file=migrations/025a-stats-seed.sql

# 2. Verify it landed. This is the check that says whether the fix is live.
npx wrangler d1 execute giveready-db --remote --command \
  "SELECT key, value, updated_at FROM stats_cache ORDER BY key;"
#    Expect: nonprofit_count ~41227 with TODAY'S updated_at. An April stamp means
#    the Worker is still falling back to the live COUNT(*) and nothing is fixed.

# 3. Redeploy, to ship the batched-prune fix to scheduled().
npx wrangler deploy

# 4. Retention catch-up. Re-run until it reports 0 rows written. ~4 invocations.
npx wrangler d1 execute giveready-db --remote --file=migrations/025c-prune.sql
npx wrangler d1 execute giveready-db --remote --command \
  "SELECT COUNT(*) AS remaining FROM discovery_hits WHERE created_at < datetime('now','-90 days');"

# 5. Cosmetic, and best done after step 4 so the number describes the pruned table.
npx wrangler d1 execute giveready-db --remote --file=migrations/025b-discovery-total-seed.sql

# 6. Optional, not part of fixes 1 to 3. Skip freely.
npx wrangler d1 execute giveready-db --remote --file=migrations/025d-optional-list-index.sql
```

Steps 4 to 6 can wait for a quiet quota. Only steps 1 to 3 are load-bearing.

## Verify live

```bash
# /api/stats now carries a cache header and a freshness stamp.
curl -s https://www.giveready.org/api/stats | jq '{nonprofits, verified_nonprofits, nonprofit_count_as_of}'
curl -sI https://www.giveready.org/api/stats | grep -i cache-control
#    Expect: nonprofit_count_as_of = today's timestamp, NOT "live (cache stale)".
#    Expect: cache-control: public, max-age=300

# Admin traffic no longer recounts the whole table.
curl -s "https://www.giveready.org/api/admin/traffic?hours=24&token=$TOKEN&cb=$RANDOM" \
  | jq '.summary | {total_discovery_hits, total_discovery_hits_as_of, discovery_hits_in_period_raw}'
#    Expect: a number and today's as_of. Null means the migration did not run.
```

Then watch the Cloudflare D1 rows_read graph for the account. Expected daily burn after
this lands is under 500k, down from ~5M.

## What each change does

| Change | Was | Now |
|---|---|---|
| `handleStats` | `COUNT(*) FROM nonprofits`, 41,227 rows per call, no cache header | reads `stats_cache`, ~15 rows per call, `max-age=300` |
| `handleStats` verified count | live | still live, deliberately: `idx_nonprofits_verified` reads ~177 rows and this is the number that froze on 2026-08-02 |
| `handleAdminTraffic` | `COUNT(*) FROM discovery_hits`, 240,779 rows on every call | reads `stats_cache`, recounted once daily |
| `handleListNonprofits` | `COUNT(*) FROM nonprofits` for the unfiltered total | reads `stats_cache` |
| `scheduled()` | reconciler only | reconciler hourly, plus prune + recount once a day at 03:17 UTC |
| `handleOnboard` | — | bumps `nonprofit_count` so a new registration is visible before the next recount |

## The trap this deliberately avoids

`stats_cache` was abandoned for these counts on 2026-08-02 because it only got written after
bulk imports, so the numbers froze and the digest read a working registration flow as
broken. Three things stop that recurring, and none of them should be removed:

1. `verified_count` is never cached.
2. `handleOnboard` bumps the counter on the registration path.
3. `handleStats` falls back to a live count and logs loudly if the cache is over 48 hours
   old, so a broken cron shows up as cost and a log line rather than a wrong number.

Do not "optimise" this by recounting hourly. 24 × 41,227 is 989k rows a day, a fifth of the
free tier, spent maintaining a cache. That is worse than the original bug.

## Migration files

| File | Reads | Status |
|---|---|---|
| `025-d1-rows-read-fix.sql` | — | Superseded stub. Do not run. |
| `025a-stats-seed.sql` | ~123k | **The fix.** Required. |
| `025b-discovery-total-seed.sql` | ~240k | Cosmetic. Null in the admin response without it. |
| `025c-prune.sql` | batched | Retention catch-up. Re-run to convergence. |
| `025d-optional-list-index.sql` | ~41k | Optional, outside the agreed scope. |

All four were run in order against a throwaway SQLite copy of the schema with 60,000
discovery_hits rows: the seed writes all six keys, the prune batches correctly and needs
re-running (which is the point), and the optional index turns the `/api/nonprofits` plan
from a full sort into `SCAN nonprofits USING INDEX idx_nonprofits_list_order`.

## What else ships

The working tree already carried uncommitted changes before today. `wrangler deploy` sends
all of it:

- `handleRegistryEins` and `handleRegistryRevoked` (commit 49b1bc4 follow-on). These are why
  `registry-check-daily.sh` has failed since 2026-08-27 with `/api/registry/eins returned
  404`. Deploying fixes that job, and the "checked within 24 hours" claim on
  `safe_to_recommend` becomes true again at the next 06:15 run. Covered by tests 42 and 43.
- The `noStore()` work from 2026-09-01 that stops admin telemetry being replayed from cache.

Both are wanted. Flagged only so the deploy is not a surprise.

## Rollback

```bash
npx wrangler rollback           # Worker only
npx wrangler d1 execute giveready-db --remote --command \
  "DROP INDEX IF EXISTS idx_nonprofits_list_order;"
```

The `stats_cache` rows are harmless to leave. The pruned `discovery_hits` rows are gone for
good, which is the intent: nothing reads past 30 days and retention is now 90.
