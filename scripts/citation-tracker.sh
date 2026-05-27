#!/usr/bin/env bash
# citation-tracker.sh — daily citation-share tracker for GiveReady.
#
# Runs the 10 fixed charity-discovery prompts (giveready/scripts/citation-prompts.tsv)
# against Perplexity Sonar, detects whether each response cites giveready.org,
# writes a markdown file at 01-Projects/GiveReady/citation-tracking/YYYY-MM-DD.md.
#
# Per the 2026-05-23 CEO pivot (training-corpus + consortium thesis), this is the
# only instrumentation for the training-corpus half. The 2026-07-25 quarterly
# accelerator and 2026-11-23 hard-kill triggers evaluate against this data.
#
# Eng-review amendments honoured:
#   D1 — pre-flight health check ("tracker: OK / FAILED <reason>")
#   D2 — bash + curl + jq, mirrors build-digest.sh pattern
#   D3 — --dry-run mode uses fixture JSONs, no network calls
#   D5 — writes to $VAULT/01-Projects/GiveReady/citation-tracking/YYYY-MM-DD.md
#
# Exit codes:
#   0 — tracker ran, no NEW citation vs the most recent prior file
#   1 — tracker failed pre-flight (missing key, missing prompts file, bad API health)
#   2 — tracker ran AND at least one prompt cites giveready.org for the first time
#       (vs the most recent prior file). _cron wrapper surfaces this via macOS notification.

set -uo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
VAULT="${VAULT:-$HOME/TestVentures.net}"
SECRETS="$VAULT/.secrets/giveready.env"
PROMPTS="$VAULT/giveready/scripts/citation-prompts.tsv"
OUT_DIR="$VAULT/01-Projects/GiveReady/citation-tracking"
FIXTURE_DIR="$VAULT/giveready/tests/fixtures"
API_URL="https://api.perplexity.ai/chat/completions"
MODEL="sonar"
TODAY="$(date +%F)"
NOW="$(date '+%H:%M %Z')"
OUT="$OUT_DIR/$TODAY.md"

# ── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  --help|-h)
    cat <<EOF
Usage: $(basename "$0") [--dry-run]

  --dry-run   Use fixture JSONs from $FIXTURE_DIR instead of calling Perplexity.
              Exercises the parser end-to-end with no network and no API cost.

Reads:  $PROMPTS
Writes: $OUT_DIR/<date>.md
Secrets: $SECRETS (PERPLEXITY_API_KEY)
EOF
    exit 0
    ;;
  "") ;;
  *)
    echo "Unknown flag: $1 (try --help)" >&2
    exit 1
    ;;
esac

# ── Sanity ───────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
need curl
need jq
need awk
need sed

if [ ! -f "$PROMPTS" ]; then
  echo "Missing prompts file: $PROMPTS" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# ── Load secrets (skipped in dry-run) ────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
  if [ ! -f "$SECRETS" ]; then
    echo "Missing secrets file: $SECRETS" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$SECRETS"
  if [ -z "${PERPLEXITY_API_KEY:-}" ]; then
    echo "PERPLEXITY_API_KEY not set in $SECRETS" >&2
    exit 1
  fi
fi

# ── Pre-flight health check (D1) ─────────────────────────────────────────────
HEALTH="unknown"
if [ "$DRY_RUN" -eq 1 ]; then
  HEALTH="OK (dry-run mode, no API calls)"
  if [ ! -f "$FIXTURE_DIR/perplexity-citation-cited.json" ] || \
     [ ! -f "$FIXTURE_DIR/perplexity-citation-uncited.json" ]; then
    echo "Missing fixtures in $FIXTURE_DIR — cannot dry-run" >&2
    exit 1
  fi
else
  PING_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$API_URL" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"ok"}]}' \
    --max-time 30)
  if [ "$PING_CODE" = "200" ]; then
    HEALTH="OK"
  else
    HEALTH="FAILED (HTTP $PING_CODE on health-check)"
    cat > "$OUT" <<EOF
# Citation Tracker — $TODAY

_Run at $NOW. Tracker health: $HEALTH._

Tracker failed pre-flight health check. No data collected.
EOF
    echo "Tracker health FAILED: HTTP $PING_CODE" >&2
    exit 1
  fi
fi

# ── Iterate prompts, collect Perplexity citations ────────────────────────────
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

CITED_IDS=""   # space-separated list of cited prompt_ids (bash 3.2-safe, no arrays)
TOTAL=0
CITED_COUNT=0

# Read TSV: id<TAB>bucket<TAB>prompt. Skip header (id == "id").
while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue
  [ -z "$ID" ] && continue
  TOTAL=$((TOTAL + 1))

  if [ "$DRY_RUN" -eq 1 ]; then
    # Alternate fixtures so the parser exercises both branches.
    if [ $((TOTAL % 2)) -eq 0 ]; then
      RESP=$(cat "$FIXTURE_DIR/perplexity-citation-cited.json")
    else
      RESP=$(cat "$FIXTURE_DIR/perplexity-citation-uncited.json")
    fi
  else
    BODY=$(jq -nc \
      --arg m "$MODEL" \
      --arg p "$PROMPT" \
      '{model:$m, messages:[{role:"user",content:$p}]}')
    RESP=$(curl -s -X POST "$API_URL" \
      -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$BODY" \
      --max-time 60)
  fi

  # Parse .citations[] — a flat list of source URLs on the response root.
  CITATIONS=$(echo "$RESP" | jq -r '.citations[]?' 2>/dev/null)
  CITED_URL=$(echo "$CITATIONS" | grep -i 'giveready\.org' | head -1)

  if [ -n "$CITED_URL" ]; then
    CITED="y"
    URL_FOUND="$CITED_URL"
    CITED_COUNT=$((CITED_COUNT + 1))
    CITED_IDS="$CITED_IDS $ID"
  else
    CITED="n"
    URL_FOUND="—"
  fi

  # Notes: top 2 non-giveready domains (host-only, semicolon-joined).
  NOTES=$(echo "$CITATIONS" \
    | grep -iv 'giveready\.org' \
    | awk -F/ 'NF>2 {print $3}' \
    | head -2 \
    | paste -sd '; ' -)
  [ -z "$NOTES" ] && NOTES="—"

  printf '| %s | perplexity | %s | %s | %s | %s |\n' \
    "$TODAY" "$ID" "$CITED" "$URL_FOUND" "$NOTES" >> "$TMP"

  # Polite pacing — sonar's rate limits are generous but no need to hammer.
  [ "$DRY_RUN" -eq 0 ] && sleep 0.3
done < "$PROMPTS"

# ── Manual checklist stubs for Claude and ChatGPT ────────────────────────────
while IFS=$'\t' read -r ID BUCKET PROMPT; do
  [ "$ID" = "id" ] && continue
  [ -z "$ID" ] && continue
  for M in claude chatgpt; do
    printf '| %s | %s | %s |  |  | manual — to be filled |\n' \
      "$TODAY" "$M" "$ID" >> "$TMP"
  done
done < "$PROMPTS"

# ── Combined citation share (manual rows count 0 until filled) ───────────────
COMBINED_DENOM=30   # 10 perplexity + 10 claude + 10 chatgpt
COMBINED_NUM=$CITED_COUNT
COMBINED_PCT=$(awk "BEGIN { printf \"%.1f\", ($COMBINED_NUM / $COMBINED_DENOM) * 100 }")

# ── Newly-cited detection (vs most recent prior file) ────────────────────────
NEWLY_CITED=""
PRIOR_FILE=$(ls -1 "$OUT_DIR"/*.md 2>/dev/null | grep -v "/$TODAY.md$" | sort -r | head -1)

if [ -n "$CITED_IDS" ]; then
  for ID in $CITED_IDS; do
    if [ -n "$PRIOR_FILE" ] && [ -f "$PRIOR_FILE" ]; then
      # Was this id cited (y) in prior file for any model? Treat any-y as "known".
      if ! grep -E "^\| [0-9-]+ \| [a-z]+ \| ${ID} \| y " "$PRIOR_FILE" >/dev/null 2>&1; then
        NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt vs $(basename "$PRIOR_FILE" .md))\n"
      fi
    else
      NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt; first tracker run)\n"
    fi
  done
fi

# ── Write final output (atomic) ──────────────────────────────────────────────
FINAL="$(mktemp)"
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
  echo "- Combined citation share: $COMBINED_NUM/$COMBINED_DENOM ($COMBINED_PCT%)"
  echo ""
  echo "## Per-prompt results"
  echo ""
  echo "| date | model | prompt_id | cited | url_found | notes |"
  echo "|---|---|---|---|---|---|"
  cat "$TMP"
  echo ""
  echo "## Newly-cited (first time on this prompt across history)"
  echo ""
  if [ -z "$NEWLY_CITED" ]; then
    echo "(none today)"
  else
    printf "%b" "$NEWLY_CITED"
  fi
} > "$FINAL"

mv "$FINAL" "$OUT"
echo "Wrote $OUT  ($CITED_COUNT/10 perplexity citations)"

# ── Exit code ────────────────────────────────────────────────────────────────
if [ -n "$NEWLY_CITED" ]; then
  exit 2
fi
exit 0
