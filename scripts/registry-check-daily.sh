#!/usr/bin/env bash
# registry-check-daily.sh
#
# Daily registry standing check. Fetches the IRS Auto-Revocation List and Pub 78
# exempt file, joins them against the directory, and applies the result to D1.
#
# WHY ON THE MAC
# The Cowork sandbox cannot reach irs.gov (egress proxy refuses the host in 6ms)
# and cannot reach api.cloudflare.com either, so neither the fetch nor the D1
# write can happen there. Same constraint as citation-tracker-cc.sh.
#
# WHY DAILY WHEN THE IRS PUBLISHES MONTHLY
# The file changes monthly, but a daily run costs nothing and means the gap
# between publication and our reflecting it is at most 24 hours rather than at
# most a month. "Checked within 24h" is the product claim being sold. A monthly
# cadence would make the freshness claim monthly too.
#
# SAFETY
# check-irs-revocations.js exits 2 and writes nothing if the Pub 78 file fails to
# parse, because without a working exempt file every reinstated charity on the
# revocation list gets falsely flagged as revoked. This wrapper propagates that
# exit code and applies nothing. Never "fix" that by making the check optional.

set -euo pipefail

VAULT="${VAULT:-$HOME/TestVentures.net}"
[ -d "$VAULT" ] || VAULT="$HOME/mnt/TestVentures.net"
GR="$VAULT/giveready"
LOG_DIR="$VAULT/01-Projects/GiveReady/registry-checks"
mkdir -p "$LOG_DIR"
TODAY="$(date +%F)"
LOG="$LOG_DIR/$TODAY.md"

cd "$GR"

{
  echo "# Registry check, $TODAY"
  echo ""
  echo "_Run at $(date '+%H:%M %Z')._"
  echo ""
} > "$LOG"

echo "[1/3] Fetching and joining IRS files..."
if node scripts/check-irs-revocations.js --fetch >> "$LOG" 2>&1; then
  echo "  join OK"
else
  code=$?
  echo "  FAILED (exit $code). Nothing applied." | tee -a "$LOG"
  echo "" >> "$LOG"
  echo "**No status was written.** See the safety note in check-irs-revocations.js:" >> "$LOG"
  echo "a broken Pub 78 parse would falsely flag reinstated charities as revoked." >> "$LOG"
  exit $code
fi

SQL="data/irs/revocation-updates.sql"
if [ ! -s "$SQL" ]; then
  echo "  no updates to apply" | tee -a "$LOG"
  exit 0
fi

echo "[2/3] Applying to D1..."
wrangler d1 execute giveready --remote --file="$SQL" >> "$LOG" 2>&1
echo "  applied"

echo "[3/3] Verifying live..."
{
  echo ""
  echo "## Live status counts after apply"
  echo ""
} >> "$LOG"
curl -s "https://www.giveready.org/api/stats" >> "$LOG" 2>&1 || true

echo "Done. Log: $LOG"
