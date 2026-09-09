#!/usr/bin/env bash
# Submit verified donation_url values for guide nonprofits through the
# enrichment path (never SQL), then print the admin apply commands.
# Each line below was checked by hand on 2026-09-09 against the charity's own
# site nav. Add lines as more guide nonprofits are fixed.
#
#   . ~/TestVentures.net/.secrets/giveready.env
#   bash scripts/submit-donation-urls.sh            # submit only
#   APPLY=1 bash scripts/submit-donation-urls.sh    # submit, then apply via admin token
set -euo pipefail
BASE="${BASE:-https://www.giveready.org}"
AGENT="testventures-operator"

while IFS='|' read -r slug url source; do
  [ -z "$slug" ] && continue
  case "$slug" in \#*) continue;; esac
  body=$(printf '{"agent_name":"%s","fields":[{"field":"donation_url","value":"%s","source_url":"%s"}]}' "$AGENT" "$url" "$source")
  resp=$(curl -sS -X POST -H 'Content-Type: application/json' -H "User-Agent: $AGENT/1.0" \
    --data "$body" "$BASE/api/enrich/$slug")
  id=$(printf '%s' "$resp" | jq -r '(.submissions // [])[0].id // empty' 2>/dev/null || true)
  printf '%-45s %s\n' "$slug" "${id:-NO-ID: $(printf '%s' "$resp" | head -c 160)}"
  if [ -n "${APPLY:-}" ] && [ -n "$id" ]; then
    : "${GIVEREADY_ADMIN_TOKEN:?source .secrets/giveready.env first}"
    curl -sS -X POST "$BASE/api/admin/enrichments/$id/apply?token=$GIVEREADY_ADMIN_TOKEN" | jq -c '{applied_value, error}'
  fi
done <<'LIST'
british-exploring-society|https://www.britishexploring.org/support-us/donate/|https://www.britishexploring.org/support-us/
friends-for-youth|https://give.friendsforyouth.org/give/369410/#!/donation/checkout|https://www.friendsforyouth.org/
mcr-pathways|https://mcrpathways.org/support-us/donate/|https://mcrpathways.org/support-us/
mentoring-plus|https://mentoringplus.net/get-involved/donate-today-and-inspire-young-lives/|https://mentoringplus.net/get-involved/
outward-bound-trust-uk|https://www.outwardbound.org.uk/donate/|https://www.outwardbound.org.uk/
waves-for-change|https://waves-for-change.org/get-involved/donate/|https://waves-for-change.org/
LIST
