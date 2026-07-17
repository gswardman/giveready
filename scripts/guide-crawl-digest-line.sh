#!/usr/bin/env bash
# guide-crawl-digest-line.sh
# Prints the one-line "guide crawl recency" readout for the daily digest.
# Deterministic: curls /api/admin/guide-crawl and formats days-since-last
# PerplexityBot crawl for the six tracked guides. Portable (jq does the date
# math, so it runs the same on macOS and in the Linux digest sandbox).
#
# Usage: bash scripts/guide-crawl-digest-line.sh
# Reads the admin token from .secrets/giveready.env (same as the digest).
set -euo pipefail

VAULT="${VAULT:-$HOME/mnt/TestVentures.net}"; [ -d "$VAULT" ] || VAULT="$HOME/TestVentures.net"
ENV_FILE="$VAULT/.secrets/giveready.env"
TOKEN="$(grep '^GIVEREADY_ADMIN_TOKEN=' "$ENV_FILE" | cut -d= -f2)"
[ -n "$TOKEN" ] || { echo "- Guide crawl recency: unavailable (admin token missing)"; exit 0; }

JSON="$(curl -s "https://www.giveready.org/api/admin/guide-crawl?hours=720&token=$TOKEN")"

echo "$JSON" | jq -r --arg now "$(date -u +%s)" '
  (reduce .guides[] as $g ({}; . + { ($g.route): $g.perplexity_last_crawl })) as $m
  | [
      ["cape-town","/guides/best-charities-for-cape-town-township-youth"],
      ["surf","/guides/best-surf-therapy-charities-for-at-risk-youth"],
      ["youth-travel","/guides/best-charities-funding-youth-travel-and-exploration"],
      ["uk-outdoors","/guides/best-uk-youth-charities-outdoors-skills"],
      ["us-mentorship","/guides/best-us-youth-charities-mentorship-sports-skills"],
      ["music","/guides/best-music-education-charities-for-underprivileged-kids"]
    ]
  | map(. as $p | ($m[$p[1]]) as $t
      | if $t == null then "\($p[0]) never"
        else "\($p[0]) \((($now|tonumber) - ($t + "Z" | strptime("%Y-%m-%d %H:%M:%SZ") | mktime)) / 86400 | floor)d"
        end)
  | "- Guide crawl recency (PerplexityBot, days since last crawl): " + join(", ")
'
