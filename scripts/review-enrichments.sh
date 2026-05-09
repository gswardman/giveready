#!/usr/bin/env bash
# GiveReady — daily enrichment review (human-in-the-loop)
#
# Reads pending agent enrichments, shows each one with context, and lets you
# apply / reject / skip / open in browser. Apply writes the value to the live
# nonprofit profile. Reject records a reason that the next agent submitting
# on this field will see in their response (existing self-learning loop).
#
# Token comes from /Users/papamac2025/TestVentures.net/.secrets/giveready.env.
# Endpoint defaults to production (giveready.org); override with GR_HOST.
#
# Usage:
#   ./review-enrichments.sh             # interactive review of all pending
#   ./review-enrichments.sh --list      # list-only, no prompts
#   ./review-enrichments.sh --limit 5   # cap how many to show
#
# Hotkeys per item:
#   a   apply (writes value to nonprofit, marks applied)
#   r   reject (prompts for reason)
#   s   skip
#   o   open the nonprofit's GiveReady profile in browser
#   w   open the proposed website value in browser (if URL field)
#   q   quit the review session

set -euo pipefail

GR_HOST="${GR_HOST:-https://giveready.org}"
SECRETS="/Users/papamac2025/TestVentures.net/.secrets/giveready.env"

if [ ! -f "$SECRETS" ]; then
  echo "ERROR: secrets file not found at $SECRETS"
  exit 1
fi

TOKEN=$(grep '^GIVEREADY_ADMIN_TOKEN=' "$SECRETS" | cut -d= -f2)
if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: GIVEREADY_ADMIN_TOKEN missing or empty in $SECRETS"
  exit 1
fi

LIMIT=50
LIST_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --list) LIST_ONLY=true ;;
    --limit) shift; LIMIT="${1:-50}" ;;
    --limit=*) LIMIT="${arg#--limit=}" ;;
  esac
done

PENDING_JSON=$(curl -sS "$GR_HOST/api/admin/enrichments/pending?token=$TOKEN&limit=$LIMIT")
COUNT=$(echo "$PENDING_JSON" | jq -r '.count // 0')

if [ "$COUNT" = "0" ]; then
  echo "No pending enrichments. Inbox zero."
  exit 0
fi

echo "=== Pending enrichments: $COUNT ==="
echo ""

# Iterate over each pending row.
for i in $(seq 0 $((COUNT - 1))); do
  ROW=$(echo "$PENDING_JSON" | jq ".pending[$i]")
  ID=$(echo "$ROW" | jq -r '.id')
  SLUG=$(echo "$ROW" | jq -r '.nonprofit_slug')
  NAME=$(echo "$ROW" | jq -r '.nonprofit_name // .nonprofit_slug')
  FIELD=$(echo "$ROW" | jq -r '.field')
  VALUE=$(echo "$ROW" | jq -r '.value')
  SOURCE=$(echo "$ROW" | jq -r '.source_url // "(no source)"')
  AGENT=$(echo "$ROW" | jq -r '.agent_name')
  CREATED=$(echo "$ROW" | jq -r '.created_at')
  COMPETING=$(echo "$ROW" | jq -r '.competing_pending')

  echo "─────────────────────────────────────────"
  echo "  [$((i+1))/$COUNT]  $NAME"
  echo "  slug:     $SLUG"
  echo "  field:    $FIELD"
  echo "  value:    $VALUE"
  echo "  source:   $SOURCE"
  echo "  agent:    $AGENT  ($CREATED)"
  echo "  competing pending: $COMPETING"
  echo ""

  if [ "$LIST_ONLY" = true ]; then
    continue
  fi

  while true; do
    read -r -n 1 -p "  [a]pply  [r]eject  [s]kip  [o]pen profile  [w]eb value  [q]uit: " ACTION
    echo ""

    case "$ACTION" in
      a)
        RESPONSE=$(curl -sS -X POST "$GR_HOST/api/admin/enrichments/$ID/apply?token=$TOKEN")
        OK=$(echo "$RESPONSE" | jq -r '.success // false')
        if [ "$OK" = "true" ]; then
          echo "  ✓ applied — $GR_HOST/nonprofits/$SLUG"
        else
          echo "  ✗ failed: $RESPONSE"
        fi
        break
        ;;
      r)
        read -r -p "  reason: " REASON
        REASON_JSON=$(jq -nc --arg r "$REASON" '{reason:$r}')
        RESPONSE=$(curl -sS -X POST "$GR_HOST/api/admin/enrichments/$ID/reject?token=$TOKEN" \
          -H "Content-Type: application/json" -d "$REASON_JSON")
        OK=$(echo "$RESPONSE" | jq -r '.success // false')
        if [ "$OK" = "true" ]; then
          echo "  ✓ rejected — reason logged for next agent on this field"
        else
          echo "  ✗ failed: $RESPONSE"
        fi
        break
        ;;
      s)
        echo "  skipped"
        break
        ;;
      o)
        open "$GR_HOST/nonprofits/$SLUG" 2>/dev/null || echo "  (open command failed)"
        ;;
      w)
        case "$VALUE" in
          http*) open "$VALUE" 2>/dev/null || echo "  (open command failed)" ;;
          *)     echo "  value is not a URL" ;;
        esac
        ;;
      q)
        echo "  quit. Remaining items left as pending."
        exit 0
        ;;
      *)
        ;;
    esac
  done
done

echo ""
echo "=== Review complete ==="
