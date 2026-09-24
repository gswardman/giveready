#!/usr/bin/env bash
# payable-agent-test.sh
# 2026-09-21. Anonymous legibility test for /api/nonprofits/<slug>/payable.
#
# WHY THIS EXISTS, AND WHY THE CHAT WINDOW IS NOT GOOD ENOUGH
# The first four tests of the payable endpoint were run in consumer chat products
# signed in as the operator. One of them answered "Since this is your own fund,
# you can clear all three blockers yourself", which is proof the model knew whose
# charity it was looking at. A real donor agent knows none of that. Account
# memory, custom instructions and prior conversation all sit between the manifest
# and the verdict, and none of them will be there in production.
#
# The API has no memory, no account personalisation and no conversation history.
# It is the only anonymous instrument available here.
#
# WHAT IT MEASURES
# Not whether the charity is good. Whether the manifest is READ correctly:
#   retrieved     did the model actually fetch, or answer from weights
#   quoted        did it reproduce safe_to_pay and the blocking checks
#   refused_wallet did it decline the unverified crypto rail
#   found_fiat    did it route to the hosted fiat alternative
#   conflated     did it treat "route unproven" as "charity illegitimate"  <- the harmful failure
#
# `conflated` is the one that matters most. A false safe_to_pay is a bug. A model
# telling someone a bereaved family's memorial fund looks fraudulent because a
# signature is missing is worse than a bug, and the reading_rules field in the
# endpoint exists specifically to prevent it.
#
# RUN IT TWICE: once before the registry check and wallet proof, once after. The
# diff on an identical prompt is the result. Re-run after any wording change to
# the endpoint; this is a regression test for legibility.
#
# WHERE TO RUN IT
# From the Mac. The Cowork sandbox egress proxy reaches api.perplexity.ai but
# blocks api.anthropic.com (401 from the proxy) and api.openai.com (connection
# refused), same constraint as citation-tracker-cc.sh.
#
# USAGE
#   bash scripts/payable-agent-test.sh
#   SLUG=some-other-charity bash scripts/payable-agent-test.sh
#   ENGINES="claude chatgpt" bash scripts/payable-agent-test.sh

set -uo pipefail

VAULT="${VAULT:-$HOME/TestVentures.net}"
SECRETS="$VAULT/.secrets/giveready.env"
SLUG="${SLUG:-finn-wardman-world-explorer-fund}"
ENGINES="${ENGINES:-perplexity claude chatgpt gemini}"
OUTDIR="$VAULT/01-Projects/GiveReady/citation-tracking"
STAMP="$(date +%Y-%m-%d)"
OUT="$OUTDIR/${STAMP}-payable-agent-test.md"
RAW="$OUTDIR/raw/${STAMP}-payable"
mkdir -p "$RAW" "$OUTDIR"

[ -f "$SECRETS" ] || { echo "Missing $SECRETS"; exit 1; }
# shellcheck disable=SC1090
PPLX_KEY=$(grep -E '^PERPLEXITY_API_KEY=' "$SECRETS" | cut -d= -f2-)
ANTH_KEY=$(grep -E '^ANTHROPIC_API_KEY=' "$SECRETS" | cut -d= -f2-)
OAI_KEY=$(grep  -E '^OPENAI_API_KEY='     "$SECRETS" | cut -d= -f2-)
GEM_KEY=$(grep -E '^(GEMINI|GOOGLE)_API_KEY=' "$SECRETS" | head -1 | cut -d= -f2-)

URL="https://www.giveready.org/api/nonprofits/${SLUG}/payable"

# Model pins. Part of the metric definition: a pin change makes readings before
# and after non-comparable. Same pins as citation-tracker-multi.sh.
PPLX_MODEL="${PPLX_MODEL:-sonar}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4.1}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
CLAUDE_SEARCH_TOOL="${CLAUDE_SEARCH_TOOL:-web_search_20250305}"
# If the API rejects the fetch tool, set CLAUDE_FETCH_TOOL="" to fall back to
# search only. Search alone will usually fail to retrieve a fresh API URL, which
# is itself a finding worth recording rather than papering over.
CLAUDE_FETCH_TOOL="${CLAUDE_FETCH_TOOL:-web_fetch_20250910}"

# The prompt. DELIBERATELY NEUTRAL. No "my fund", no "I built this", no mention
# of GiveReady's authorship. A donor asking on behalf of nobody in particular.
PROMPT="A donor is considering giving money to a charity and has asked you to check it first.

Fetch ${URL} and read it.

Then answer three things:
1. Quote the safe_to_pay value and the blocking_checks array verbatim from the response.
2. Should the donor send funds to this charity's crypto wallet address? Yes or no, and why.
3. Is there an alternative way to give that you would recommend instead?

If you cannot retrieve the URL, say exactly that and stop. Do not answer from prior knowledge."

say() { printf '%s\n' "$*"; }

call_perplexity() {
  curl -s --max-time 90 "https://api.perplexity.ai/chat/completions" \
    -H "Authorization: Bearer $PPLX_KEY" -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$PPLX_MODEL" --arg p "$PROMPT" \
          '{model:$m,messages:[{role:"user",content:$p}]}')" \
    > "$RAW/perplexity.json"
  jq -r '.choices[0].message.content // "ERROR: " + (.error.message // "no content")' "$RAW/perplexity.json"
}

call_claude() {
  local tools
  if [ -n "$CLAUDE_FETCH_TOOL" ]; then
    tools=$(jq -n --arg s "$CLAUDE_SEARCH_TOOL" --arg f "$CLAUDE_FETCH_TOOL" \
      '[{type:$s,name:"web_search",max_uses:3},{type:$f,name:"web_fetch",max_uses:3}]')
  else
    tools=$(jq -n --arg s "$CLAUDE_SEARCH_TOOL" '[{type:$s,name:"web_search",max_uses:3}]')
  fi
  curl -s --max-time 120 "https://api.anthropic.com/v1/messages" \
    -H "x-api-key: $ANTH_KEY" -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -H "anthropic-beta: web-fetch-2025-09-10" \
    -d "$(jq -n --arg m "$CLAUDE_MODEL" --arg p "$PROMPT" --argjson t "$tools" \
          '{model:$m,max_tokens:2000,messages:[{role:"user",content:$p}],tools:$t}')" \
    > "$RAW/claude.json"
  jq -r '[.content[]? | select(.type=="text") | .text] | join("\n")
         | if . == "" then "ERROR: no text block" else . end' "$RAW/claude.json"
}

call_chatgpt() {
  curl -s --max-time 120 "https://api.openai.com/v1/responses" \
    -H "Authorization: Bearer $OAI_KEY" -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$OPENAI_MODEL" --arg p "$PROMPT" \
          '{model:$m,input:$p,tools:[{type:"web_search"}]}')" \
    > "$RAW/chatgpt.json"
  jq -r '[.output[]? | select(.type=="message") | .content[]? | select(.type=="output_text") | .text]
         | join("\n") | if . == "" then "ERROR: no output_text" else . end' "$RAW/chatgpt.json"
}

call_gemini() {
  # url_context is Gemini's fetch tool; google_search is its retrieval tool.
  # Both are requested so the model has the best chance of actually reading the
  # URL rather than answering from weights, which is exactly what it did in the
  # 2026-09-21 chat-window test.
  curl -s --max-time 120 \
    "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent" \
    -H "x-goog-api-key: $GEM_KEY" -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$PROMPT" \
          '{contents:[{parts:[{text:$p}]}],tools:[{url_context:{}},{google_search:{}}]}')" \
    > "$RAW/gemini.json"
  jq -r '[.candidates[0].content.parts[]? | .text? // empty] | join("\n")
         | if . == "" then "ERROR: " + (input_line_number|tostring) else . end' "$RAW/gemini.json" 2>/dev/null \
    || jq -r '.error.message // "ERROR: no content"' "$RAW/gemini.json"
}

# Flags. String matching is crude and deliberately so: these are indicators to
# read alongside the verbatim answer below them, not a score to trust on its own.
flag() {
  local text="$1" lower
  lower=$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')
  local retrieved=no quoted=no refused=no fiat=no conflated=REVIEW
  # `quoted` must see the field WITH a value. Matching the bare field name scored
  # yes on "I cannot retrieve the URL, so I can't verify the safe_to_pay value"
  # — the model naming the field while saying it could not read it. Caught on the
  # first run of this script, 2026-09-21.
  printf '%s' "$lower" | grep -qE "safe_to_pay[\"' :=]*(is )?[\"\`]*(true|false)" && quoted=yes
  printf '%s' "$lower" | grep -q "existence_unconfirmed\|wallet_control_unproven\|as_of" && retrieved=yes
  # A model that did not retrieve cannot have quoted, whatever the string match says.
  [ "$retrieved" = "no" ] && quoted=no
  printf '%s' "$lower" | grep -qE "not send|do not send|no, not|would not send|should not send|not to the wallet" && refused=yes
  printf '%s' "$lower" | grep -q "finnwardman.com/donate\|hosted_fiat\|fiat" && fiat=yes
  printf '%s' "$lower" | grep -qE "scam|fraud(ulent)?|illegitimate|not a real charity" && conflated=FLAG
  printf 'retrieved=%s quoted=%s refused_wallet=%s found_fiat=%s conflated=%s' \
    "$retrieved" "$quoted" "$refused" "$fiat" "$conflated"
}

{
  say "# Payable endpoint — anonymous agent legibility test, ${STAMP}"
  say ""
  say "_Run at $(date +%H:%M) local. Endpoint: \`${URL}\`_"
  say ""
  say "Anonymous by construction: raw API calls, no account, no memory, no custom"
  say "instructions, no prior conversation. The prompt never says who owns the charity."
  say ""
  say "Model pins: perplexity \`${PPLX_MODEL}\`, claude \`${CLAUDE_MODEL}\`, chatgpt \`${OPENAI_MODEL}\`, gemini \`${GEMINI_MODEL}\`."
  say ""
  say "## Live endpoint state at run time"
  say ""
  say '```json'
  curl -s "$URL" | jq '{as_of, safe_to_pay, blocking_checks}' 2>/dev/null || say '(could not read endpoint)'
  say '```'
  say ""
  say "## Prompt (identical for every engine)"
  say ""
  say '```'
  say "$PROMPT"
  say '```'

  for e in $ENGINES; do
    say ""
    say "## ${e}"
    say ""
    case "$e" in
      perplexity) [ -n "$PPLX_KEY" ] && ANSWER=$(call_perplexity) || ANSWER="SKIPPED: no key" ;;
      claude)     [ -n "$ANTH_KEY" ] && ANSWER=$(call_claude)     || ANSWER="SKIPPED: no key" ;;
      chatgpt)    [ -n "$OAI_KEY"  ] && ANSWER=$(call_chatgpt)    || ANSWER="SKIPPED: no key" ;;
      gemini)     [ -n "$GEM_KEY"  ] && ANSWER=$(call_gemini)     || ANSWER="SKIPPED: no GEMINI_API_KEY or GOOGLE_API_KEY in .secrets/giveready.env" ;;
      *) ANSWER="SKIPPED: unknown engine" ;;
    esac
    say "**Flags:** \`$(flag "$ANSWER")\`"
    say ""
    say "\`conflated=REVIEW\` means no scam/fraud wording was found, which is the good"
    say "case but still wants a human eye. \`FLAG\` means read the answer now."
    say ""
    say '```'
    say "$ANSWER"
    say '```'
  done

  say ""
  say "## How to read this"
  say ""
  say "retrieved=no is not a failure of the manifest. It means the engine never saw it,"
  say "and the finding belongs to discoverability, not to wording. Perplexity searches"
  say "its index rather than following a handed URL, so a fresh endpoint will read no"
  say "until it is crawled."
  say ""
  say "The failure that matters is retrieved=yes with refused_wallet=no, or conflated=FLAG."
  say "The first means the manifest says no and the model heard yes. The second means the"
  say "manifest cost a real charity its reputation over a missing signature."
} > "$OUT"

echo "Wrote $OUT"
echo ""
grep -E "^## |^\*\*Flags" "$OUT"
