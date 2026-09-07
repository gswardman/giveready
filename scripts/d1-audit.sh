#!/usr/bin/env bash
# d1-audit.sh — measure what actually costs rows_read, and prove which indexes exist.
#
# Written 2026-09-04 after the Workers Paid upgrade. On the free plan the question
# was "will we survive today". On paid it is "what is still scanning the whole
# table", which needs measurement rather than guesswork.
#
# Run from the Mac. Cowork cannot: api.cloudflare.com returns 403 from the sandbox.
#   cd ~/TestVentures.net/giveready && bash scripts/d1-audit.sh
#
# Every query below is READ-ONLY. Note that the audit itself costs reads, roughly
# 130k if the indexes are missing and under 1k if they are all present. That
# difference is itself the result.

set -uo pipefail
DB=giveready-db          # NOT "giveready". This name has bitten us twice.
W="npx wrangler d1 execute $DB --remote"

# Log everything. The interesting findings are in section 1 and section 4, which
# scroll off a terminal long before the run ends. Added 2026-09-04 after exactly
# that happened on the first run.
LOG="${HOME}/TestVentures.net/giveready/logs/d1-audit-$(date +%Y-%m-%d-%H%M).txt"
mkdir -p "$(dirname "$LOG")"
exec > >(tee "$LOG") 2>&1
echo "Audit log: $LOG"
echo "Run date:  $(date -u '+%Y-%m-%d %H:%M UTC')"

hr() { printf '\n%s\n' "────────────────────────────────────────────────────────"; }

plan() {  # plan "<label>" "<sql>"
  hr; echo "PLAN: $1"
  $W --command "EXPLAIN QUERY PLAN $2" 2>&1 | grep -iv '^$' | tail -n 12
}

cost() {  # cost "<label>" "<sql>"
  hr; echo "COST: $1"
  $W --json --command "$2" 2>/dev/null \
    | jq -r '.[0].meta | "rows_read=\(.rows_read)  rows_written=\(.rows_written)  duration=\(.duration)ms"' \
    || echo "  (json parse failed — run the command by hand)"
}

echo "=== 1. Which indexes actually exist on the live database? ==="
echo "The 2026-09-02 session found migrations 023 and 024 carried the WRONG database"
echo "name in their apply comments, so a 022-era apply may have silently never run."
$W --command \
  "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY tbl_name, name;"

echo
echo "Specifically looking for these four. Missing = the matching fix has not landed:"
echo "  idx_discovery_hits_created_ua_route   migration 023, admin traffic matrix"
echo "  idx_nonprofits_list_order             migration 025d, /api/nonprofits sort"
echo "  idx_nonprofits_verified               sitemap + live verified count"
echo "  idx_discovery_hits_created            time-window scans"

echo
echo "=== 2. Is the stats cache being maintained? ==="
$W --command \
  "SELECT key, value, updated_at FROM stats_cache ORDER BY key;"
echo "nonprofit_count with a stamp older than ~24h means the 03:17 UTC recount in"
echo "scheduled() is not running. At 48h handleStats reverts to a live COUNT(*)"
echo "over 41,227 rows on EVERY /api/stats call, which is the original bug."

echo
echo "=== 3. How big are the tables we scan? ==="
cost "nonprofits full count" \
  "SELECT COUNT(*) FROM nonprofits;"
cost "discovery_hits full count" \
  "SELECT COUNT(*) FROM discovery_hits;"
cost "discovery_hits older than 90 days (prune backlog)" \
  "SELECT COUNT(*) FROM discovery_hits WHERE created_at < datetime('now','-90 days');"

echo
echo "=== 4. The hot paths, in descending order of suspected cost ==="

plan "/api/nonprofits unfiltered list (the big one)" \
  "SELECT id, slug, name, verified FROM nonprofits ORDER BY verified DESC, beneficiaries_per_year DESC, id LIMIT 50 OFFSET 0;"
cost "/api/nonprofits unfiltered list" \
  "SELECT id, slug, name, verified FROM nonprofits ORDER BY verified DESC, beneficiaries_per_year DESC, id LIMIT 50 OFFSET 0;"
echo "  WANT: SCAN nonprofits USING INDEX idx_nonprofits_list_order, rows_read ~50."
echo "  BAD:  SCAN nonprofits + USE TEMP B-TREE FOR ORDER BY, rows_read ~41227."
echo "  Fix:  migrations/025d-optional-list-index.sql"

plan "admin traffic agent x route matrix, 720h" \
  "SELECT user_agent, route, COUNT(*) FROM discovery_hits WHERE created_at > datetime('now','-720 hours') AND user_agent IS NOT NULL GROUP BY user_agent, route;"
cost "admin traffic agent x route matrix, 720h" \
  "SELECT user_agent, route, COUNT(*) FROM discovery_hits WHERE created_at > datetime('now','-720 hours') AND user_agent IS NOT NULL GROUP BY user_agent, route;"
echo "  WANT: USING INDEX idx_discovery_hits_created_ua_route (covering, no table reads)."
echo "  The daily digest fires the 24h, 168h AND 720h windows every morning, several"
echo "  aggregates each. Uncovered, one digest run costs several hundred thousand rows."
echo "  Fix:  migrations/023-agent-route-index.sql"

plan "sitemap (verified only)" \
  "SELECT slug, updated_at FROM nonprofits WHERE verified = 1 ORDER BY slug ASC;"
cost "sitemap (verified only)" \
  "SELECT slug, updated_at FROM nonprofits WHERE verified = 1 ORDER BY slug ASC;"
echo "  WANT: ~177 rows via idx_nonprofits_verified. This one was already cheap;"
echo "  measuring it confirms the verified index is doing its job."

plan "nonprofit detail page by slug" \
  "SELECT * FROM nonprofits WHERE slug = 'waves-for-change';"
cost "nonprofit detail page by slug" \
  "SELECT * FROM nonprofits WHERE slug = 'waves-for-change';"
echo "  WANT: a handful of rows on the slug index. This is the highest-VOLUME route"
echo "  (nonprofits was 53.6% of agent hits in the 30d window), so it has to stay cheap."

hr
cat <<'EOF'
=== What to do with the output ===

Any plan showing a bare "SCAN <table>" without USING INDEX on a route that serves
public traffic is a real finding. Any rows_read in the tens of thousands on a
single request path is the same finding stated in money.

Order of fixes, cheapest and highest impact first:

  1. npx wrangler deploy
       Ships the scheduled() rewrite already sitting uncommitted in the tree:
       recount FIRST in its own try/catch, prune bounded to 2000 rows x 5 passes.
       The currently deployed Worker runs the prune first under a shared catch,
       which is why the recount has not run since 2026-09-02.

  2. npx wrangler d1 execute giveready-db --remote --file=migrations/023-agent-route-index.sql
       Only if step 1 of this audit shows the index missing. IF NOT EXISTS makes
       it safe to run either way.

  3. npx wrangler d1 execute giveready-db --remote --file=migrations/025c-prune.sql
       Re-run until it reports 0 rows written. Shrinks every future scan.

  4. npx wrangler d1 execute giveready-db --remote --file=migrations/025d-optional-list-index.sql
       Marked "optional" in the 2026-09-02 runbook because the priority that day
       was surviving the quota. Now that the ceiling is gone and the goal is
       cutting the count, this is the largest remaining single win. Promote it.

  5. Re-run this audit and diff the rows_read numbers.

Do NOT "fix" anything by recounting hourly. 24 x 41,227 is 989k rows/day spent
maintaining a cache, which is worse than the bug it replaces.
EOF
