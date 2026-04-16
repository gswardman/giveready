#!/usr/bin/env bash
set -euo pipefail

# build-digest.sh — generate the GiveReady Daily Digest.
#
# Runs every morning from _cron/giveready_daily.sh (launchd).
# Queries the live site via jq-parseable JSON endpoints and writes the
# human-readable digest to 00-Dashboard/giveready-daily.md in the vault.
#
# Overwrites the file every morning. History lives in git (the vault is
# an Obsidian folder, not a git repo per se, but Geordie commits manually).
#
# Exit codes:
#   0 — digest written, no new signal to halt on
#   2 — digest written AND at least one first-seen-this-period named
#       crawler appeared. The _cron wrapper reads this and surfaces the
#       halt to the user via macOS notification.

VAULT="${VAULT:-$HOME/TestVentures.net}"
SITE="${SITE:-https://giveready.org}"
ADMIN_TOKEN="${GIVEREADY_ADMIN_TOKEN:-}"
OUT="$VAULT/00-Dashboard/giveready-daily.md"
TMP="$(mktemp)"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; exit 1; }; }
need curl
need jq

fetch() {
  # fetch <path> — returns JSON body or {} on HTTP error
  local path="$1"
  local full="${SITE}${path}"
  local body
  body=$(curl -fsS --max-time 20 "$full" 2>/dev/null || echo '{}')
  # Guard against HTML responses (wrong content-type) — keep it JSON-safe.
  if echo "$body" | jq -e . >/dev/null 2>&1; then
    echo "$body"
  else
    echo '{}'
  fi
}

fetch_admin() {
  local path="$1"
  if [ -z "$ADMIN_TOKEN" ]; then
    echo '{}'
    return
  fi
  local sep="?"
  case "$path" in *\?*) sep="&" ;; esac
  local full="${SITE}${path}${sep}token=${ADMIN_TOKEN}"
  curl -fsS --max-time 20 "$full" 2>/dev/null || echo '{}'
}

STATS=$(fetch "/api/stats")
ENRICH=$(fetch "/api/enrichments/stats")
LEADER=$(fetch "/api/agents/leaderboard")
FUNNEL24=$(fetch "/api/agents/funnel?hours=24")
FIRSTSEEN24=$(fetch "/api/agents/named-first-seen?hours=24")
TRAFFIC24=$(fetch_admin "/api/admin/traffic?hours=24")
TRAFFIC7D=$(fetch_admin "/api/admin/traffic?hours=168")

TODAY=$(date '+%Y-%m-%d')
GEN_AT=$(date '+%H:%M %Z')

# ── extract fields ──
NP_TOTAL=$(echo "$STATS" | jq -r '.nonprofits // .total // "?"')
NP_VERIFIED=$(echo "$STATS" | jq -r '.verified // "?"')
CAUSES=$(echo "$STATS" | jq -r '.causes // "?"')
COUNTRIES=$(echo "$STATS" | jq -r '.countries // "?"')

EN_APPLIED=$(echo "$ENRICH" | jq -r '[.by_status[]? | select(.status=="applied") | .count] | add // 0')
EN_TOTAL=$(echo "$ENRICH" | jq -r '.total_enrichments // 0')
EN_AGENTS=$(echo "$ENRICH" | jq -r '.unique_agents // 0')

TOP_AGENTS=$(echo "$LEADER" | jq -r '
  .top_agents // [] | .[0:3] |
  map("  - \(.agent_name) — \(.applied) applied, \(.submissions) submitted") | .[]' 2>/dev/null || echo "  - (no agents)")

RECENT_ACT=$(echo "$LEADER" | jq -r '
  .recent_activity // [] | .[0:3] |
  map("  - \(.agent_name) → \(.nonprofit_slug)/\(.field) (\(.status), at \(.created_at))") | .[]' 2>/dev/null || echo "  - (no recent activity)")

DH_24=$(echo "$TRAFFIC24" | jq -r '.summary.discovery_hits_in_period // "?"')
DH_7D=$(echo "$TRAFFIC7D" | jq -r '.summary.discovery_hits_in_period // "?"')
TOP_ROUTE=$(echo "$TRAFFIC24" | jq -r '.discovery_by_route[0] | "\(.route) — \(.hits) hits"' 2>/dev/null || echo "(none)")
TOP_UA=$(echo "$TRAFFIC24" | jq -r '.discovery_by_user_agent[0] | "\(.user_agent) — \(.hits) hits"' 2>/dev/null || echo "(none)")

READ_AND_LEFT=$(echo "$FUNNEL24" | jq -r '
  .read_and_left // [] |
  map("  - \(.user_agent) hit \(.route) \(.hits)x, last \(.last_hit) — no submission") | .[]' 2>/dev/null || echo "  - (none)")
READ_LEFT_COUNT=$(echo "$FUNNEL24" | jq -r '(.read_and_left // []) | length')

FIRST_SEEN_COUNT=$(echo "$FIRSTSEEN24" | jq -r '(.first_time_named_crawlers // []) | length')
FIRST_SEEN_LINES=$(echo "$FIRSTSEEN24" | jq -r '
  .first_time_named_crawlers // [] |
  map("  - \(.user_agent) — \(.hits_in_window) hits, first lifetime \(.first_seen_lifetime)") | .[]' 2>/dev/null || echo "  - (none new)")

# ── headline logic ──
if [ "$FIRST_SEEN_COUNT" -gt 0 ]; then
  HEADLINE="New named crawler appeared — $FIRST_SEEN_COUNT first-time agent(s) visited today. Review the funnel below."
elif [ "$READ_LEFT_COUNT" -gt 0 ]; then
  HEADLINE="Named crawlers visited but did not submit. $READ_LEFT_COUNT read-and-left in last 24h."
elif [ "$EN_TOTAL" = "0" ]; then
  HEADLINE="Cold start — no enrichments yet."
else
  HEADLINE="Steady state — no first-time named crawlers, flywheel activity unchanged."
fi

# ── write the digest ──
cat > "$TMP" <<EOF
# GiveReady Daily Digest — $TODAY

_Generated $GEN_AT. Overwrites every morning. For history, see git log of this file._

## Headline

$HEADLINE

## Directory

- Nonprofits: $NP_TOTAL ($NP_VERIFIED verified)
- Causes: $CAUSES across $COUNTRIES countries

## Agent Flywheel

- Applied enrichments: $EN_APPLIED
- Total submissions: $EN_TOTAL
- Unique agents: $EN_AGENTS
- Top 3 agents by applied:
$TOP_AGENTS
- Most recent activity:
$RECENT_ACT

## Traffic (last 24h vs last 7d)

- Discovery hits: 24h $DH_24, 7d $DH_7D
- Top route (24h): \`$TOP_ROUTE\`
- Top user-agent (24h): $TOP_UA

## Named Crawlers — First Seen Today ($FIRST_SEEN_COUNT)

$FIRST_SEEN_LINES

## Read and Left — Named Crawlers That Did Not Submit ($READ_LEFT_COUNT)

$READ_AND_LEFT

## Next Step

EOF

# Next-step auto-suggestion based on what the data showed.
if [ "$FIRST_SEEN_COUNT" -gt 0 ]; then
  cat >> "$TMP" <<'EOF'
A new named crawler landed today. Check the digest's first-seen list and decide
whether to post on X / LinkedIn about it, or tune the CTA copy. Script halts
here so you can write the decision.
EOF
elif [ "$READ_LEFT_COUNT" -gt 3 ]; then
  cat >> "$TMP" <<'EOF'
Multiple named crawlers visited today without submitting. Consider A/B testing
the agents.md CTA — change the default field from "website" to a prose field,
or shorten the pre-submit rules section.
EOF
elif [ "$EN_TOTAL" = "0" ]; then
  cat >> "$TMP" <<'EOF'
No enrichments have landed yet. Promote the MCP server in more directories
(Smithery needs HTTP transport) and consider manual seed submissions.
EOF
else
  cat >> "$TMP" <<'EOF'
Quiet day. Keep the bounty rotation running and check tomorrow.
EOF
fi

mkdir -p "$VAULT/00-Dashboard"
mv "$TMP" "$OUT"

echo "Wrote $OUT"

# Exit code 2 signals the wrapper that a new named crawler appeared.
if [ "$FIRST_SEEN_COUNT" -gt 0 ]; then
  exit 2
fi
exit 0
