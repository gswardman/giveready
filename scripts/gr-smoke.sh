#!/usr/bin/env bash
# GiveReady — end-to-end smoke test of the charity path, against production.
#
# Walks a throwaway charity through the whole journey and asserts the system
# reacts at every step: register -> counted -> searchable -> verified ->
# counted as verified -> deleted -> uncounted -> unsearchable.
#
# Why it exists: on 2026-08-01/02, four faults on this path had each been live
# for months. Every one of them was invisible to a static check and obvious to
# a walk-through. A number being CORRECT is not the same as a number that
# MOVES — /api/stats was frozen at 41,216 and looked perfectly healthy.
#
# Safe to run against production: the test org is prefixed zz-smoke-, is only
# verified for a few seconds, and is deleted at the end via a trap that fires
# even on failure or Ctrl-C. Its email uses an RFC 2606 .invalid domain so the
# onboarding funnel excludes it from real metrics.
#
# Usage: ./scripts/gr-smoke.sh

set -uo pipefail

BASE="https://www.giveready.org"
ENVFILE="$HOME/TestVentures.net/.secrets/giveready.env"
[ -f "$ENVFILE" ] || { echo "FATAL: cannot read $ENVFILE"; exit 1; }
TOKEN=$(grep '^GIVEREADY_ADMIN_TOKEN=' "$ENVFILE" | cut -d= -f2)

STAMP=$(date +%Y%m%d%H%M%S)
NAME="ZZ Smoke Test $STAMP"
SLUG="zz-smoke-test-$STAMP"
FAILURES=0

cleanup() {
  # Always runs. A smoke test that can leave a fake charity in a public
  # directory is not safe to run casually, and one you run casually is the
  # only kind that catches anything.
  #
  # Two steps, because /api/admin/reject refuses to touch a verified row
  # (`WHERE slug = ?1 AND verified = 0`) — a deliberate guard against deleting
  # a live charity. The only way back is /api/admin/verify with status
  # "unverified", which uses Bearer auth rather than the ?token= query param
  # every other admin route takes. Easy to miss; the first version of this
  # script did.
  curl -s -X POST "$BASE/api/admin/verify/$SLUG" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"verification_status":"unverified"}' >/dev/null 2>&1
  curl -s -X POST "$BASE/api/admin/reject/$SLUG?token=$TOKEN" >/dev/null 2>&1
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/nonprofits/$SLUG")
  if [ "$code" = "404" ]; then
    echo "  cleanup: test org removed"
  else
    echo "  cleanup: WARNING — $SLUG still present (HTTP $code). Remove it by hand."
  fi
}
trap cleanup EXIT

stat_of() {  # $1 = json key
  curl -s "$BASE/api/stats" | python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"
}
found_in_search() {
  curl -s "$BASE/api/search?q=$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])"
}
check() {  # $1 = label, $2 = got, $3 = want
  if [ "$2" = "$3" ]; then
    printf '  [PASS] %s (got %s)\n' "$1" "$2"
  else
    printf '  [FAIL] %s — expected %s, got %s\n' "$1" "$3" "$2"
    FAILURES=$((FAILURES + 1))
  fi
}

echo
echo "GiveReady smoke test — $(date '+%Y-%m-%d %H:%M %Z')"
echo "======================================================"

NP0=$(stat_of nonprofits)
V0=$(stat_of verified_nonprofits)
echo "  baseline: $NP0 nonprofits, $V0 verified"

echo
echo "1. REGISTER"
resp=$(curl -s -X POST "$BASE/api/onboard" -H 'Content-Type: application/json' -d "{
  \"orgName\": \"$NAME\",
  \"contactEmail\": \"smoke@gr-smoke.invalid\",
  \"country\": \"United States\",
  \"mission\": \"Throwaway record created by gr-smoke.sh. Deleted automatically.\",
  \"claim_new\": true
}")
got_slug=$(printf '%s' "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('slug',''))" 2>/dev/null)
check "registration returns the expected slug" "$got_slug" "$SLUG"

echo
echo "2. COUNTED (this is the check that /api/stats is live, not cached)"
check "nonprofit count incremented" "$(stat_of nonprofits)" "$((NP0 + 1))"

echo
echo "3. SEARCHABLE (FTS insert trigger)"
check "unverified org findable by name" "$(found_in_search "zz-smoke-test-$STAMP")" "1"

echo
echo "4. VERIFY"
curl -s -X POST "$BASE/api/admin/approve/$SLUG?token=$TOKEN" >/dev/null
check "verified count incremented" "$(stat_of verified_nonprofits)" "$((V0 + 1))"

echo
echo "5. UNVERIFY then DELETE (reject refuses verified rows by design)"
curl -s -X POST "$BASE/api/admin/verify/$SLUG" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"verification_status":"unverified"}' >/dev/null
check "verified count back to baseline after unverify" "$(stat_of verified_nonprofits)" "$V0"
curl -s -X POST "$BASE/api/admin/reject/$SLUG?token=$TOKEN" >/dev/null
# The decrement matters as much as the increment: a cached counter can look
# right on the way up and never come back down.
check "nonprofit count back to baseline" "$(stat_of nonprofits)" "$NP0"

echo
echo "6. UNSEARCHABLE (FTS delete trigger)"
check "org gone from search index" "$(found_in_search "zz-smoke-test-$STAMP")" "0"

echo
echo "======================================================"
if [ "$FAILURES" -eq 0 ]; then
  echo "  ALL PASS — the path works end to end"
else
  echo "  $FAILURES CHECK(S) FAILED — see above"
fi
echo
exit "$FAILURES"
