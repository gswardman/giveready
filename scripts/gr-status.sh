#!/usr/bin/env bash
# GiveReady — one-command state check for the charity path.
#
# Answers "what is actually true right now" rather than "what did we intend".
# Every line is a live check against production. Written 2026-08-01 after a day
# where four faults on the signup path had each been live for months.
#
# Usage:  ./scripts/gr-status.sh
#         ./scripts/gr-status.sh --deep     also queries D1 (slower, needs wrangler auth)

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEEP=false
[ "${1:-}" = "--deep" ] && DEEP=true

ENVFILE="$HOME/TestVentures.net/.secrets/giveready.env"
if [ ! -f "$ENVFILE" ]; then
  echo "FATAL: cannot read $ENVFILE"; exit 1
fi
TOKEN=$(grep '^GIVEREADY_ADMIN_TOKEN=' "$ENVFILE" | cut -d= -f2)
BASE="https://www.giveready.org"

pass() { printf '  [OK]   %s\n' "$1"; }
todo() { printf '  [TODO] %s\n' "$1"; }
info() { printf '         %s\n' "$1"; }

echo
echo "GiveReady status — $(date '+%Y-%m-%d %H:%M %Z')"
echo "======================================================"

# ── 1. Is the signup path healthy? ──────────────────────────
echo
echo "SIGNUP PATH"

# Tagged with a .invalid domain (RFC 2606, can never be a real address) so the
# funnel endpoint can exclude it. Without this, running the status check would
# inflate the register_fail count it is reporting on.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/onboard" \
  -H 'Content-Type: application/json' -d '{"contactEmail":"healthcheck@gr-status.invalid"}')
if [ "$code" = "400" ]; then
  pass "registration endpoint validates cleanly (400, not 500)"
elif [ "$code" = "500" ]; then
  todo "registration endpoint is 500ing — this is the April bug returning"
else
  todo "registration endpoint returned unexpected HTTP $code"
fi

# Fetch into a variable rather than piping into `grep -q`. Under `set -o
# pipefail`, grep -q exits as soon as it matches, SIGPIPEs curl, and the
# pipeline reports failure — so a successful match can read as "not found".
# It only fires when curl has not finished writing, which makes it an
# intermittent false negative. Reported by the unattended run 2026-08-02.
onboard_html=$(curl -s "$BASE/onboard")
if printf '%s' "$onboard_html" | grep -q 'new-org-mission'; then
  pass "onboarding form collects mission/website/registration/wallet"
else
  todo "onboarding form is the old 3-field version — deploy pending"
fi

# ── 2. Is the funnel recording? ─────────────────────────────
echo
echo "INSTRUMENTATION"

funnel=$(curl -s "$BASE/api/admin/funnel-onboarding?hours=168&token=$TOKEN")
# Bash pattern match, no pipe — same SIGPIPE reasoning as above.
if [[ "$funnel" == *'"summary"'* ]]; then
  pass "funnel endpoint live"
  echo "$funnel" | python3 -c "
import sys, json
d = json.load(sys.stdin)
s = d['summary']
print(f\"         attempts {s['register_attempts']} | ok {s['register_successes']} | failed {s['register_failures']}\")
print(f\"         signin dead-ends {s['signin_dead_ends']} | wallets {s['wallets_set']} | verified {s['verified']}\")
print(f\"         x402 quotes {s['donate_quotes']} | redirects {s['donate_redirects']}\")
if d.get('biggest_drop'):
    b = d['biggest_drop']
    print(f\"         biggest drop: {b['from']} -> {b['to']}, lost {b['lost']}\")
for f in d.get('top_failure_reasons', [])[:3]:
    print(f\"         FAIL: {f['reason']} ({f['hits']}x)\")
"
else
  todo "funnel endpoint not responding — migration 020 or deploy pending"
fi

# ── 3. Is search actually finding new charities? ────────────
echo
echo "DISCOVERY"

n=$(curl -s "$BASE/api/search?q=doobneek" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])" 2>/dev/null || echo 0)
if [ "$n" -gt 0 ]; then
  pass "FTS index is syncing (doobneek findable)"
else
  todo "doobneek not in search — FTS triggers (migration 019) not applied"
fi

# ── 4. Per-charity readiness ────────────────────────────────
echo
echo "CHARITY READINESS"

for slug in doobneek-inc; do
  curl -s "$BASE/api/nonprofits/$slug" | python3 -c "
import sys, json
from urllib.parse import urlparse
try:
    d = json.load(sys.stdin)
except Exception:
    print('  [TODO] $slug — no record'); raise SystemExit
name = d.get('name', '$slug')
print(f\"  {name}\")
print(('  [OK]   ' if d.get('verified') else '  [TODO] ') + ('verified, page is public' if d.get('verified') else 'not verified — page not public'))
if d.get('usdc_wallet'):
    print('  [OK]   USDC wallet set' + (' — x402 live' if d.get('verified') else ' — pending verification'))
else:
    print('  [TODO] no USDC wallet — donors are redirected, no x402')
du = d.get('donation_url')
host = urlparse(du).netloc if du else ''
if du and 'giveready.org' in host:
    print('  [TODO] stored donation_url still self-references GiveReady')
    print('         (live behaviour is guarded and resolves to their site; this is a stale value)')
else:
    print('  [OK]   donation_url is off-site or empty')
"
done

# ── 5. Things only D1 can answer ────────────────────────────
if [ "$DEEP" = true ]; then
  echo
  echo "DEEP CHECKS (D1)"
  echo "  charity_users bindings:"
  npx wrangler d1 execute giveready-db --remote --json --command \
    "SELECT email, nonprofit_id FROM charity_users;" 2>/dev/null \
    | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)[0]['results']
except Exception:
    print('         (query failed — check wrangler auth)'); raise SystemExit
if not r:
    print('  [TODO] no charity_users rows at all — nobody can sign in')
for row in r:
    print(f\"  [OK]   {row['email']} -> {row['nonprofit_id']}\")
"
else
  echo
  info "run with --deep to also check charity_users bindings via D1"
fi

echo
echo "======================================================"
echo
