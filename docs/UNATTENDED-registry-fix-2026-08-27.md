# Unattended prompt: registry fix, phase 1

Paste everything below the line into the CLI agent. It stops before anything
writes a tax status to a live charity page.

## Why it stops there

Two different risk classes are bundled in this work.

**Reversible and cheap:** deploying the Worker. The new endpoints are read-only,
the changed ones are additive, `wrangler rollback` exists, and 43 tests pass.

**Not reversible in the way that matters:** the first D1 apply. It writes a
government tax status onto up to 35,000 charity pages, and those pages are read
by training crawlers roughly 10,000 times a month. Whatever a crawler ingests
may appear in a model answer months from now. Migration 024's own rule: calling
a live charity revoked is worse than saying nothing. An unattended agent cannot
judge whether a 4% revocation rate is the real IRS rate or a broken join, and
the honest answer is that I cannot either until I see the first run.

So phase 1 gets the learnings with zero write risk. Phase 2 is five minutes of
your attention once the numbers are on screen.

---

You are working in `~/TestVentures.net/giveready` on the GiveReady Cloudflare
Worker. The code changes are already applied to the working tree and verified.
Your job is to deploy them, run the read-only diagnostics, and write up what you
find. Do not improvise beyond these steps.

Context: the daily IRS registry check has run five mornings and matched zero
rows every time, because the endpoint it read never returned the EIN it needed.
It logged "no updates to apply" and looked healthy. The fix adds
`/api/registry/eins`, rewrites the join, and makes the zero case fail loudly.
Full background in `docs/DEPLOY-registry-fix-2026-08-27.md`.

**HARD STOP: do not run `wrangler d1 execute`. Do not run
`scripts/registry-check-daily.sh` (it applies to D1 at step 2). Do not commit or
push. Nothing in this task writes to the database or to git.**

Steps:

1. `git diff --stat` and read `docs/DEPLOY-registry-fix-2026-08-27.md`. Note in
   your report that `src/index.js` also carries pre-existing uncommitted work
   from the 024 session (registry status history on the nonprofit page) that has
   never been deployed and will go out with this.

2. `npm test`. Expect 43 pass, 0 fail. If anything fails, stop and report.

3. `npx wrangler deploy`.

4. Verify the endpoints, and report the actual output of each:
   ```
   curl -s 'https://www.giveready.org/api/registry/eins?limit=3' | jq
   curl -s 'https://www.giveready.org/api/nonprofits?page=1&limit=5' | jq -r '.nonprofits[0].id'
   curl -s 'https://www.giveready.org/api/nonprofits?page=9&limit=5' | jq -r '.nonprofits[0].id'
   curl -s 'https://www.giveready.org/api/nonprofits?country=United%20Kingdom&limit=1' | jq '.total'
   curl -s 'https://www.giveready.org/api/registry/revoked' | jq '.count'
   ```
   Pass conditions: the two `page` calls return DIFFERENT ids; the UK total is
   NOT 41227; `/api/registry/revoked` returns 0 (correct, nothing checked yet).
   If the two page ids are the same, the paging fix did not take. Stop and report.

5. `node scripts/audit-ein-sources.js`. This is read-only. It measures whether
   the EIN derived from `nonprofits.id` agrees with the real one in
   `registrations`, on the records that have both. Roughly 86% of the directory
   depends on that inference being sound. Report the agreement rate verbatim and
   the first few disagreements. Exit 3 means the inference is not safe to trust:
   report it, do not try to fix it.

6. `node scripts/check-irs-revocations.js --fetch --dry-run`. This downloads the
   IRS files and reports the join, writing no SQL. Report verbatim:
   - the join key count (expect roughly 35,000, NOT 0)
   - the `by source:` line
   - the full `=== RESULT ===` block with all four status counts and percentages

7. Sanity-check step 6 against the outside world. The IRS auto-revokes roughly
   28,000 organisations a year against a universe of about 1.8 million, so a
   plausible `revoked` share for a directory of established charities is low
   single-digit percent at most. If `revoked` comes back above 10%, say plainly
   that the number is not credible and that the join is more likely wrong than
   the charities are. Do not rationalise a large number.

8. Write your findings to
   `~/TestVentures.net/01-Projects/GiveReady/registry-checks/2026-08-27-dryrun.md`.
   Include the raw numbers, the agreement rate, your read on whether the result
   is credible, and anything that surprised you. UK English, no em-dashes, no
   bullet-point padding. If something looks wrong, say so directly rather than
   softening it.

9. Stop. Print a short summary and the single question you would want answered
   before the first real D1 write.

If any step fails, stop at that step and report what happened. Do not work
around a failure, do not retry with different flags, and do not disable a safety
check. Two of the checks in this code (`Pub 78` parse, zero join keys) exist
specifically to refuse rather than degrade, and an agent routing around them
would recreate the exact bug this work is fixing.
