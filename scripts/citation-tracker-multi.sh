#!/usr/bin/env bash
# citation-tracker-multi.sh — multi-engine citation tracker.
#
# Runs the frozen prompt set against Perplexity Sonar, Claude (Messages API +
# web_search server tool) and ChatGPT (Responses API + web_search tool), and
# scores each engine independently.
#
# Provenance:
#   2026-08-20  Built from citation-tracker-fast.sh. That script had a stub loop
#               that wrote `manual — to be filled` rows for claude and chatgpt.
#               Nobody ever filled them: 69 of 79 daily files carry 20 blank
#               cells, and the combined score divided by a hardcoded 30, so two
#               thirds of the north-star metric was scored as misses. This
#               script measures all three and divides by what it actually read.
#
# Rules inherited from the 2026-08-13 rewrite, do not weaken any of them:
#   - A prompt with no valid response is `no-data`. Excluded from the
#     denominator, never scored `n`.
#   - Health is per engine. A dead Claude key does not fail the Perplexity read.
#   - The combined denominator is 10 x (engines that produced a reading), never
#     a hardcoded 30. An unmeasured engine is absent, not zero.
#
# New rule (2026-08-20), the retrieved-set honesty rule:
#   `not-retrieved` is a discoverability finding and drives the diagnostic tree
#   in citation-not-retrieved-diagnostic.md. We may only claim it when the
#   engine actually handed us its retrieved set. If the engine returned a
#   citation list but no source list, an uncited prompt is `not-retrieved-unknown`,
#   counted separately, and never folded into the discoverability number. This
#   is the same class of error as scoring absence-of-data as absence-of-citation.
#
# Exit codes:
#   0 — ran, all engines healthy, no NEW citation vs the most recent prior file
#   1 — failed: every engine failed, or the file would carry no reading at all
#   2 — ran AND at least one prompt cites giveready.org for the first time
#   3 — ran DEGRADED: some no-data prompts or some engine failed, but a reading
#       exists for at least one engine

set -uo pipefail

# ── Config (env-overridable) ────────────────────────────────────────────────
VAULT="${VAULT:-$HOME/TestVentures.net}"
SECRETS="$VAULT/.secrets/giveready.env"
PROMPTS="${PROMPTS:-$VAULT/giveready/scripts/citation-prompts.tsv}"
OUT_DIR="${OUT_DIR:-$VAULT/01-Projects/GiveReady/citation-tracking}"
TODAY="$(date +%F)"
NOW="$(date '+%H:%M %Z')"
OUT="${OUT:-$OUT_DIR/$TODAY.md}"
HEALTH_NOTE="${HEALTH_NOTE:-}"

# Which engines to run, space separated. Trim this to run one engine in
# isolation, which is how the Perplexity parity check is done.
ENGINES="${ENGINES:-perplexity claude chatgpt}"

PPLX_URL="${PPLX_URL:-https://api.perplexity.ai/chat/completions}"
PPLX_MODEL="${PPLX_MODEL:-sonar}"

CLAUDE_URL="${CLAUDE_URL:-https://api.anthropic.com/v1/messages}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"   # confirmed live 2026-08-20
CLAUDE_VERSION="${CLAUDE_VERSION:-2023-06-01}"
# Server-tool identifier. Anthropic versions these by date; if it goes stale the
# API returns 400 naming the bad tool type, and pre-flight prints that verbatim
# rather than silently scoring a day of zeros.
CLAUDE_SEARCH_TOOL="${CLAUDE_SEARCH_TOOL:-web_search_20250305}"
CLAUDE_MAX_USES="${CLAUDE_MAX_USES:-5}"
CLAUDE_MAX_TOKENS="${CLAUDE_MAX_TOKENS:-1024}"

OPENAI_URL="${OPENAI_URL:-https://api.openai.com/v1/responses}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-5}"
# `sources` is the full list of URLs consulted and is the ChatGPT equivalent of
# Sonar's search_results. It only comes back if explicitly included.
OPENAI_INCLUDE="${OPENAI_INCLUDE:-web_search_call.action.sources}"

CONCURRENCY="${CONCURRENCY:-3}"    # simultaneous in-flight requests per engine
REQ_TIMEOUT="${REQ_TIMEOUT:-60}"   # per-request curl timeout, seconds
RETRIES="${RETRIES:-2}"            # sequential retry passes over invalid IDs
RETRY_GAP="${RETRY_GAP:-4}"        # seconds between sequential retries
MAX_NO_DATA="${MAX_NO_DATA:-}"     # per engine. Default 20% of the set, floor 1.
FIXTURE_DIR="${FIXTURE_DIR:-}"     # test hook: score these files, skip the API

# ── Sanity ──────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
need curl; need jq; need awk; need sed
[ -f "$PROMPTS" ] || { echo "Missing prompts file: $PROMPTS" >&2; exit 1; }
mkdir -p "$OUT_DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -z "$FIXTURE_DIR" ]; then
  [ -f "$SECRETS" ] || { echo "Missing secrets file: $SECRETS" >&2; exit 1; }
  # shellcheck disable=SC1090
  . "$SECRETS"
fi

# ── Engine display names, used in the summary lines the digest parses ───────
label_of() {
  case "$1" in
    perplexity) echo "Perplexity" ;;
    claude)     echo "Claude" ;;
    chatgpt)    echo "ChatGPT" ;;
    *)          echo "$1" ;;
  esac
}

key_of() {
  case "$1" in
    perplexity) echo "${PERPLEXITY_API_KEY:-}" ;;
    claude)     echo "${ANTHROPIC_API_KEY:-}" ;;
    chatgpt)    echo "${OPENAI_API_KEY:-}" ;;
  esac
}

key_name_of() {
  case "$1" in
    perplexity) echo "PERPLEXITY_API_KEY" ;;
    claude)     echo "ANTHROPIC_API_KEY" ;;
    chatgpt)    echo "OPENAI_API_KEY" ;;
  esac
}

# ── Per-engine request ──────────────────────────────────────────────────────
# Each writes $WORK/<engine>.<id>.json and .code, so the shapes never collide.
fetch_one() {
  local eng="$1" id="$2" prompt="$3" body out code
  out="$WORK/$eng.$id.json"; code="$WORK/$eng.$id.code"

  case "$eng" in
    perplexity)
      body=$(jq -nc --arg m "$PPLX_MODEL" --arg p "$prompt" \
        '{model:$m,messages:[{role:"user",content:$p}]}')
      curl -s -X POST "$PPLX_URL" \
        -H "Authorization: Bearer ${PERPLEXITY_API_KEY:-}" \
        -H "Content-Type: application/json" \
        -d "$body" --max-time "$REQ_TIMEOUT" -o "$out" -w '%{http_code}' > "$code" 2>/dev/null
      ;;
    claude)
      body=$(jq -nc --arg m "$CLAUDE_MODEL" --arg p "$prompt" \
        --arg t "$CLAUDE_SEARCH_TOOL" --argjson mt "$CLAUDE_MAX_TOKENS" \
        --argjson mu "$CLAUDE_MAX_USES" \
        '{model:$m,max_tokens:$mt,
          messages:[{role:"user",content:$p}],
          tools:[{type:$t,name:"web_search",max_uses:$mu}]}')
      curl -s -X POST "$CLAUDE_URL" \
        -H "x-api-key: ${ANTHROPIC_API_KEY:-}" \
        -H "anthropic-version: $CLAUDE_VERSION" \
        -H "Content-Type: application/json" \
        -d "$body" --max-time "$REQ_TIMEOUT" -o "$out" -w '%{http_code}' > "$code" 2>/dev/null
      ;;
    chatgpt)
      body=$(jq -nc --arg m "$OPENAI_MODEL" --arg p "$prompt" --arg inc "$OPENAI_INCLUDE" \
        '{model:$m,input:$p,tools:[{type:"web_search"}],include:[$inc]}')
      curl -s -X POST "$OPENAI_URL" \
        -H "Authorization: Bearer ${OPENAI_API_KEY:-}" \
        -H "Content-Type: application/json" \
        -d "$body" --max-time "$REQ_TIMEOUT" -o "$out" -w '%{http_code}' > "$code" 2>/dev/null
      ;;
  esac
}

# ── Per-engine validity ─────────────────────────────────────────────────────
# valid = HTTP 200, parseable JSON, and an assistant text payload with content.
# A valid response with an empty source set is a real answer with no sources,
# which is a finding. An unparseable or empty file is missing data, which is not.
is_valid() {
  local eng="$1" id="$2" body code
  body="$WORK/$eng.$id.json"
  code="$(cat "$WORK/$eng.$id.code" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] || return 1
  [ -s "$body" ] || return 1
  case "$eng" in
    perplexity)
      jq -e '.choices[0].message.content | type == "string" and length > 0' "$body" >/dev/null 2>&1 ;;
    claude)
      jq -e '[.content[]? | select(.type=="text") | .text | select(length>0)] | length > 0' "$body" >/dev/null 2>&1 ;;
    chatgpt)
      jq -e '[.output[]? | select(.type=="message") | .content[]? | select(.type=="output_text") | .text | select(length>0)] | length > 0' "$body" >/dev/null 2>&1 ;;
  esac
}

# ── Per-engine extraction ───────────────────────────────────────────────────
# cited_urls   = URLs the engine actually attributed in its answer
# source_urls  = the full retrieved set the engine consulted
# has_sources  = whether the engine gave us a retrieved set at all
cited_urls() {
  local eng="$1" body="$WORK/$1.$2.json"
  case "$eng" in
    perplexity) jq -r '.citations[]?' "$body" 2>/dev/null ;;
    claude)     jq -r '[.content[]? | select(.type=="text") | .citations[]? | .url] | .[]?' "$body" 2>/dev/null ;;
    chatgpt)    jq -r '[.output[]? | select(.type=="message") | .content[]? | .annotations[]?
                        | select(.type=="url_citation") | .url] | .[]?' "$body" 2>/dev/null ;;
  esac
}

source_urls() {
  local eng="$1" body="$WORK/$1.$2.json"
  case "$eng" in
    perplexity) jq -r '.search_results[]?.url' "$body" 2>/dev/null ;;
    claude)     jq -r '[.content[]? | select(.type=="web_search_tool_result") | .content[]? | .url] | .[]?' "$body" 2>/dev/null ;;
    chatgpt)    jq -r '[.output[]? | select(.type=="web_search_call") | .action?.sources[]?
                        | (if type=="string" then . else .url end)] | .[]?' "$body" 2>/dev/null ;;
  esac
}

has_sources() {
  local eng="$1" body="$WORK/$1.$2.json"
  case "$eng" in
    perplexity) jq -e 'has("search_results")' "$body" >/dev/null 2>&1 ;;
    claude)     jq -e '[.content[]? | select(.type=="web_search_tool_result")] | length > 0' "$body" >/dev/null 2>&1 ;;
    chatgpt)    jq -e '[.output[]? | select(.type=="web_search_call") | .action?.sources?] | map(select(. != null)) | length > 0' "$body" >/dev/null 2>&1 ;;
  esac
}

# The field whose disappearance means the API contract changed rather than the
# citation being absent. Same guard as the 2026-08-13 SCHEMA WARNING.
has_citation_field() {
  local eng="$1" body="$WORK/$1.$2.json"
  case "$eng" in
    perplexity) jq -e 'has("citations")' "$body" >/dev/null 2>&1 ;;
    claude)     jq -e 'has("content")' "$body" >/dev/null 2>&1 ;;
    chatgpt)    jq -e 'has("output")' "$body" >/dev/null 2>&1 ;;
  esac
}

# ── Pre-flight, per engine ──────────────────────────────────────────────────
# A bad key answers instantly; a throttled good key hangs until curl gives up.
# Both are fatal for that engine, and they need different fixes, so name which.
# 2026-08-20: this function used to report every 401 as "key invalid or revoked"
# and every 000 as an account throttle. Both were wrong in the Cowork sandbox,
# whose egress proxy blocks api.anthropic.com and api.openai.com: Anthropic came
# back as a plain-text 401 from the proxy, OpenAI as a 4ms connection refusal.
# Following that diagnosis would have meant rotating perfectly good keys. So the
# rule now is: a vendor rejection is JSON, and a fast 000 is a network policy.
preflight() {
  local eng="$1" code t body
  body="$WORK/pf.$eng.json"
  case "$eng" in
    perplexity)
      read -r code t < <(curl -s -o "$body" -w '%{http_code} %{time_total}' --max-time 25 -X POST "$PPLX_URL" \
        -H "Authorization: Bearer ${PERPLEXITY_API_KEY:-}" -H "Content-Type: application/json" \
        -d '{"model":"'"$PPLX_MODEL"'","messages":[{"role":"user","content":"ok"}]}') ;;
    claude)
      read -r code t < <(curl -s -o "$body" -w '%{http_code} %{time_total}' --max-time 25 -X POST "$CLAUDE_URL" \
        -H "x-api-key: ${ANTHROPIC_API_KEY:-}" -H "anthropic-version: $CLAUDE_VERSION" \
        -H "Content-Type: application/json" \
        -d '{"model":"'"$CLAUDE_MODEL"'","max_tokens":16,"messages":[{"role":"user","content":"ok"}],"tools":[{"type":"'"$CLAUDE_SEARCH_TOOL"'","name":"web_search","max_uses":1}]}') ;;
    chatgpt)
      read -r code t < <(curl -s -o "$body" -w '%{http_code} %{time_total}' --max-time 25 -X POST "$OPENAI_URL" \
        -H "Authorization: Bearer ${OPENAI_API_KEY:-}" -H "Content-Type: application/json" \
        -d '{"model":"'"$OPENAI_MODEL"'","input":"ok","tools":[{"type":"web_search"}]}') ;;
  esac

  # Did the vendor answer, or did something in the middle? Every one of these
  # APIs returns a JSON error body. Plain text means we never reached them.
  local is_json="no"
  jq -e . "$body" >/dev/null 2>&1 && is_json="yes"

  case "$code" in
    200) echo "OK" ;;
    400) echo "REJECTED (HTTP 400: $(jq -r '.error.message // .error // "bad request"' "$body" 2>/dev/null | head -c 160))" ;;
    401|403)
      if [ "$is_json" = "yes" ]; then
        echo "REJECTED (HTTP $code from the vendor, key invalid or revoked)"
      else
        echo "BLOCKED UPSTREAM (HTTP $code, plain-text body, so this came from an egress proxy and not the vendor. The key is not implicated. Run this engine from a host with direct network access.)"
      fi ;;
    429)
      # 429 on a funded account is a real rate limit and clears by waiting. 429
      # on an unfunded one is `insufficient_quota` and never clears. Same code,
      # opposite remedies, so read the body rather than assume.
      local etype
      etype="$(jq -r '.error.type // .error.code // ""' "$body" 2>/dev/null)"
      case "$etype" in
        *insufficient_quota*|*billing*)
          echo "NO CREDIT (HTTP 429 $etype: the account has no usable balance. Add credit; waiting will not fix this.)" ;;
        "") echo "RATE-LIMITED (HTTP 429, no error body. If the account is new and unfunded, this is almost certainly quota rather than rate.)" ;;
        *)  echo "RATE-LIMITED (HTTP 429 $etype)" ;;
      esac ;;
    000)
      # A real throttle hangs. A blocked host fails instantly.
      if awk "BEGIN{exit !($t < 1.0)}"; then
        echo "NETWORK BLOCKED (no connection in ${t}s, so an egress policy refused the host outright. Not a throttle, not a quota, not the key.)"
      else
        echo "TIMED OUT (no HTTP response in ${t}s; account throttle or quota)"
      fi ;;
    *)   echo "HTTP $code" ;;
  esac
}

# ── Run ─────────────────────────────────────────────────────────────────────
dom() { awk -F/ 'NF>2{print $3}' | sed 's/^www\.//' | awk 'NF && !seen[$0]++ { out=out sep $0; sep="; " } END{print out}'; }

ROWS="$WORK/rows"; : > "$ROWS"
DIAGS="$WORK/diags"; : > "$DIAGS"
SUMMARY="$WORK/summary"; : > "$SUMMARY"
CITED_IDS_ALL=""
ENGINES_WITH_READING=0
CITED_TOTAL=0
ANY_DEGRADED=0

TOTAL_PROMPTS=$(awk -F'\t' 'NR>1 && NF{c++} END{print c+0}' "$PROMPTS")
if [ -z "$MAX_NO_DATA" ]; then
  MAX_NO_DATA=$((TOTAL_PROMPTS / 5)); [ "$MAX_NO_DATA" -lt 1 ] && MAX_NO_DATA=1
fi

for ENG in $ENGINES; do
  LABEL="$(label_of "$ENG")"
  KEY="$(key_of "$ENG")"
  KEYNAME="$(key_name_of "$ENG")"

  # Missing key is a configuration state, not a measurement. Say so and skip.
  if [ -z "$FIXTURE_DIR" ] && [ -z "$KEY" ]; then
    printf -- '- %s: not measured (%s not set in .secrets/giveready.env)\n' "$LABEL" "$KEYNAME" >> "$SUMMARY"
    ANY_DEGRADED=1
    continue
  fi

  if [ -n "$FIXTURE_DIR" ]; then
    cp "$FIXTURE_DIR"/"$ENG".*.json "$WORK"/ 2>/dev/null
    for f in "$WORK/$ENG".*.json; do [ -e "$f" ] || continue
      b="$(basename "$f" .json)"; [ -f "$WORK/$b.code" ] || echo 200 > "$WORK/$b.code"
    done
    PF="OK (fixtures)"
  else
    PF="$(preflight "$ENG")"
  fi

  if [ "${PF#OK}" = "$PF" ]; then
    printf -- '- %s: no reading (pre-flight %s)\n' "$LABEL" "$PF" >> "$SUMMARY"
    ANY_DEGRADED=1
    continue
  fi

  # Bounded-concurrency first pass.
  if [ -z "$FIXTURE_DIR" ]; then
    INFLIGHT=0
    while IFS=$'\t' read -r ID BUCKET PROMPT; do
      [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
      fetch_one "$ENG" "$ID" "$PROMPT" &
      INFLIGHT=$((INFLIGHT+1))
      if [ "$INFLIGHT" -ge "$CONCURRENCY" ]; then wait -n 2>/dev/null || wait; INFLIGHT=$((INFLIGHT-1)); fi
    done < "$PROMPTS"
    wait

    for pass in $(seq 1 "$RETRIES"); do
      RETRY_IDS=""
      while IFS=$'\t' read -r ID BUCKET PROMPT; do
        [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
        is_valid "$ENG" "$ID" || RETRY_IDS="$RETRY_IDS $ID"
      done < "$PROMPTS"
      [ -z "$RETRY_IDS" ] && break
      echo "[$ENG] retry pass $pass for:$RETRY_IDS" >&2
      for ID in $RETRY_IDS; do
        PROMPT=$(awk -F'\t' -v id="$ID" '$1==id{print $3}' "$PROMPTS")
        fetch_one "$ENG" "$ID" "$PROMPT"
        sleep "$RETRY_GAP"
      done
    done
  fi

  # Score this engine.
  TOTAL=0; VALID=0; NODATA=0; CITED=0
  D_CITED=0; D_RNC=0; D_NR=0; D_UNK=0
  NODATA_IDS=""; SCHEMA_WARN=0

  while IFS=$'\t' read -r ID BUCKET PROMPT; do
    [ "$ID" = "id" ] && continue; [ -z "$ID" ] && continue
    TOTAL=$((TOTAL+1))

    if ! is_valid "$ENG" "$ID"; then
      NODATA=$((NODATA+1)); NODATA_IDS="$NODATA_IDS $ID"
      CODE="$(cat "$WORK/$ENG.$ID.code" 2>/dev/null || echo 000)"
      printf '| %s | %s | %s | no-data | — | no valid response (HTTP %s) |\n' \
        "$TODAY" "$ENG" "$ID" "$CODE" >> "$ROWS"
      printf '| %s | %s | no-data | — | — |\n' "$ENG" "$ID" >> "$DIAGS"
      continue
    fi

    VALID=$((VALID+1))
    has_citation_field "$ENG" "$ID" || SCHEMA_WARN=$((SCHEMA_WARN+1))

    CITES="$(cited_urls "$ENG" "$ID")"
    SRCS="$(source_urls "$ENG" "$ID")"
    HIT="$(grep -i 'giveready\.org' <<<"$CITES" | head -1)"

    if [ -n "$HIT" ]; then
      CITED=$((CITED+1)); CITED_IDS_ALL="$CITED_IDS_ALL $ID"
      D_CITED=$((D_CITED+1))
      printf '| %s | %s | %s | y | %s | %s |\n' "$TODAY" "$ENG" "$ID" "$HIT" \
        "$(grep -iv 'giveready\.org' <<<"$CITES" | awk -F/ 'NF>2{print $3}' | head -2 | paste -sd '; ' - | sed 's/^$/—/')" >> "$ROWS"
      GR="cited"
    else
      NOTES="$(grep -iv 'giveready\.org' <<<"$CITES" | awk -F/ 'NF>2{print $3}' | head -2 | paste -sd '; ' -)"
      [ -z "$NOTES" ] && NOTES="—"
      printf '| %s | %s | %s | n | — | %s |\n' "$TODAY" "$ENG" "$ID" "$NOTES" >> "$ROWS"
      if grep -qi 'giveready\.org' <<<"$SRCS"; then
        GR="retrieved-not-cited"; D_RNC=$((D_RNC+1))
      elif has_sources "$ENG" "$ID"; then
        GR="not-retrieved"; D_NR=$((D_NR+1))
      else
        # The engine answered but gave us no retrieved set. We cannot tell a
        # discoverability gap from a reranker drop. Do not guess.
        GR="not-retrieved-unknown"; D_UNK=$((D_UNK+1))
      fi
    fi

    CD="$(dom <<<"$CITES")"; [ -z "$CD" ] && CD="—"
    SD="$(dom <<<"$SRCS")";  [ -z "$SD" ] && SD="—"
    printf '| %s | %s | %s | %s | %s |\n' "$ENG" "$ID" "$GR" "$CD" "$SD" >> "$DIAGS"
  done < "$PROMPTS"

  # Health for this engine.
  if [ "$VALID" -gt 0 ] && [ "$SCHEMA_WARN" -eq "$VALID" ]; then
    printf -- '- %s: no reading (SCHEMA CHANGE, every valid response lacked the citation field)\n' "$LABEL" >> "$SUMMARY"
    ANY_DEGRADED=1
  elif [ "$NODATA" -gt "$MAX_NO_DATA" ]; then
    printf -- '- %s: no reading (FAILED, %s of %s prompts returned no data, limit %s)\n' \
      "$LABEL" "$NODATA" "$TOTAL" "$MAX_NO_DATA" >> "$SUMMARY"
    ANY_DEGRADED=1
  else
    printf -- '- %s: %s/%s prompts cite giveready.org (automated, %s asked, %s no-data)\n' \
      "$LABEL" "$CITED" "$VALID" "$TOTAL" "$NODATA" >> "$SUMMARY"
    printf -- '  - source-set: %s cited / %s retrieved-not-cited / %s not-retrieved / %s not-retrieved-unknown\n' \
      "$D_CITED" "$D_RNC" "$D_NR" "$D_UNK" >> "$SUMMARY"
    [ -n "$NODATA_IDS" ] && printf -- '  - no-data (excluded from denominator):%s\n' "$NODATA_IDS" >> "$SUMMARY"
    ENGINES_WITH_READING=$((ENGINES_WITH_READING+1))
    CITED_TOTAL=$((CITED_TOTAL+CITED))
    [ "$NODATA" -gt 0 ] && ANY_DEGRADED=1
  fi
done

# ── Combined ────────────────────────────────────────────────────────────────
# Denominator is what we read, not what we wish we had read. This is the whole
# point of the rebuild: 9/30 was 9/10 with 20 unmeasured cells scored as misses.
COMBINED_DENOM=$((ENGINES_WITH_READING * TOTAL_PROMPTS))
if [ "$COMBINED_DENOM" -gt 0 ]; then
  COMBINED_PCT=$(awk "BEGIN{printf \"%.1f\",($CITED_TOTAL/$COMBINED_DENOM)*100}")
else
  COMBINED_PCT="0.0"
fi

if [ "$ENGINES_WITH_READING" -eq 0 ]; then
  HEALTH="FAILED"; EXIT_CODE=1
elif [ "$ANY_DEGRADED" -eq 1 ]; then
  HEALTH="DEGRADED"; EXIT_CODE=3
else
  HEALTH="OK"; EXIT_CODE=0
fi

# ── Newly-cited, compared against the previous run of the same prompt set ───
SUFFIX="$(basename "$OUT" .md)"; SUFFIX="${SUFFIX#????-??-??}"
PRIOR_FILE=$(ls -1 "$OUT_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"$SUFFIX".md 2>/dev/null \
  | grep -v "/$TODAY$SUFFIX.md$" | sort -r | head -1)
NEWLY_CITED=""
for ID in $(printf '%s\n' $CITED_IDS_ALL | awk 'NF && !seen[$0]++'); do
  if [ -n "$PRIOR_FILE" ] && [ -f "$PRIOR_FILE" ]; then
    grep -E "^\| [0-9-]+ \| [a-z]+ \| ${ID} \| y " "$PRIOR_FILE" >/dev/null 2>&1 || \
      NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt vs $(basename "$PRIOR_FILE" .md))\n"
  else
    NEWLY_CITED="$NEWLY_CITED- $ID (first citation on this prompt; first tracker run)\n"
  fi
done

# ── Write ───────────────────────────────────────────────────────────────────
{
  echo "# Citation Tracker — $TODAY"
  echo ""
  echo "_Run at $NOW. Tracker health: $HEALTH. Engines: $ENGINES.${HEALTH_NOTE:+ $HEALTH_NOTE}_"
  echo ""
  echo "## Summary"
  echo ""
  cat "$SUMMARY"
  if [ "$ENGINES_WITH_READING" -gt 0 ]; then
    echo "- Combined citation share: $CITED_TOTAL/$COMBINED_DENOM ($COMBINED_PCT%), over $ENGINES_WITH_READING engine(s) that produced a reading"
  else
    echo "- Combined citation share: no reading (no engine produced valid data)"
  fi
  echo ""
  echo "Measured by API with each vendor's web-search tool. This is not the consumer"
  echo "product: chatgpt.com and claude.ai run their own retrieval and ranking, so treat"
  echo "these as a repeatable proxy and calibrate against the consumer surfaces monthly."
  echo ""
  echo "## Per-prompt results"
  echo ""
  echo "| date | model | prompt_id | cited | url_found | notes |"
  echo "|---|---|---|---|---|---|"
  cat "$ROWS"
  echo ""
  echo "## Newly-cited (first time on this prompt across history)"
  echo ""
  if [ -z "$NEWLY_CITED" ]; then echo "(none today)"; else printf "%b" "$NEWLY_CITED"; fi
  echo ""
  echo "## Source-set diagnostics"
  echo ""
  echo "Where giveready.org sits in each prompt's source set. \`cited\` = won the citation; \`retrieved-not-cited\` = in the retrieved set but not cited (in the running, losing the cite); \`not-retrieved\` = absent from the source set (a discoverability gap); \`not-retrieved-unknown\` = the engine gave no retrieved set, so the gap cannot be located; \`no-data\` = no valid response, scores nothing."
  echo ""
  echo "| model | prompt_id | giveready_status | citation_domains | search_result_domains |"
  echo "|---|---|---|---|---|"
  cat "$DIAGS"
} > "$OUT"

# ── Retain raw responses ────────────────────────────────────────────────────
if [ -z "$FIXTURE_DIR" ]; then
  RAW_DIR="$OUT_DIR/raw/$(basename "$OUT" .md)"
  mkdir -p "$RAW_DIR" 2>/dev/null && cp "$WORK"/*.json "$WORK"/*.code "$RAW_DIR"/ 2>/dev/null
fi

echo "Wrote $OUT  ($CITED_TOTAL/$COMBINED_DENOM combined over $ENGINES_WITH_READING engine(s), health $HEALTH)"

[ "$EXIT_CODE" -eq 1 ] && exit 1
[ -n "$NEWLY_CITED" ] && exit 2
exit "$EXIT_CODE"
