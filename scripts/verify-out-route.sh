#!/usr/bin/env bash
# Post-deploy smoke test for GET /out/<slug>, the outbound donate click tracker.
#
#   bash scripts/verify-out-route.sh
#
# WHY A SEPARATE SCRIPT (2026-09-07)
# This route sits between a donor and their donation. The unit tests in
# tests/outbound-donate.test.js prove the logic against a stub; this proves the
# deployed Worker actually routes, redirects and logs. Both matter: the unit
# tests passed on a build that was not yet live.
#
# ON POLLUTION. Every successful call below writes a real donate_click_out row.
# That metric is one day old and its whole value is that it is honest, so these
# requests carry a distinctive User-Agent and the script prints exactly how many
# rows it created. Subtract them, or filter on the UA, before reading the first
# few days of the funnel. The enrichment flywheel is the cautionary tale here:
# its recent activity is entirely operator test traffic and the digest carried a
# note about that for months.
set -uo pipefail

BASE="${BASE:-https://www.giveready.org}"
SLUG="${SLUG:-waves-for-change}"
GUIDE="guide-best-surf-therapy-charities-for-at-risk-youth"
UA="GiveReady-Smoketest/1.0 (+operator; exclude from metrics)"

pass=0; fail=0; logged=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n'  "$1"; fail=$((fail+1)); }
loc()  { curl -sS --max-time 25 -A "$UA" -o /dev/null -w '%{redirect_url}' "$1"; }
code() { curl -sS --max-time 25 -A "$UA" -o /dev/null -w '%{http_code}'    "$1"; }

echo "Smoke-testing $BASE/out/$SLUG"
echo

# 1. Redirects off-site with all four UTMs.
U="$(loc "$BASE/out/$SLUG")"; logged=$((logged+1))
[ "$(code "$BASE/out/$SLUG")" = "302" ] && ok "302 on a valid slug" || bad "expected 302, got $(code "$BASE/out/$SLUG")"
logged=$((logged+1))
case "$U" in
  *waves-for-change.org*) ok "redirects to the charity's own domain" ;;
  *) bad "unexpected destination: $U" ;;
esac
for p in "utm_source=giveready.org" "utm_medium=donor" "utm_campaign=giveready-directory"; do
  case "$U" in *"$p"*) ok "carries $p" ;; *) bad "missing $p in $U" ;; esac
done
case "$U" in *"utm_content=direct"*) ok "utm_content=direct with no ref" ;; *) bad "utm_content wrong: $U" ;; esac

# 2. The guide reaches utm_content. This is the part the old constant
#    utm_campaign threw away, and the reason a charity can now tell which
#    guide sent a donor.
U="$(loc "$BASE/out/$SLUG?ref=$GUIDE")"; logged=$((logged+1))
case "$U" in *"utm_content=$GUIDE"*) ok "utm_content carries the originating guide" ;; *) bad "guide ref lost: $U" ;; esac

# 3. Not an open redirect, and a hostile ref cannot smuggle parameters.
U="$(loc "$BASE/out/$SLUG?ref=../../evil&to=https://evil.example/phish")"; logged=$((logged+1))
case "$U" in
  *evil.example*) bad "OPEN REDIRECT: destination followed a query param: $U" ;;
  *waves-for-change.org*) ok "ignores to= and stays on the database destination" ;;
  *) bad "unexpected: $U" ;;
esac
case "$U" in *"utm_content=direct"*) ok "hostile ref degrades to direct" ;; *) bad "ref not sanitised: $U" ;; esac

# 4. An unknown slug still redirects. A broken donate link is worse than a
#    missing measurement, so this must never 404 or 500. Logs nothing.
U="$(loc "$BASE/out/definitely-not-a-real-slug-xyz")"
case "$U" in *"/nonprofits"*) ok "unknown slug redirects to the directory" ;; *) bad "unknown slug gave: $U" ;; esac

# 5. Crawlers must not manufacture clicks, the way the sitemap manufactured
#    113 GET "write attempts" by printing the enrich endpoint as a URL.
curl -sS --max-time 25 -A "$UA" -D - -o /dev/null "$BASE/out/$SLUG" 2>/dev/null \
  | grep -qi 'x-robots-tag: *noindex' && ok "redirect is X-Robots-Tag noindex" || bad "no noindex header"
logged=$((logged+1))
curl -sS --max-time 25 "$BASE/robots.txt" | grep -q 'Disallow: /out/' \
  && ok "robots.txt disallows /out/" || bad "robots.txt missing Disallow: /out/"

# 6. New admin fields present. Needs the token; skipped without it.
TOKEN="$(grep -s '^GIVEREADY_ADMIN_TOKEN=' "$HOME/TestVentures.net/.secrets/giveready.env" | cut -d= -f2)"
if [ -n "${TOKEN:-}" ]; then
  CB="$(date +%s)-$RANDOM"
  T="$(curl -sS --max-time 60 "$BASE/api/admin/traffic?hours=24&token=$TOKEN&cb=$CB")"
  for f in attempts_by_caller_class attempts_by_intent attempts_by_error_class_interactive attempts_in_period_interactive_agents; do
    case "$T" in *"$f"*) ok "admin/traffic exposes $f" ;; *) bad "admin/traffic missing $f" ;; esac
  done
  F="$(curl -sS --max-time 40 "$BASE/api/admin/funnel-guides?hours=24&token=$TOKEN&cb=$CB")"
  case "$F" in *donate_click_out*) ok "funnel-guides exposes donate_click_out" ;; *) bad "funnel-guides missing donate_click_out" ;; esac
  echo
  echo "  donate_click_out now reads:"
  echo "$F" | python3 -c "import sys,json;d=json.load(sys.stdin);print('   ',json.dumps(d.get('donate_click_out'),indent=2))" 2>/dev/null || echo "    (parse failed)"
else
  echo "  SKIP admin field checks (no token found)"
fi

echo
echo "  $pass passed, $fail failed"
echo "  This run wrote ~$logged donate_click_out rows with UA '$UA'."
echo "  Subtract them from the first reading, or filter that UA out."
[ "$fail" -eq 0 ] || exit 1
