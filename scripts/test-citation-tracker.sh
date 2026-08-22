#!/usr/bin/env bash
# test-citation-tracker.sh — offline regression test for citation-tracker-fast.sh.
#
# Builds fake Perplexity responses and feeds them to the tracker via FIXTURE_DIR,
# so this runs with no API key, no network, and no cost. Asserts on exit code and
# on the headline number, because the 2026-08-13 bug was a wrong number with a
# clean exit code.
#
# Usage:  bash giveready/scripts/test-citation-tracker.sh
# Exit 0 = all cases pass.

set -uo pipefail

VAULT="${VAULT:-$HOME/TestVentures.net}"
[ -d "$VAULT" ] || VAULT="$HOME/mnt/TestVentures.net"
SCRIPTS="$VAULT/giveready/scripts"
TRACKER="$SCRIPTS/citation-tracker-fast.sh"
PROMPTS="$SCRIPTS/citation-prompts.tsv"
WEF_PROMPTS="$SCRIPTS/wef-prompts.tsv"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0

mkresp() { # $1=path $2=cited(y|n)
  local cit sr
  if [ "$2" = y ]; then
    cit='["https://www.giveready.org/guides/x","https://example.org/a"]'
    sr='[{"url":"https://www.giveready.org/guides/x"},{"url":"https://example.org/a"}]'
  else
    cit='["https://example.org/a","https://foo.org/b"]'
    sr='[{"url":"https://example.org/a"},{"url":"https://foo.org/b"}]'
  fi
  jq -nc --argjson c "$cit" --argjson s "$sr" \
    '{choices:[{message:{content:"answer"}}],citations:$c,search_results:$s}' > "$1"
}

# build a fixture dir: $1=name $2=promptfile $3=how many cited $4=how many to drop
build() {
  local dir="$TMP/$1" pf="$2" ncited="$3" ndrop="$4" i=0
  mkdir -p "$dir"
  for id in $(awk -F'\t' 'NR>1&&NF{print $1}' "$pf"); do
    i=$((i+1))
    [ "$i" -le "$ncited" ] && mkresp "$dir/$id.json" y || mkresp "$dir/$id.json" n
  done
  # Guarded: BSD head on macOS rejects `head -0`, GNU head accepts it.
  if [ "$ndrop" -gt 0 ]; then
    for f in $(ls "$dir" | head -"$ndrop"); do rm -f "$dir/$f"; done
  fi
  echo "$dir"
}

check() { # $1=label $2=fixture dir $3=promptfile $4=expected exit $5=expected summary substring
  local out="$TMP/$1.md" rc
  # OUT_DIR points at an empty temp dir so the newly-cited comparison has no
  # history to read. Without this the suite's expected exit codes depend on what
  # the real vault happened to cite yesterday, which makes it fail at random.
  mkdir -p "$TMP/hist"
  env VAULT="$VAULT" OUT_DIR="$TMP/hist" PROMPTS="$3" FIXTURE_DIR="$2" OUT="$out" \
    bash "$TRACKER" >/dev/null 2>&1
  rc=$?
  local why=""
  [ "$rc" = "$4" ] || why="exit $rc, wanted $4"
  # `--` matters: the expected lines start with "-" and grep would read them as flags.
  grep -qF -- "$5" "$out" 2>/dev/null || why="${why:+$why; }missing summary line: $5"
  if [ -z "$why" ]; then
    PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %-22s %s\n' "$1" "$why"
  fi
}

echo "Testing $TRACKER"
echo

# 1. Clean run. 8 of 10 cited, nothing dropped. Exit 2 because the fixtures cite
#    prompts that the most recent real file may not have cited.
check all-valid "$(build all "$PROMPTS" 8 0)" "$PROMPTS" 2 \
  "- Perplexity: 8/10 prompts cite giveready.org"

# 2. One dropped response. Degraded, denominator shrinks, still reports a number.
check one-nodata "$(build deg1 "$PROMPTS" 8 1)" "$PROMPTS" 2 \
  "- Perplexity: 8/9 prompts cite giveready.org"

# 3. Three dropped. Over the 20% limit, so no number at all. This is the
#    2026-08-13 case: the old script wrote 0/10 and exited 0 here.
check three-nodata "$(build fail3 "$PROMPTS" 8 3)" "$PROMPTS" 1 \
  "- Combined citation share: no reading (FAILED)"

# 4. All dropped. Same rule, hardest case.
check all-nodata "$(build fail10 "$PROMPTS" 8 10)" "$PROMPTS" 1 \
  "- Combined citation share: no reading (FAILED)"

# 5. Upstream drops the `citations` key on every response. Structural zero, must
#    fail rather than log a plausible 0/10 forever.
NOCIT="$(build nocit "$PROMPTS" 8 0)"
for f in "$NOCIT"/*.json; do jq 'del(.citations)' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done
check schema-change "$NOCIT" "$PROMPTS" 1 "the API contract changed"

# 6. WEF's 4-prompt set. Two dropped is half the set; the limit is proportional,
#    so this must fail even though a fixed limit of 2 would have passed it.
if [ -f "$WEF_PROMPTS" ]; then
  check wef-proportional "$(build wef "$WEF_PROMPTS" 2 2)" "$WEF_PROMPTS" 1 \
    "- Combined citation share: no reading (FAILED)"
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
