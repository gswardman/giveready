#!/usr/bin/env bash
set -euo pipefail

# GiveReady — IndexNow submitter
#
# Pushes our URLs to IndexNow (Bing + Yandex). Perplexity retrieves from
# Bing's index, so this is the fix for the "not-retrieved on 10/10 prompts"
# citation gap logged in 00-Dashboard/giveready-daily.md (2026-06-02).
#
# Usage:
#   ./scripts/indexnow-ping.sh             Submit /causes + /guides + indexes (the test set)
#   ./scripts/indexnow-ping.sh --all       Submit every indexable URL in the sitemap
#   ./scripts/indexnow-ping.sh --dry-run   Print the payload, submit nothing
#   ./scripts/indexnow-ping.sh --all --dry-run
#
# The key file must already be live at https://www.giveready.org/<KEY>.txt
# (served by the worker — see INDEXNOW_KEY in src/index.js). Run this AFTER
# wrangler deploy, never before.

HOST="www.giveready.org"
KEY="9cf63049b10a55d8f2b83e7d53c240cf"
KEY_LOCATION="https://${HOST}/${KEY}.txt"
SITEMAP="https://${HOST}/sitemap.xml"
ENDPOINT="https://api.indexnow.org/indexnow"

DRY_RUN=false
SUBMIT_ALL=false
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --all)     SUBMIT_ALL=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

echo "=== GiveReady IndexNow ping ==="

# 1. Confirm the key file is reachable — IndexNow rejects the whole batch if not.
echo "[1/4] Checking key file at ${KEY_LOCATION} ..."
KEY_STATUS=$(curl -s -o /tmp/indexnow_key_body -w "%{http_code}" "$KEY_LOCATION" || echo "000")
KEY_BODY=$(cat /tmp/indexnow_key_body 2>/dev/null || echo "")
if [ "$KEY_STATUS" != "200" ] || [ "$KEY_BODY" != "$KEY" ]; then
  echo "  ERROR: key file not serving the expected value (HTTP ${KEY_STATUS}, body='${KEY_BODY}')."
  echo "  Deploy the worker first so /${KEY}.txt is live, then re-run."
  [ "$DRY_RUN" = true ] && echo "  (dry-run: continuing anyway to show the payload)" || exit 1
fi
[ "$KEY_STATUS" = "200" ] && echo "  Key file OK."

# 2. Pull and filter the sitemap.
echo "[2/4] Reading sitemap ${SITEMAP} ..."
ALL_URLS=$(curl -s "$SITEMAP" | grep -oE "<loc>[^<]+</loc>" | sed -E 's/<\/?loc>//g')
if [ -z "$ALL_URLS" ]; then
  echo "  ERROR: no URLs parsed from sitemap."; exit 1
fi

if [ "$SUBMIT_ALL" = true ]; then
  URLS="$ALL_URLS"
  echo "  Mode: --all ($(echo "$URLS" | wc -l | tr -d ' ') URLs)"
else
  # Test set: the citation-relevant pages — /causes*, /guides*, and the two indexes.
  URLS=$(echo "$ALL_URLS" | grep -E "/(causes|guides)(/|$)|^https://${HOST}/$" || true)
  echo "  Mode: test set — causes + guides + home ($(echo "$URLS" | grep -c . ) URLs)"
fi

# 3. Build the JSON payload.
URL_JSON=$(echo "$URLS" | grep . | sed 's/"/\\"/g' | awk '{printf "%s\"%s\"", (NR>1 ? ",":""), $0}')
PAYLOAD=$(cat <<JSON
{"host":"${HOST}","key":"${KEY}","keyLocation":"${KEY_LOCATION}","urlList":[${URL_JSON}]}
JSON
)

echo "[3/4] Payload ($(echo "$URLS" | grep -c . ) URLs):"
echo "$URLS" | grep . | sed 's/^/    /' | head -40
TOTAL=$(echo "$URLS" | grep -c .)
[ "$TOTAL" -gt 40 ] && echo "    ... and $((TOTAL - 40)) more"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[4/4] --dry-run: not submitting. Payload preview:"
  echo "$PAYLOAD" | head -c 600
  echo ""
  echo "Dry run complete."
  exit 0
fi

# 4. Submit.
echo "[4/4] Submitting to ${ENDPOINT} ..."
HTTP=$(curl -s -o /tmp/indexnow_resp -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data "$PAYLOAD" || echo "000")
RESP=$(cat /tmp/indexnow_resp 2>/dev/null || echo "")
echo "  HTTP ${HTTP}  ${RESP}"

# IndexNow returns 200 (accepted) or 202 (accepted, pending). 4xx = rejected.
case "$HTTP" in
  200|202) echo "  Accepted. ${TOTAL} URLs submitted to Bing/Yandex." ;;
  *)       echo "  Submission not accepted (HTTP ${HTTP}). Check key file and payload."; exit 1 ;;
esac
