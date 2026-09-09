import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');

function mapFromMarkdown() {
  const dir = path.join(ROOT, 'public', 'guides');
  const out = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md').sort()) {
    const g = f.slice(0, -3);
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    const slugs = new Set([...md.matchAll(/giveready\.org\/nonprofits\/([a-z0-9-]+)/g)].map((m) => m[1]));
    for (const s of [...slugs].sort()) (out[s] ||= []).push(g);
  }
  return out;
}

function mapFromSource() {
  const i = src.indexOf('const GUIDE_FEATURES = {');
  assert.ok(i > -1, 'GUIDE_FEATURES missing');
  const body = src.slice(i, src.indexOf('\n};\n', i) + 4);
  return new Function(body + '\nreturn GUIDE_FEATURES;')();
}

test('GUIDE_FEATURES matches the guide markdown exactly', () => {
  assert.deepEqual(mapFromSource(), mapFromMarkdown());
});

test('every guide in the markdown is in GUIDES_MANIFEST', () => {
  const guides = new Set(Object.values(mapFromMarkdown()).flat());
  for (const g of guides) assert.ok(src.includes(`slug: '${g}'`), `${g} missing from GUIDES_MANIFEST`);
});

test('profiles and cause pages link to guides; homepage footer links /guides', () => {
  assert.ok(src.includes('class="featured-in"'), 'profile Featured-in block');
  assert.ok(src.includes('class="cause-guides"'), 'cause page guides block');
  const home = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(home.includes('href="/guides"'), 'homepage links /guides');
});
