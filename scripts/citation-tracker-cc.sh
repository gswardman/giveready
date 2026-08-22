#!/usr/bin/env bash
# citation-tracker-cc.sh — the Claude + ChatGPT half of the citation reading.
#
# WHY THIS EXISTS AS A SEPARATE JOB (2026-08-20):
#
# 1. Network. The Cowork cloud sandbox routes egress through a proxy that reaches
#    api.perplexity.ai but blocks api.anthropic.com (plain-text 401 from the
#    proxy) and api.openai.com (connection refused in 4ms). Those two engines can
#    only be measured from a host with direct network access, i.e. this Mac.
#
# 2. Single-writer safety. The Mac launchd tracker was retired on 2026-07-07
#    after it overwrote good cloud readings with FAILED stubs on 07-04 and 07-05.
#    The rule that came out of that: one process, one file. So this job writes
#    YYYY-MM-DD-cc.md and NEVER touches YYYY-MM-DD.md, which stays owned by the
#    cloud scheduled task. Neither can clobber the other, by construction.
#
# Do NOT "simplify" this by moving the Perplexity read back onto the Mac. That is
# precisely the arrangement that failed in July.
#
# Output: citation-tracking/YYYY-MM-DD-cc.md
# Cadence: daily, after the cloud task has written the Perplexity file.

set -euo pipefail

VAULT="${VAULT:-$HOME/TestVentures.net}"
[ -d "$VAULT" ] || VAULT="$HOME/mnt/TestVentures.net"
SCRIPTS="$VAULT/giveready/scripts"
OUTDIR="$VAULT/01-Projects/GiveReady/citation-tracking"

# macOS ships bash 3.2, which has no `wait -n`. The engine falls back to a full
# `wait`, so the concurrency cap degrades to batch-of-N rather than rolling. Ten
# prompts across two engines is still comfortably under two minutes.
# MODEL PINS. These are part of the metric definition, not implementation detail.
# A different model retrieves and cites differently, so changing either of these
# breaks comparability with every reading logged before the change. If one must
# change, record the date and the reason here, and treat the series as two series.
#
#   claude-sonnet-4-6  confirmed live 2026-08-20.
#   gpt-4.1            chosen 2026-08-20. gpt-5 and gpt-5-mini are gated behind
#                      OpenAI org verification, which was submitted and approved
#                      the same day but had not propagated to the model gate.
#                      gpt-4o also works and is the fallback. Do NOT drift to
#                      gpt-5 later without logging the switch: a step change in
#                      the ChatGPT column would otherwise read as a real movement
#                      in citation share when it is only a change of instrument.
env VAULT="$VAULT" \
    ENGINES="claude chatgpt" \
    OPENAI_MODEL="${OPENAI_MODEL:-gpt-4.1}" \
    OUT="$OUTDIR/$(date +%F)-cc.md" \
    CONCURRENCY="${CONCURRENCY:-3}" \
    HEALTH_NOTE="${HEALTH_NOTE:-claude + chatgpt, run on the Mac because the cloud sandbox cannot reach these APIs}" \
    bash "$SCRIPTS/citation-tracker-multi.sh"
