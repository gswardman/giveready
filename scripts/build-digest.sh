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

# Funnel conversion: per-UA aggregated hits vs submissions. The funnel endpoint
# returns rows grouped by (user_agent, route); aggregate to UA-level here so the
# digest shows which named crawlers read-and-wrote vs read-and-left, with the
# total hit volume per UA. See 2026-05-06 learning-loop H1.
FUNNEL_LEFT_AGENTS=$(echo "$FUNNEL24" | jq -r '
  (.read_and_left // []) |
  group_by(.user_agent) |
  map({ua: .[0].user_agent, hits: (map(.hits) | add)}) |
  sort_by(-.hits) | .[0:5] |
  map("  - \(.ua) — \(.hits) hits, 0 submissions") | .[]' 2>/dev/null || echo "  - (none)")
FUNNEL_LEFT_AGENTS_COUNT=$(echo "$FUNNEL24" | jq -r '(.read_and_left // []) | group_by(.user_agent) | length' 2>/dev/null || echo 0)
FUNNEL_SUBMITTED_AGENTS=$(echo "$FUNNEL24" | jq -r '
  (.read_and_submitted // []) |
  group_by(.user_agent) |
  map({ua: .[0].user_agent, hits: (map(.hits) | add)}) |
  sort_by(-.hits) | .[0:5] |
  map("  - \(.ua) — \(.hits) hits, submitted in window") | .[]' 2>/dev/null || echo "  - (none)")
FUNNEL_SUBMITTED_COUNT=$(echo "$FUNNEL24" | jq -r '(.read_and_submitted // []) | group_by(.user_agent) | length' 2>/dev/null || echo 0)

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

## Funnel Conversion (named crawlers, last 24h)

- Read-and-submitted: $FUNNEL_SUBMITTED_COUNT distinct UA(s)
$FUNNEL_SUBMITTED_AGENTS
- Read-and-left: $FUNNEL_LEFT_AGENTS_COUNT distinct UA(s)
$FUNNEL_LEFT_AGENTS

## Read and Left — Named Crawlers That Did Not Submit ($READ_LEFT_COUNT)

$READ_AND_LEFT

## Learning Loop

EOF

# Learning Loop section: cron writes the scaffold, the daily Claude scheduled
# task overwrites this section with hand-curated hypotheses grounded in today's
# data. The shell cannot generate real hypotheses (that requires synthesising
# numbers into testable claims), but it can do three honest things:
#   1. Extract yesterday's #1 hypothesis title for the carryover line.
#   2. Pick the dominant cron-detectable signal and frame it as one hypothesis.
#   3. Label the section so it is clear the richer pass replaces this content.
# See 2026-05-06 learning-loop H1 follow-up.

# Carryover: pull yesterday's first hypothesis title from the existing file
# (which we have not overwritten yet — $OUT still holds yesterday's content).
CARRYOVER_LINE='> Carryover — first run, no prior hypothesis to check.'
if [ -f "$OUT" ]; then
  YESTERDAY_H1=$(grep -m1 -E '^[[:space:]]*1\. \*\*' "$OUT" 2>/dev/null | sed -E 's/^[[:space:]]*1\. \*\*([^*]+)\*\*.*/\1/' || echo "")
  if [ -n "$YESTERDAY_H1" ]; then
    CARRYOVER_LINE="> Carryover — \"$YESTERDAY_H1\": auto-detected by cron, awaiting Claude evaluation pass."
  else
    # Yesterday's file existed but was in pre-Learning-Loop format (no numbered hypothesis).
    CARRYOVER_LINE='> Carryover — yesterday in legacy "Next Step" format, no structured hypothesis to check.'
  fi
fi

echo "$CARRYOVER_LINE" >> "$TMP"
cat >> "$TMP" <<'EOF'

_Auto-generated scaffold based on cron-detectable signal only. The daily Claude scheduled task replaces this section with hand-curated hypotheses grounded in today's funnel and traffic numbers._

EOF

# One auto-hypothesis from the dominant signal, ranked by which condition
# matches first. Each branch ends in the same hypothesis shape (Signal / Test /
# Impact-Effort / Gates) so Claude's overwrite has a stable template to extend.
if [ "$FIRST_SEEN_COUNT" -gt 0 ]; then
  cat >> "$TMP" <<EOF
1. **New named crawler appeared today (${FIRST_SEEN_COUNT})** — Signal: see Named Crawlers — First Seen Today section above. Test: post on X / LinkedIn naming the crawler to surface GiveReady to its operator, or tune the /AGENTS.md CTA to name-check it. Impact/Effort: M/L. Gates: none.
EOF
elif [ "$READ_LEFT_COUNT" -gt 3 ] && [ "$FUNNEL_SUBMITTED_COUNT" = "0" ]; then
  cat >> "$TMP" <<EOF
1. **Named crawlers read but never submit (${READ_LEFT_COUNT} read-and-left, 0 submitted)** — Signal: see Funnel Conversion section above. Test: review the first 200 chars of /AGENTS.md for action clarity, or A/B the default field in the example curl. Impact/Effort: H/L. Gates: none.
EOF
elif [ "$EN_TOTAL" = "0" ]; then
  cat >> "$TMP" <<'EOF'
1. **Cold start — no submissions lifetime** — Signal: total_enrichments = 0. Test: promote the MCP server in more directories (Smithery needs HTTP transport), seed manual submissions, or contact a known agent operator directly. Impact/Effort: H/M. Gates: none.
EOF
else
  cat >> "$TMP" <<'EOF'
1. **Quiet day — no new cron-detectable signal** — Signal: no first-seen crawlers, read-and-left within normal bounds, no zero-state alarm. Test: continue the current bounty rotation, check tomorrow. Impact/Effort: L/L. Gates: none.
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
