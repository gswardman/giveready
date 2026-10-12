/**
 * Shared helper for tests that assert against the Worker *source text* (as
 * opposed to its behaviour): "this string must appear", "this comment is gone",
 * "the SQL CASE names every class". Function-level tests import the real
 * modules under src/ directly; this file exists only for the text assertions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');

/** Read one module under src/ by its path relative to src/, e.g. 'pages/discovery.js'. */
export function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** Every .js file under src/, concatenated, for assertions that span modules. */
export function readAllSrc() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) out.push(fs.readFileSync(p, 'utf8'));
    }
  })(SRC);
  return out.join('\n');
}

/**
 * Comment-stripped view, for "this string must NOT appear" assertions.
 *
 * WHY. A negative assertion that reads comments finds its own documentation
 * and calls it a regression (see agent-contract.test.js). Drop whole-line
 * comments only; do not try to strip trailing `//`, because the source is full
 * of `https://` inside string literals and a naive pass truncates real code.
 */
export function stripComments(src) {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}
