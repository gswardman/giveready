#!/usr/bin/env bash
set -euo pipefail

# Smoke test the consensus auto-promotion loop end-to-end.
# Pick a verified nonprofit that has an empty 'tagline' (or pass SLUG=... and FIELD=...).
# Two POSTs from two different agent IDs with the same value should promote live.

BASE="${BASE:-https://giveready.org}"
SLUG="${SLUG:-}"
# Structured fields auto-promote on normalised match. Use 'website' by default.
# Use FIELD=mission to test prose (should stay pending, never apply).
FIELD="${FIELD:-website}"
VALUE="${VALUE:-https://example.org/smoke-$(date -u +%Y%m%dT%H%M%SZ)}"

if [ -z "$SLUG" ]; then
  SLUG=$(curl -s "$BASE/api/needs-enrichment?limit=1&field=$FIELD" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['nonprofits'][0]['slug'])")
fi

echo "Target: $SLUG / field=$FIELD"
echo "Value : $VALUE"
echo

for AGENT in "smoke-agent-A/1.0" "smoke-agent-B/1.0"; do
  echo "--- POST as $AGENT ---"
  curl -s -X POST "$BASE/api/enrich/$SLUG" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"$AGENT\",\"agent_name\":\"$AGENT\",\"fields\":[{\"field\":\"$FIELD\",\"value\":\"$VALUE\"}]}" \
    | python3 -m json.tool
  echo
done

echo "--- profile after ---"
curl -s "$BASE/api/nonprofits/$SLUG" | python3 -c "import json,sys; d=json.load(sys.stdin); print('$FIELD =>', d.get('$FIELD')); print('enriched_by =>', d.get('enriched_by'))"

echo
echo "--- leaderboard ---"
curl -s "$BASE/api/agents/leaderboard" | python3 -m json.tool | head -40
