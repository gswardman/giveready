import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEARN_MANIFEST, _renderMarkdown as renderMarkdown } from '../src/pages/guides.js';
import { ROOT, readSrc } from './_src.js';

const guidesSrc = readSrc('pages/guides.js');
const indexSrc = readSrc('index.js');
const discoverySrc = readSrc('pages/discovery.js');
const sitemapSrc = readSrc('pages/sitemap.js');

test('every learn page has a markdown source whose frontmatter slug and title match', () => {
  assert.ok(LEARN_MANIFEST.length >= 1);
  for (const g of LEARN_MANIFEST) {
    const md = fs.readFileSync(path.join(ROOT, 'public', 'learn', `${g.slug}.md`), 'utf8');
    assert.match(md, new RegExp(`^slug: ${g.slug}$`, 'm'));
    assert.ok(md.includes(`title: ${g.title}`), `title mismatch for ${g.slug}`);
  }
});

test('the pillar embeds the audit form marker and tags requests with its ref', () => {
  const md = fs.readFileSync(path.join(ROOT, 'public', 'learn', 'get-your-charity-found-by-ai.md'), 'utf8');
  assert.ok(md.includes('\n[[audit-form]]\n'));
  assert.ok(guidesSrc.includes("const ref = 'pillar-found-by-ai';"));
  assert.ok(guidesSrc.includes("'ai-audit | ref: ' + REF + ' | name: '"));
  assert.ok(renderMarkdown('[[audit-form]]').includes('<p>[[audit-form]]</p>'));
});

test('pipe tables render as HTML tables and do not swallow the next paragraph', () => {
  const html = renderMarkdown('Intro line\n\n| A | B |\n|---|---|\n| 1 | **2** |\n| 3 | |\n\nAfter.');
  assert.ok(html.includes('<table><thead><tr><th>A</th><th>B</th></tr></thead>'));
  assert.ok(html.includes('<td><strong>2</strong></td>'));
  assert.ok(html.includes('<tr><td>3</td><td></td></tr>'));
  assert.ok(html.includes('<p>After.</p>'));
});

test('learn pages are routed, listed in llms.txt, AGENTS.md and the sitemap', () => {
  assert.ok(indexSrc.includes("return handleGuide(env, learnMatch[1], 'learn');"));
  assert.ok(discoverySrc.includes('## For charities (how-to guides for charity staff)'));
  assert.ok(discoverySrc.includes('${guidesBlock}${learnBlock}'));
  assert.ok(sitemapSrc.includes('${guideUrls}\n${learnUrls}'));
});

test('FAQ answers carry no placeholder text', () => {
  for (const g of LEARN_MANIFEST) for (const f of g.faq || []) {
    assert.ok(f.q.endsWith('?'));
    assert.ok(!/TODO|TBD|\[X\]/.test(f.a));
  }
});

test('the Worker module loads (catches duplicate top-level declarations)', async () => {
  const mod = await import('../src/index.js');
  assert.equal(typeof mod.default.fetch, 'function');
});
