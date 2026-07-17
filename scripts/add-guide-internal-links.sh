#!/usr/bin/env bash
# add-guide-internal-links.sh
# Appends one "related guide" link to each of three existing BIP posts, pointing
# PerplexityBot at the three crawl-starved guides. Job of the link is crawl
# DISCOVERY: PerplexityBot already crawls these posts, so a followable link is
# enough to get the guide crawled — which is the current bottleneck.
#
# Idempotent (skips a post that already links the guide). Backs up each file.
# Does NOT deploy — review, then redeploy testventures.
#
# Usage: bash scripts/add-guide-internal-links.sh
set -euo pipefail

VAULT="${VAULT:-$HOME/mnt/TestVentures.net}"; [ -d "$VAULT" ] || VAULT="$HOME/TestVentures.net"
POSTS="$VAULT/testventures-deploy/_source/_posts"
BASE="https://www.giveready.org/guides"

# post-file <TAB> guide-slug <TAB> anchor text
MAP=$(cat <<'EOF'
2026-06-15-day-81-nonprofit-money-stack.md	best-us-youth-charities-mentorship-sports-skills	the best US youth charities for mentorship, sports, and skills
2026-04-30-day-34-coming-out-about-giveready.md	best-music-education-charities-for-underprivileged-kids	music education charities for underprivileged kids
2026-05-29-day-63-giveready-b2a-pivot-retiring-a-theory-in-public.md	best-uk-youth-charities-outdoors-skills	the best UK youth charities for the outdoors and at-risk teenagers
EOF
)

changed=0
while IFS=$'\t' read -r file slug anchor; do
  [ -n "$file" ] || continue
  path="$POSTS/$file"
  if [ ! -f "$path" ]; then echo "SKIP (missing): $file"; continue; fi
  if grep -q "$slug" "$path"; then echo "SKIP (already linked): $file"; continue; fi
  cp "$path" "$path.bak.$(date +%Y%m%d-%H%M%S)"
  printf '\n_Related guide: [%s](%s/%s)._\n' "$anchor" "$BASE" "$slug" >> "$path"
  echo "LINKED: $file -> $slug"
  changed=$((changed+1))
done <<< "$MAP"

echo
echo "$changed post(s) changed."
if [ "$changed" -gt 0 ]; then
  echo "Review:  git -C \"$VAULT/testventures-deploy\" diff -- _source/_posts"
  echo "Deploy:  redeploy testventures (deploy-testventures skill or your site deploy.sh)"
  echo "Then watch the guide flip on the endpoint over the next 1-2 weeks:"
  echo "  bash \"$VAULT/giveready/scripts/guide-crawl-digest-line.sh\""
fi
