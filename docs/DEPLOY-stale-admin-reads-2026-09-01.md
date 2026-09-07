# Deploy runbook: stale admin reads + discovery log health, 2026-09-01

Written in Cowork. **Not deployed** — the sandbox has no route to `api.cloudflare.com`.
Everything below is applied to the working tree and syntax-checked (`node --check` passes).
Deploy from the Mac.

## What happened

The 07:26 digest run pulled five admin endpoints and got the previous morning's
response back, byte for byte:

| endpoint | 09:18 read | 09:25 read |
|---|---|---|
| `/api/admin/traffic?hours=24` | 87 agent hits, newest row `2026-08-30 14:59:44` | 156 agent hits, newest row `2026-09-01 09:25:21` |
| `total_discovery_hits` | 235,901 | 239,490 |
| `/api/admin/funnel-guides` | identical to 2026-08-30 digest | live |

Same URLs, seven minutes apart, no deploy in between. Twelve parallel reads after
09:25 were all consistent and fresh, so the stale window closed on its own.

The digest read that frozen window as a 42-hour discovery-logging outage and made
it the headline. It was wrong, and nothing in the data could have refuted it: a
stale response is internally consistent. Every number agrees with every other
number, because they all came from the same real query — just yesterday's.

Root cause of the *reporting* failure is certain: `/api/admin/*` responses carried
no `Cache-Control` header at all, so any intermediary was free to hold and replay
them. The exact intermediary was not identified from outside; no `cf-cache-status`
was ever returned. The fix removes the permission rather than chasing the actor.

## What changed

| file | change |
|---|---|
| `src/index.js` | `noStore()` helper; applied to every `/api/admin/*` response at the single choke point in `fetch()` |
| `src/index.js` | `handleAdminTraffic` returns `generated_at`, `newest_logged_hit_at`, `newest_logged_hit_at_unfiltered`, `discovery_log_health` |
| `src/index.js` | `handleGuideFunnel` returns `generated_at` |
| `src/index.js` | `logDiscoveryHit` counts insert successes and failures instead of `.catch(() => {})`; still never throws into the request path |
| scheduled task `giveready-daily-digest` | cache-buster on every admin URL; new STEP 2b freshness gate; new Headline priority 0 for a confirmed write-path outage |

Two clocks are deliberate. `newest_logged_hit_at` is the newest allowlisted-agent
row and can legitimately go quiet for hours. `newest_logged_hit_at_unfiltered` is
the newest row from any user agent; that going quiet means the write path is down.
Reporting only the filtered clock would make a dead logger look like a slow news
day, which is the failure this whole change exists to prevent.

`discovery_log_health` is per-isolate and in-memory. It is not durable and not a
metric to trend. It answers one question on demand: are inserts failing right now,
and what was the last error.

## Before you deploy: the tree also contains the 2026-08-27 registry fix

`deploy.sh` stages all tracked and new files. The working tree still holds the
uncommitted registry work from `DEPLOY-registry-fix-2026-08-27.md`, which has
**never been deployed** — all three of its defects are still live today:

```
/api/nonprofits?limit=2      → rows carry no `registrations`   (defect 1)
/api/nonprofits?page=1 vs =5 → identical row                   (defect 2)
/api/nonprofits?limit=500    → returns 100                     (defect 3)
```

So a deploy now ships both changes. That is probably what you want, but decide it
deliberately rather than discovering it in the diff. To ship only the observability
fix, stash the registry work first.

## Deploy

```bash
cd ~/TestVentures.net/giveready
git diff                       # read it, both changes are in here
./deploy.sh "fix: no-store on admin endpoints, freshness fields, discovery log health"
```

## Verify

```bash
TOKEN=$(grep GIVEREADY_ADMIN_TOKEN ../.secrets/giveready.env | cut -d= -f2)

# 1. no-store header present
curl -sI "https://www.giveready.org/api/admin/traffic?hours=24&token=$TOKEN" | grep -i cache-control
#    expect: cache-control: no-store, no-cache, must-revalidate, max-age=0

# 2. freshness fields present and current
curl -s "https://www.giveready.org/api/admin/traffic?hours=24&token=$TOKEN" \
  | jq '{generated_at, newest_logged_hit_at, newest_logged_hit_at_unfiltered, discovery_log_health}'
#    expect: generated_at within seconds of now; unfiltered timestamp within minutes

# 3. repeated identical-URL reads stay fresh
for i in 1 2 3; do
  curl -s "https://www.giveready.org/api/admin/traffic?hours=24&token=$TOKEN" | jq -r .generated_at
  sleep 20
done
#    expect: three different timestamps. Identical timestamps mean it is still being cached.

# 4. insert failures are visible
npx wrangler tail --format pretty | grep -i "discovery_hit insert failed"
#    expect: silence. Any output is a live write-path failure.
```

If step 1 shows no header, the change did not deploy. If step 3 repeats a
timestamp, something upstream of the Worker is caching and the next step is a
Cloudflare cache rule on `/api/admin/*`, not another code change.

## Not done

- The caching intermediary was never positively identified. The fix denies
  permission rather than naming the actor. If step 3 fails after deploy, that
  identification becomes necessary.
- `discovery_log_health` resets on cold start. Fine for a diagnostic, useless as a
  trend. Do not build alerting on it without making it durable first.
