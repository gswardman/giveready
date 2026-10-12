import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');

const a = src.indexOf('const AUTO_PROMOTE_STRUCTURED');
const b = src.indexOf('async function handleNeedsEnrichment');
assert.ok(a > -1 && b > a, 'enrichment block not found');
const { AUTO_PROMOTE_STRUCTURED, OWNER_CONFIRM_FIELDS, promoteIfConsensus } =
  new Function(src.slice(a, b) +
    '\nreturn { AUTO_PROMOTE_STRUCTURED, OWNER_CONFIRM_FIELDS, promoteIfConsensus };')();

// Minimal D1 fake: one nonprofit row, a list of pending enrichments, a write log.
function fakeDb({ current = null, pending = [] }) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return /FROM nonprofits/.test(sql) ? { val: current } : null; },
        async all() { return { results: pending }; },
        async run() { writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return {}; },
      };
    },
  };
}
const two = (v) => [
  { id: 'e1', value: v, agent_id: 'agent-a' },
  { id: 'e2', value: v, agent_id: 'agent-b' },
];

test('tiers: auto-promote is city, region, founded_year only', () => {
  assert.deepEqual([...AUTO_PROMOTE_STRUCTURED].sort(), ['city', 'founded_year', 'region']);
  assert.deepEqual([...OWNER_CONFIRM_FIELDS].sort(), ['contact_email', 'donation_url', 'website']);
});

for (const field of ['website', 'contact_email', 'donation_url']) {
  test(`${field}: two self-reported agents agreeing never promotes`, async () => {
    const db = fakeDb({ current: null, pending: two('https://attacker.example/') });
    const r = await promoteIfConsensus(db, { id: 'np1' }, field);
    assert.equal(r.promoted, false);
    assert.equal(r.reason, 'owner-confirm');
    assert.equal(db.writes.length, 0, 'no write may reach the nonprofit row');
  });
}

test('city: two agents agreeing on an empty field promotes', async () => {
  const db = fakeDb({ current: '', pending: two('Cape Town') });
  const r = await promoteIfConsensus(db, { id: 'np1' }, 'city');
  assert.equal(r.promoted, true);
  assert.ok(db.writes.some((w) => w.startsWith('UPDATE nonprofits')));
});

test('city: a filled field is never overwritten', async () => {
  const db = fakeDb({ current: 'London', pending: two('Cape Town') });
  const r = await promoteIfConsensus(db, { id: 'np1' }, 'city');
  assert.equal(r.promoted, false);
  assert.equal(r.reason, 'already-has-value');
  assert.equal(db.writes.length, 0);
});

test('handleEnrich records submissions on filled auto fields as superseded', () => {
  assert.match(src, /alreadyFilled \? 'superseded' : 'pending'/);
});

test('public docs no longer claim website or contact_email auto-promote', () => {
  for (const f of ['public/openapi.json', 'public/agents.arazzo.yaml', 'public/terms.html']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(t, /\(website, city, region, founded_year, contact_email\) auto-promote/, f);
  }
  assert.doesNotMatch(src, /\(website, city, region, founded_year, contact_email\) (auto-promote|go live)/);
});
