# Deploy runbook: registry check fix, 2026-08-27

Written in Cowork, applied and deployed from the Mac. The sandbox cannot reach
irs.gov or api.cloudflare.com, so nothing below was run against production.

Everything is already applied to the working tree. Review the diff, then deploy.

## What changed and why

The daily IRS registry check ran five mornings and matched zero rows. It
downloaded 77MB, parsed 1,226,852 revoked and 1,412,318 exempt EINs correctly,
joined them against an empty list, and logged "no updates to apply".

Four stacked defects, all silent:

1. `/api/nonprofits` list rows never returned `registrations`. Only the
   single-profile endpoint does. The EIN extraction loop always saw `[]`.
2. `page` was accepted and ignored. `page=1`, `page=5`, `page=20` all returned
   the same first record.
3. `limit=500` was capped at 100, so `rows.length < 500` broke the loop after
   one page regardless.
4. `wrangler: command not found` under launchd. Nothing could be applied even
   after a good join.

Plus: 2 of 5 runs died on transient irs.gov errors with no retry.

## Files

| file | change |
|---|---|
| `src/index.js` | trust filters on `/api/search`; `page` + `country` on `/api/nonprofits`; new `/api/registry/eins`; new `/api/registry/revoked` |
| `scripts/apply-registry-fix-2026-08-27.py` | the patcher that produced the `src/index.js` change. Idempotent. Kept for the audit trail |
| `scripts/check-irs-revocations.js` | `loadDirectoryEins()` rewritten onto the new endpoint; download retry; refuses to proceed on 0 join keys |
| `scripts/registry-check-daily.sh` | resolves wrangler properly; fails loudly if the D1 apply fails |
| `tests/registry-endpoints.test.js` | 18 new tests, all passing |
| `package.json` | `npm test` was `node --test tests/`, which throws MODULE_NOT_FOUND on Node 22. Nobody was running the suite |

No migration needed. 024 is already applied: the live API returns
`registry_status` blocks and `unsupported_country` is populated.

## Pre-flight, already done here

```
node --check src/index.js                  # OK
node --check scripts/check-irs-revocations.js   # OK
bash -n scripts/registry-check-daily.sh    # OK
node --test "tests/*.test.js"              # 42 pass, 0 fail
```

## Deploy

```bash
cd ~/TestVentures.net/giveready

git diff --stat
npm test

npx wrangler deploy
```

Note there was already uncommitted work in `src/index.js` before this change:
the registry status-history block on the nonprofit page, from the 024 session.
It has never been deployed. It goes out with this. Read that part of the diff
before shipping if you want them separate.

## Verify the endpoints

```bash
# should return ~1000 rows with ein and ein_source, plus a next_cursor
curl -s 'https://www.giveready.org/api/registry/eins?limit=5' | jq

# page must now move
curl -s 'https://www.giveready.org/api/nonprofits?page=1&limit=5' | jq -r '.nonprofits[0].id'
curl -s 'https://www.giveready.org/api/nonprofits?page=9&limit=5' | jq -r '.nonprofits[0].id'
# ^ these two must differ

# country must filter the total
curl -s 'https://www.giveready.org/api/nonprofits?country=United%20Kingdom&limit=1' | jq '.total'
# ^ must NOT be 41227

# empty until the first successful check, and that is correct
curl -s 'https://www.giveready.org/api/registry/revoked' | jq '.count'
```

## Then run the check by hand once

Do not wait for 06:15. Run it while you can watch it.

```bash
cd ~/TestVentures.net/giveready
bash scripts/registry-check-daily.sh
```

Expected in `01-Projects/GiveReady/registry-checks/2026-08-27.md`:

- `~35,000 US registration numbers in the directory`, not 0
- `by source: registrations N, id_pattern M`
- a real split across good_standing / revoked / revoked_reinstated / not_found
- `using: /path/to/wrangler` then `**Applied to D1.**`

If it says 0 join keys it now exits 2 and applies nothing. That is the point.

## Then check the filters work

```bash
curl -s 'https://www.giveready.org/api/search?cause=music-education&safe_to_recommend=1&checked_within_hours=24' | jq '.count, .query'
```

## What I did not do

- Did not touch the Pub 78 safety exit. It is correct.
- Did not change `safe_to_recommend` semantics. It is still
  `registry_status === 'good_standing'`, which excludes `revoked_reinstated`
  even though a reinstated organisation is in the current exempt file and is
  therefore fine to recommend. Arguable either way. Your call, flagged not changed.
- Did not add the UK Charity Commission source. Next one worth doing: the
  register has a free API, Perplexity cited it directly on uk-youth-3 on the
  27th, and `the-wave-project` currently sits at `unchecked` with no
  registration number at all.
- Did not expose `registry_status` through the MCP `search_nonprofits` tool.
  That is where an agent would actually use it, and it should follow once the
  first real check has populated the column.

## Known data issue found on the way

Some records carry two different EINs. `yescarolina` has `203562766` (from its
id) and `461710691` (in `registrations`). `MIN()` picks one deterministically so
the join is reproducible, but one of the two is wrong and the check will report
standing for whichever it picked. Worth a pass over records where the id-derived
EIN and the registrations EIN disagree.
