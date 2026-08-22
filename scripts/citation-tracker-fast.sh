#!/usr/bin/env bash
# citation-tracker-fast.sh — bounded-concurrency Perplexity citation tracker.
#
# Fires the 10 Sonar prompts with a small concurrency cap, VALIDATES every
# response before scoring it, retries the invalid ones sequentially, and refuses
# to emit a score built on missing data.
#
# Provenance:
#   2026-06-23  Added as the parallel-fetch variant so the cloud daily-digest
#               task could self-heal when the Mac launchd job missed a day.
#   2026-07-07  Became the single writer of the daily reading.
#   2026-08-12  Found silently dropping responses: 6 of 10 came back empty and
#               were scored `n` / `not-retrieved` with an empty domain set.
#               Raw run wrote 3/10; sequential re-run of those 6 scored 6/6.
#   2026-08-13  All 10 came back empty and the script still exited 0 with a
#               scored 0/10. Root cause of the scoring bug: absence of data was
#               indistinguishable from absence of a citation. THIS REWRITE.
#
# The rule this script now enforces:
#   A prompt with no valid response is `no-data`. It is excluded from the
#   denominator, never scored `n`, and if enough of them pile up the whole run
#   is marked FAILED so downstream consumers treat the day as a gap.
#
# Exit codes:
#   0 — ran, all prompts valid, no NEW citation vs the most recent prior file
#   1 — failed: pre-flight, or more than MAX_NO_DATA prompts returned no data
#   2 — ran AND at least one prompt cites giveready.org for the first time
#   3 — ran DEGRADED: some no-data prompts, but at or under MAX_NO_DATA

set -uo pipefail

# ── Config (env-overridable) ────────────────────────────────────────────────
VAULT="${VAULT:-$HOME/TestVentures.net}"
SECRETS="$VAULT/.secrets/giveready.env"
PROMPTS="${PROMPTS:-$VAULT/giveready/scripts/citation-prompts.tsv}"
OUT_DIR="${OUT_DIR:-$VAULT/01-Projects/GiveReady/citation-tracking}"
API_URL="${API_URL:-https://api.perplexity.ai/chat/completions}"
MODEL="${MODEL:-sonar}"
TODAY="$(date +%F)"
NOW="$(date '+%H:%M %Z')"
OUT="${OUT:-$OUT_DIR/$TODAY.md}"
HEALTH_NOTE="${HEALTH_NOTE:-}"

CONCURRENCY="${CONCURRENCY:-3}"    # simultaneous in-flight requests
REQ_TIMEOUT="${REQ_TIMEOUT:-45}"   # per-request curl timeout limit, seconds
RETRIES="${RETRIES:-2}"            # sequential retry passes over invalid IDs
RETRY_GAP="${RETRY_GAP:-4}"        # seconds between sequential retries
MAX_NO_DATA="${MAX_NO_DATA:-}"     # above this, the whole run is FAILED.
                                   # Default is proportional: 20% of the prompt
                                   # set, floor 1. The WEF wrapper runs 4 prompts
                                   # through this same engine, so a fixed 2 would
                                   # let half its set go missing and still score.
FIXTURE_DIR="${FIXTURE_DIR:-}"     # test hook: score these files, skip the API

# ── Sanity ──────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
need curl; need jq; need awk; need sed
[ -f "$PROMPTS" ] || { echo "Missing prompts file: $PROMPTS" >&2; exit 1; }
mkdir -p "$OUT_DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Response validation ─────────────────────────────────────────────────────
# valid   = HTTP 200, parseable JSON, and an assistant message with content.
# A valid response with an empty source set is a real answer with no sources,
# which is a finding. An unparseable or empty file is missing data, which is not.
is_valid() {
  # Declared on separate lines on purpose. `local id="$1" body="$WORK/$id.json"`
  # expands $id before the assignment lands, which under `set -u` aborts the whole
  # script with "id: unbound variable" the first time this is called.
  local id="$1"
  local body="$WORK/$id.json"
  local code
  code="$(cat "$WORK/$id.code" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] || return 1
  [ -s "$body" ] || return 1
  jq -e '.choices[0].message.content | type == "string" and length > 0' "$body" >/dev/null 2>&1
}

fetch_one() {
  local id="$1" prompt="$2" body
  body=$(jq -nc --arg m "$MODEL" --arg p "$prompt" \
    '{model:$m,messages:[{role:"user",content:$p}]}')
  curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" --max-time "$REQ_TIMEOUT" \
    -o "$WORK/$id.json" -w '%{http_code}' > "$WORK/$id.code" 2>/dev/null
}

# ── Fetch, unless we are scoring fixtures ───────────────────────────────────
PREFLIGHT=""
if [ -n "$FIXTURE_DIR" ]; then
  cp "$FIXTURE_DIR"/*.json "$WORK"/ 2>/dev/null
  for f in "$WORK"/*.json; do [ -e "$f" ] || continue
    id="$(basename "$f" .json)"
    [ -f "$WORK/$id.code" ] || echo 200 > "$WORK/$id.code"
  done
  PREFLIGHT="fixtures from $FIXTURE_DIR"
else
  [ -f "$SECRETS" ] || { echo "Missing secrets file: $SECRETS" >&2; exit 1; }
  # shellcheck disable=SC1090
  . "$SECRETS"
  [ -n "${PERPLEXITY_API_KEY:-}" ] || { echo "PERPLEXITY_API_KEY not set" >&2; exit 1; }

  # Pre-flight distinguishes "API rejects us" from "API hangs on us". A bad key
  # returns 401 in under a second; a throttled good key hangs until curl gives up.
  # Both are fatal, but they need different fixes, so name which one it was.
  PF_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$API_URL" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" -H "Content-Type: application/json" \
    -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"ok"}]}')
  case "$PF_CODE" in
    200) PREFLIGHT="pre-flight OK" ;;
    401|403) PREFLIGHT="pre-flight REJECTED (HTTP $PF_CODE, key invalid or revoked)" ;;
    429)     PREFLIGHT="pre-flight RATE-LIMITED (HTTP 429)" ;;
    000)     PREFLIGHT="pre-flight TIMED OUT (no HTTP response in 25s; account throttle or quota, not a network block, if a bad key still returns 401 instantly)" ;;
    *)       PREFLIGHT="pre-flight HTTP $PF_CODE" ;;
  esac
  if [ "$PF_CODE" != "200" ]; then
    {
      echo "# Citation Tracker — $TODAY"
      echo ""
      echo "_Run at $NOW. Tracker health: FAILED. $PREFLIGHT.${HEALTH_NOTE:+ $HEALTH_NOTE}_"
      echo ""
      echo "No data collected. Treat today as a gap, not as 0/10."
    } > "$OUT"
    echo "Tracker health FAILED: $PREFLIGHT" >&2
    exit 1
  fi

  # Bounded-concurrency first pass.
  INFLIGHT=0
  while IFS=$'\t' read -r ID BUCKET PROMPT; do
    [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
    fetch_one "$ID" "$PROMPT" &
    INFLIGHT=$((INFLIGHT+1))
    if [ "$INFLIGHT" -ge "$CONCURRENCY" ]; then wait -n 2>/dev/null || wait; INFLIGHT=$((INFLIGHT-1)); fi
  done < "$PROMPTS"
  wait

  # Sequential retry passes over anything that did not come back clean.
  for pass in $(seq 1 "$RETRIES"); do
    RETRY_IDS=""
    while IFS=$'\t' read -r ID BUCKET PROMPT; do
      [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
      is_valid "$ID" || RETRY_IDS="$RETRY_IDS $ID"
    done < "$PROMPTS"
    [ -z "$RETRY_IDS" ] && break
    echo "Retry pass $pass for:$RETRY_IDS" >&2
    for ID in $RETRY_IDS; do
      PROMPT=$(awk -F'\t' -v id="$ID" '$1==id{print $3}' "$PROMPTS")
      fetch_one "$ID" "$PROMPT"
      sleep "$RETRY_GAP"
    done
  done
fi

# ── Score ───────────────────────────────────────────────────────────────────
dom() { awk -F/ 'NF>2{print $3}' | sed 's/^www\.//' | awk 'NF && !seen[$0]++ { out=out sep $0; sep="; " } END{print out}'; }
TMP="$WORK/tmp"; DIAG="$WORK/diag"; : > "$TMP"; : > "$DIAG"
CITED_IDS=""; NODATA_IDS=""
TOTAL=0; VALID=0; NODATA=0; CITED_COUNT=0; CITED_DIAG=0; RNC_DIAG=0; NR_DIAG=0
SCHEMA_WARN=0

while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
  TOTAL=$((TOTAL+1))

  if ! is_valid "$ID"; then
    NODATA=$((NODATA+1)); NODATA_IDS="$NODATA_IDS $ID"
    CODE="$(cat "$WORK/$ID.code" 2>/dev/null || echo 000)"
    printf '| %s | perplexity | %s | no-data | — | no valid response (HTTP %s) |\n' \
      "$TODAY" "$ID" "$CODE" >> "$TMP"
    printf '| %s | no-data | — | — |\n' "$ID" >> "$DIAG"
    continue
  fi

  VALID=$((VALID+1))
  RESP=$(cat "$WORK/$ID.json")

  # `.citations` is the scoring field. If the key vanishes on an otherwise valid
  # response, that is an upstream schema change, not a zero. Flag it loudly.
  jq -e 'has("citations")' <<<"$RESP" >/dev/null 2>&1 || SCHEMA_WARN=$((SCHEMA_WARN+1))

  CITATIONS=$(jq -r '.citations[]?' <<<"$RESP" 2>/dev/null)
  SEARCH_URLS=$(jq -r '.search_results[]?.url' <<<"$RESP" 2>/dev/null)
  CITED_URL=$(grep -i 'giveready\.org' <<<"$CITATIONS" | head -1)

  if [ -n "$CITED_URL" ]; then
    CITED="y"; URL_FOUND="$CITED_URL"
    CITED_COUNT=$((CITED_COUNT+1)); CITED_IDS="$CITED_IDS $ID"
    GR="cited"; CITED_DIAG=$((CITED_DIAG+1))
  else
    CITED="n"; URL_FOUND="—"
    if grep -qi 'giveready\.org' <<<"$SEARCH_URLS"; then
      GR="retrieved-not-cited"; RNC_DIAG=$((RNC_DIAG+1))
    else
      GR="not-retrieved"; NR_DIAG=$((NR_DIAG+1))
    fi
  fi

  NOTES=$(grep -iv 'giveready\.org' <<<"$CITATIONS" | awk -F/ 'NF>2{print $3}' | head -2 | paste -sd '; ' -)
  [ -z "$NOTES" ] && NOTES="—"
  printf '| %s | perplexity | %s | %s | %s | %s |\n' "$TODAY" "$ID" "$CITED" "$URL_FOUND" "$NOTES" >> "$TMP"

  CD=$(dom <<<"$CITATIONS"); [ -z "$CD" ] && CD="—"
  SD=$(dom <<<"$SEARCH_URLS"); [ -z "$SD" ] && SD="—"
  printf '| %s | %s | %s | %s |\n' "$ID" "$GR" "$CD" "$SD" >> "$DIAG"
done < "$PROMPTS"

# manual stubs for claude + chatgpt
while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
  for M in claude chatgpt; do
    printf '| %s | %s | %s |  |  | manual — to be filled |\n' "$TODAY" "$M" "$ID" >> "$TMP"
  done
done < "$PROMPTS"

# ── Health verdict ──────────────────────────────────────────────────────────
if [ -z "$MAX_NO_DATA" ]; then
  MAX_NO_DATA=$((TOTAL / 5))
  [ "$MAX_NO_DATA" -lt 1 ] && MAX_NO_DATA=1
fi
if [ "$NODATA" -gt "$MAX_NO_DATA" ]; then
  HEALTH="FAILED"
  VERDICT="$NODATA of $TOTAL prompts returned no valid response (limit $MAX_NO_DATA). Treat today as a gap, not as $CITED_COUNT/$TOTAL."
  EXIT_CODE=1
elif [ "$NODATA" -gt 0 ]; then
  HEALTH="DEGRADED"
  VERDICT="$NODATA of $TOTAL prompts returned no valid response. Score is over the $VALID valid prompts only."
  EXIT_CODE=3
else
  HEALTH="OK"
  VERDICT=""
  EXIT_CODE=0
fi
if [ "$SCHEMA_WARN" -gt 0 ]; then
  VERDICT="$VERDICT SCHEMA WARNING: $SCHEMA_WARN valid responses had no \`citations\` key; scoring may be structurally wrong."
  # Every valid response missing the scoring field is not a zero, it is an
  # upstream schema change producing a structural zero. Fail rather than log it.
  if [ "$VALID" -gt 0 ] && [ "$SCHEMA_WARN" -eq "$VALID" ]; then
    HEALTH="FAILED"; EXIT_CODE=1
    VERDICT="$VERDICT No valid response carried a \`citations\` key at all: the API contract changed. Do not log today."
  fi
fi

# Score is always reported over the valid denominator, and the /10 form is kept
# only when all 10 are valid so historical rows stay comparable.
DENOM="$VALID"
if [ "$VALID" -gt 0 ]; then
  COMBINED_PCT=$(awk "BEGIN{printf \"%.1f\",($CITED_COUNT/30)*100}")
else
  COMBINED_PCT="0.0"
fi

# newly-cited detection vs most recent prior file
NEWLY_CITED=""
# Compare against the previous run OF THE SAME PROMPT SET, dated files only.
#
# Two bugs lived here. Globbing *.md picked up sa-youth-2-variance.md and
# EXPERIMENT-listicle-citation-test.md, which sort above every 2026-* file under
# `sort -r`; the comparison ran against a note with no per-prompt rows, so every
# cited prompt looked newly-cited and exit 2 fired most days. And the WEF run,
# which writes YYYY-MM-DD-wef.md, was comparing itself against the main set.
# SUFFIX is whatever follows the date in the output filename, so each prompt set
# compares against its own history.
SUFFIX="$(basename "$OUT" .md)"; SUFFIX="${SUFFIX#????-??-??}"
PRIOR_FILE=$(ls -1 "$OUT_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"$SUFFIX".md 2>/dev/null \
  | grep -v "/$TODAY$SUFFIX.md$" | sort -r | head -1)
if [ -n "$CITED_IDS" ]; then
  for ID in $CITED_IDS; do
    if [ -n "$PRIOR_FILE" ] && [ -f "$PRIOR_FILE" ]; then
      grep -E "^\| [0-9-]+ \| [a-z]+ \| ${ID} \| y " "$PRIOR_FILE" >/dev/null 2>&1 || \
        NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt vs $(basename "$PRIOR_FILE" .md))\n"
    else
      NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt; first tracker run)\n"
    fi
  done
fi

# ── Write ───────────────────────────────────────────────────────────────────
{
  echo "# Citation Tracker — $TODAY"
  echo ""
  echo "_Run at $NOW. Tracker health: $HEALTH. $PREFLIGHT.${HEALTH_NOTE:+ $HEALTH_NOTE}_"
  echo ""
  [ -n "$VERDICT" ] && { echo "**$VERDICT**"; echo ""; }
  echo "## Summary"
  echo ""
  if [ "$HEALTH" = "FAILED" ]; then
    # No headline number on a failed day. Downstream parsers read these two
    # lines; giving them a figure here is how 2026-08-13's false 0/10 happened.
    echo "- Perplexity: no reading (FAILED, $NODATA of $TOTAL prompts returned no data)"
    echo "- Claude: pending manual check"
    echo "- ChatGPT: pending manual check"
    echo "- Combined citation share: no reading (FAILED)"
    echo "- Partial, for debugging only, do not log: $CITED_COUNT cited of $VALID valid prompts"
  else
  echo "- Perplexity: $CITED_COUNT/$DENOM prompts cite giveready.org (automated, $TOTAL asked, $NODATA no-data)"
  echo "- Claude: pending manual check"
  echo "- ChatGPT: pending manual check"
  echo "- Combined citation share: $CITED_COUNT/30 ($COMBINED_PCT%)"
  fi
  echo "- Source-set diagnostics (Perplexity, of $DENOM valid): $CITED_DIAG cited / $RNC_DIAG retrieved-not-cited / $NR_DIAG not-retrieved"
  echo "- Retrieval share (Perplexity, daily driver): $((CITED_DIAG + RNC_DIAG))/$DENOM valid prompts surface giveready.org in the source set"
  [ -n "$NODATA_IDS" ] && echo "- No-data prompts (excluded from the denominator):$NODATA_IDS"
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
  echo "Where giveready.org sits in each prompt's source set. \`cited\` = won the citation; \`retrieved-not-cited\` = in the retrieved set but not cited (in the running, losing the cite); \`not-retrieved\` = absent from the source set (a discoverability gap); \`no-data\` = no valid response, scores nothing."
  echo ""
  echo "- cited: $CITED_DIAG/$DENOM"
  echo "- retrieved-not-cited: $RNC_DIAG/$DENOM"
  echo "- not-retrieved: $NR_DIAG/$DENOM"
  echo "- no-data: $NODATA/$TOTAL"
  echo ""
  echo "| prompt_id | giveready_status | citation_domains | search_result_domains |"
  echo "|---|---|---|---|"
  cat "$DIAG"
} > "$OUT"

# ── Retain raw responses ────────────────────────────────────────────────────
# Without this, a scoring-logic change can never be applied to history. The
# 2026-08-01..12 rows cannot be re-scored because their responses were thrown
# away with the tempdir. Cheap insurance: a few hundred KB a day.
# Fixture runs are tests, so they must not leave anything in the vault.
if [ -z "$FIXTURE_DIR" ]; then
  RAW_DIR="$OUT_DIR/raw/$(basename "$OUT" .md)"
  mkdir -p "$RAW_DIR" 2>/dev/null && cp "$WORK"/*.json "$WORK"/*.code "$RAW_DIR"/ 2>/dev/null
fi

echo "Wrote $OUT  ($CITED_COUNT/$DENOM cited, $NODATA no-data, health $HEALTH)"

[ "$EXIT_CODE" -eq 1 ] && exit 1
[ -n "$NEWLY_CITED" ] && exit 2
exit "$EXIT_CODE"
