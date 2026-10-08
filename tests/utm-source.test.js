/**
 * Unit tests for discoveryRefFromUrl, the value stored in discovery_hits.ref.
 *
 * Run with:  node --test tests/utm-source.test.js
 *
 * WHAT THESE GUARD (2026-10-01)
 * Assistants strip the Referer header, so the only sign that a person came
 * from an AI answer is the utm_source OpenAI appends to cited links. These
 * tests pin three things: ?ref= still wins (the guide funnel depends on it),
 * utm_source is stored as 'utm-<source>' so it can never match ref LIKE
 * 'guide-%', and malformed values are dropped rather than written to D1.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadFn() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
  const i = src.indexOf('function discoveryRefFromUrl(');
  assert.ok(i > -1, 'discoveryRefFromUrl not found in src/index.js');
  let depth = 0;
  let body = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) { body = src.slice(i, k + 1); break; }
  }
  assert.ok(body, 'unterminated discoveryRefFromUrl');
  return new Function(body + '\nreturn discoveryRefFromUrl;')();
}

const f = loadFn();
const U = (p) => new URL('https://www.giveready.org' + p);

test('ChatGPT citation link is stored as utm-openai', () => {
  assert.equal(f(U('/guides/best-uk-youth-charities-outdoors-skills?utm_source=openai')), 'utm-openai');
});

test('source is lower-cased', () => {
  assert.equal(f(U('/causes/music-education?utm_source=OpenAI')), 'utm-openai');
});

test('?ref= wins over utm_source, so the guide funnel is unchanged', () => {
  assert.equal(f(U('/nonprofits/waves-for-change?ref=guide-best-surf&utm_source=openai')), 'guide-best-surf');
});

test('no params stores null', () => {
  assert.equal(f(U('/guides')), null);
});

test('malformed ref is dropped and utm_source used instead', () => {
  assert.equal(f(U('/guides?ref=%3Cscript%3E&utm_source=openai')), 'utm-openai');
});

test('malformed or oversized utm_source is dropped', () => {
  assert.equal(f(U('/guides?utm_source=%3Cscript%3E')), null);
  assert.equal(f(U('/guides?utm_source=' + 'a'.repeat(41))), null);
  assert.equal(f(U("/guides?utm_source=x'%20OR%201=1")), null);
});

test('a utm value can never look like a guide ref', () => {
  const v = f(U('/guides?utm_source=guide-x'));
  assert.equal(v, 'utm-guide-x');
  assert.ok(!v.startsWith('guide-'));
});
