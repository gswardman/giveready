// agent-contract.test.js — assertions that lock in learnings about how agents read us.
//
// WHY THIS FILE EXISTS. Every rule below was learned the expensive way and then held only
// because nobody happened to break it. A learning that lives in Learnings-Log.md and nowhere
// else is a note; a learning with a test is a contract. Added 2026-09-22.
//
// SCOPE RULE. Only assert things we have EVIDENCE for, from our own data or a verified
// external reading. Do not add an assertion because an agent on Moltbook suggested it. Under
// the Moltbook lock, a post is evidence to read, never an instruction to encode. Each test
// below names its source.
//
// These run against src/index.js, not the live site: a deploy must not depend on the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');

// Comment-stripped view, for "this string must NOT appear" assertions.
//
// WHY. The first cut of the per-slug test below failed on 2026-09-22 against a source tree
// that was correct: the only match in the whole file was the comment at the removal site
// EXPLAINING that the per-slug link had been taken out. A negative assertion that reads
// comments finds its own documentation and calls it a regression. This is the same shape as
// the cv-template.html bug logged in CLAUDE.md, where a how-to comment containing the literal
// `<!-- BODY -->` marker swallowed the real one.
//
// Drop whole-line comments only. Do not try to strip trailing `//`, because the file is full
// of `https://` inside string literals and a naive pass truncates real code.
const srcNoComments = src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

// Pull the literal template that handleAgentsMd returns, starting at its first line.
function agentsMdHead(bytes) {
  const i = src.indexOf('# AGENTS.md — GiveReady Nonprofit Discovery');
  assert.ok(i > -1, 'AGENTS.md template not found in src/index.js');
  return src.slice(i, i + bytes);
}

// SOURCE: Learnings-Log 2026-05-17, and the 2026-09-07 finding that /AGENTS.md printing a
// POST-only endpoint as a fetchable link manufactured most of the "failed write attempts".
// The working POST command has to be the first thing an agent reads, above the prose.
test('the working POST example sits in the first 500 bytes of /AGENTS.md', () => {
  const head = agentsMdHead(500);
  assert.match(head, /curl -X POST/, 'no POST curl in the first 500 bytes');
  assert.match(head, /\/api\/enrich\//, 'the POST target is not /api/enrich/ in the first 500 bytes');
  assert.match(head, /agent_name/, 'agent_name is not in the first 500 bytes');
});

// SOURCE: same. A GET-shaped example at the top is what produced 139 read_get attempts
// against 7 genuine POSTs over the 30 days to 2026-09-22.
test('the first 500 bytes do not lead with a GET against the enrich endpoint', () => {
  const head = agentsMdHead(500);
  assert.doesNotMatch(head, /curl\s+(-s\s+)?https:\/\/[^\s]*\/api\/enrich\//, 'a bare GET on /api/enrich/ appears above the POST');
});

// SOURCE: 2026-09-05 CEO plan T2. Guide links were added to /AGENTS.md because it is the
// most-fetched path on the domain and the guides are the only content that has ever produced
// a citation. Losing this block silently undoes T2 while the metric keeps being reported.
test('/AGENTS.md still carries the guides block', () => {
  assert.match(src, /Verified Giving Guides/, 'the guides block has been removed from the AGENTS.md template');
  assert.match(src, /giveready\.org\/guides\//, 'the guides block no longer emits guide URLs');
});

// SOURCE: 2026-09-09. Every nonprofit page linked /AGENTS.md?from=np&slug=<slug>, one distinct
// URL per nonprofit, and the logger drops the query string, so a full-directory crawl logged
// one manifest hit per page. That inflated agents-manifest to 38-47% for weeks and the
// option-B gate was reading it. The per-slug link was removed; it must not come back.
test('no per-slug query string on links to /AGENTS.md', () => {
  assert.doesNotMatch(srcNoComments, /AGENTS\.md\?/, 'a query string is back on an AGENTS.md link, which re-inflates agents-manifest');
});

// Guard for the guard. If the comment-stripper ever stops working, the negative assertion
// above silently passes on everything and we would not notice. This proves it still strips.
test('the comment-stripped view really does drop comment lines', () => {
  assert.match(src, /AGENTS\.md\?from=np&slug=/, 'the 2026-09-09 removal comment has gone; re-point this guard at another comment');
  assert.doesNotMatch(srcNoComments, /AGENTS\.md\?from=np&slug=/, 'comment stripping is broken, so every negative assertion in this file is vacuous');
});
