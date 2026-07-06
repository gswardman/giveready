#!/usr/bin/env bash
# wef-tracker.sh — daily citation tracking for the WEF-adjacent adventure prompts.
#
# SEPARATE measurement window from the frozen 10-prompt file (citation-prompts.tsv,
# untouchable until 2026-11-23). These 4 prompts baseline on 2026-07-06, the day the
# niche-weakness scan ran (01-Projects/GiveReady/niche-scans/2026-07-06.md): all 4
# not-retrieved. They measure whether the adventure/youth-empowerment guides move
# retrieval. They do NOT count toward the pivot-plan kill/accelerator triggers.
#
# Runs the same engine as the main tracker. Output: citation-tracking/YYYY-MM-DD-wef.md
# Wire into cron/launchd AFTER the main tracker (e.g. 07:00), or run ad hoc.

set -euo pipefail

VAULT="${VAULT:-$HOME/TestVentures.net}"
[ -d "$VAULT" ] || VAULT="$HOME/mnt/TestVentures.net"
SCRIPTS="$VAULT/giveready/scripts"
OUTDIR="$VAULT/01-Projects/GiveReady/citation-tracking"

env VAULT="$VAULT" \
    PROMPTS="$SCRIPTS/wef-prompts.tsv" \
    OUT="$OUTDIR/$(date +%F)-wef.md" \
    HEALTH_NOTE="${HEALTH_NOTE:-wef adventure prompts, separate window from frozen 10}" \
    bash "$SCRIPTS/citation-tracker-fast.sh"
