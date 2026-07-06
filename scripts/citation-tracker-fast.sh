#!/usr/bin/env bash
# citation-tracker-fast.sh — parallel-fetch variant of citation-tracker.sh.
#
# Identical output format and exit codes to citation-tracker.sh, but fires all
# 10 Perplexity Sonar calls concurrently instead of sequentially. This keeps the
# whole run under ~15s wall time so it completes inside a single 45s agent bash
# call. It exists so the cloud daily-digest task can SELF-HEAL: if the launchd
# job on the Mac did not fire (machine asleep at the trigger minute), the digest
# run can invoke this and still get the day's reading.
#
# Provenance: added 2026-06-23 after the launchd job silently missed two of five
# days (Mac asleep at the 04:55 UTC trigger; see 00-Dashboard/giveready-daily.md
# and Learnings-Log). The sequential original is retained for the launchd path.
#
# Exit codes (match the original):
#   0 — ran, no NEW citation vs the most recent prior file
#   1 — failed pre-flight (missing key/prompts/deps, bad API health)
#   2 — ran AND at least one prompt cites giveready.org for the first time

set -uo pipefail

# ── Config (env-overridable, mirrors citation-tracker.sh) ────────────────────
VAULT="${VAULT:-$HOME/TestVentures.net}"
SECRETS="$VAULT/.secrets/giveready.env"
PROMPTS="${PROMPTS:-$VAULT/giveready/scripts/citation-prompts.tsv}"
OUT_DIR="$VAULT/01-Projects/GiveReady/citation-tracking"
API_URL="https://api.perplexity.ai/chat/completions"
MODEL="sonar"
TODAY="$(date +%F)"
NOW="$(date '+%H:%M %Z')"
OUT="${OUT:-$OUT_DIR/$TODAY.md}"
HEALTH_NOTE="${HEALTH_NOTE:-}"   # appended to the health line, e.g. self-heal provenance

# ── Sanity ───────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
need curl; need jq; need awk; need sed
[ -f "$PROMPTS" ] || { echo "Missing prompts file: $PROMPTS" >&2; exit 1; }
[ -f "$SECRETS" ] || { echo "Missing secrets file: $SECRETS" >&2; exit 1; }
# shellcheck disable=SC1090
. "$SECRETS"
[ -n "${PERPLEXITY_API_KEY:-}" ] || { echo "PERPLEXITY_API_KEY not set in $SECRETS" >&2; exit 1; }
mkdir -p "$OUT_DIR"

# ── Pre-flight health check (single ping; 3 quick retries) ───────────────────
HEALTH="unknown"; PING_CODE="000"; PING_ERR=""
for attempt in 1 2 3; do
  PING_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" -H "Content-Type: application/json" \
    -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"ok"}]}' --max-time 20)
  [ "$PING_CODE" = "200" ] && break
  PING_ERR="curl_rc=$? http=$PING_CODE"
  echo "Health-check attempt $attempt/3 failed ($PING_ERR), retrying..." >&2
  [ "$attempt" -lt 3 ] && sleep $((attempt * 5))
done
if [ "$PING_CODE" != "200" ]; then
  HEALTH="FAILED (HTTP $PING_CODE on health-check after 3 attempts; last $PING_ERR)"
  cat > "$OUT" <<EOF
# Citation Tracker — $TODAY

_Run at $NOW. Tracker health: $HEALTH.${HEALTH_NOTE:+ $HEALTH_NOTE}_

Tracker failed pre-flight health check. No data collected.
Last curl diagnostic: $PING_ERR
EOF
  echo "Tracker health FAILED: $PING_ERR" >&2
  exit 1
fi
HEALTH="OK${HEALTH_NOTE:+ ($HEALTH_NOTE)}"

# ── Parallel fetch ───────────────────────────────────────────────────────────
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
  BODY=$(jq -nc --arg m "$MODEL" --arg p "$PROMPT" '{model:$m,messages:[{role:"user",content:$p}]}')
  curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" -H "Content-Type: application/json" \
    -d "$BODY" --max-time 40 > "$WORK/$ID.json" &
done < "$PROMPTS"
wait

# ── Parse ────────────────────────────────────────────────────────────────────
dom() { awk -F/ 'NF>2{print $3}' | sed 's/^www\.//' | awk 'NF && !seen[$0]++ { out=out sep $0; sep="; " } END{print out}'; }
TMP="$WORK/tmp"; DIAG="$WORK/diag"; : > "$TMP"; : > "$DIAG"
CITED_IDS=""; TOTAL=0; CITED_COUNT=0; CITED_DIAG=0; RNC_DIAG=0; NR_DIAG=0
while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
  TOTAL=$((TOTAL+1))
  RESP=$(cat "$WORK/$ID.json" 2>/dev/null)
  CITATIONS=$(echo "$RESP" | jq -r '.citations[]?' 2>/dev/null)
  CITED_URL=$(echo "$CITATIONS" | grep -i 'giveready\.org' | head -1)
  if [ -n "$CITED_URL" ]; then
    CITED="y"; URL_FOUND="$CITED_URL"; CITED_COUNT=$((CITED_COUNT+1)); CITED_IDS="$CITED_IDS $ID"
  else CITED="n"; URL_FOUND="—"; fi
  NOTES=$(echo "$CITATIONS" | grep -iv 'giveready\.org' | awk -F/ 'NF>2{print $3}' | head -2 | paste -sd '; ' -)
  [ -z "$NOTES" ] && NOTES="—"
  printf '| %s | perplexity | %s | %s | %s | %s |\n' "$TODAY" "$ID" "$CITED" "$URL_FOUND" "$NOTES" >> "$TMP"
  SEARCH_URLS=$(echo "$RESP" | jq -r '.search_results[]?.url' 2>/dev/null)
  if [ "$CITED" = "y" ]; then GR="cited"; CITED_DIAG=$((CITED_DIAG+1))
  elif echo "$SEARCH_URLS" | grep -qi 'giveready\.org'; then GR="retrieved-not-cited"; RNC_DIAG=$((RNC_DIAG+1))
  else GR="not-retrieved"; NR_DIAG=$((NR_DIAG+1)); fi
  CD=$(echo "$CITATIONS" | dom); [ -z "$CD" ] && CD="—"
  SD=$(echo "$SEARCH_URLS" | dom); [ -z "$SD" ] && SD="—"
  printf '| %s | %s | %s | %s |\n' "$ID" "$GR" "$CD" "$SD" >> "$DIAG"
done < "$PROMPTS"

# manual stubs for claude + chatgpt
while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
  for M in claude chatgpt; do
    printf '| %s | %s | %s |  |  | manual — to be filled |\n' "$TODAY" "$M" "$ID" >> "$TMP"
  done
done < "$PROMPTS"

COMBINED_PCT=$(awk "BEGIN{printf \"%.1f\",($CITED_COUNT/30)*100}")

# newly-cited detection vs most recent prior file
NEWLY_CITED=""
PRIOR_FILE=$(ls -1 "$OUT_DIR"/*.md 2>/dev/null | grep -v "/$TODAY.md$" | sort -r | head -1)
if [ -n "$CITED_IDS" ]; then
  for ID in $CITED_IDS; do
    if [ -n "$PRIOR_FILE" ] && [ -f "$PRIOR_FILE" ]; then
      if ! grep -E "^\| [0-9-]+ \| [a-z]+ \| ${ID} \| y " "$PRIOR_FILE" >/dev/null 2>&1; then
        NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt vs $(basename "$PRIOR_FILE" .md))\n"
      fi
    else
      NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt; first tracker run)\n"
    fi
  done
fi

# ── Write final output ───────────────────────────────────────────────────────
# In-place truncate-write (not mv) so this works both on the Mac and in the cloud
# sandbox, where the vault is a mounted FS that permits create/write but not
# unlink (so an atomic temp+mv across devices fails). The parallel fetch has
# already completed before this block, so the write itself is fast.
{
  echo "# Citation Tracker — $TODAY"
  echo ""
  echo "_Run at $NOW. Tracker health: $HEALTH._"
  echo ""
  echo "## Summary"
  echo ""
  echo "- Perplexity: $CITED_COUNT/10 prompts cite giveready.org (automated)"
  echo "- Claude: pending manual check"
  echo "- ChatGPT: pending manual check"
  echo "- Combined citation share: $CITED_COUNT/30 ($COMBINED_PCT%)"
  echo "- Source-set diagnostics (Perplexity, of 10): $CITED_DIAG cited / $RNC_DIAG retrieved-not-cited / $NR_DIAG not-retrieved"
  echo "- Retrieval share (Perplexity, daily driver): $((CITED_DIAG + RNC_DIAG))/10 prompts surface giveready.org in the source set (cited + retrieved-not-cited)"
  echo ""
  echo "## Per-prompt results"
  echo ""
  echo "| date | model | prompt_id | cited | url_found | notes |"
  echo "|---|---|---|---|---|---|"
  cat "$TMP"
  echo ""
  echo "## Newly-cited (first time on this prompt across history)"
  echo ""
  if [ -z "$NEWLY_CITED" ]; then echo "(none today)"; else printf "%b" "$NEWLY_CITED"; fi
  echo ""
  echo "## Source-set diagnostics (Perplexity)"
  echo ""
  echo "Where giveready.org sits in each prompt's full raw source set. \`cited\` = won the citation; \`retrieved-not-cited\` = in Perplexity's retrieved set but not cited (we are in the running, losing the cite); \`not-retrieved\` = absent from the source set entirely (a discoverability/indexing gap, not a citation-format problem)."
  echo ""
  echo "- cited: $CITED_DIAG/10"
  echo "- retrieved-not-cited: $RNC_DIAG/10"
  echo "- not-retrieved: $NR_DIAG/10"
  echo ""
  echo "| prompt_id | giveready_status | citation_domains | search_result_domains |"
  echo "|---|---|---|---|"
  cat "$DIAG"
} > "$OUT"
echo "Wrote $OUT  ($CITED_COUNT/10 perplexity citations)"

[ -n "$NEWLY_CITED" ] && exit 2
exit 0
