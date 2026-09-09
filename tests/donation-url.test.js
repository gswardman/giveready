import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');

function loadFn(name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > -1, `${name} not found`);
  let depth = 0, body = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) { body = src.slice(i, k + 1); break; }
  }
  return new Function(body + `\nreturn ${name};`)();
}
const validDonationUrl = loadFn('validDonationUrl');

test('accepts a charity donate page and keeps path case and fragment', () => {
  assert.equal(validDonationUrl('https://give.friendsforyouth.org/give/369410/#!/donation/checkout'),
    'https://give.friendsforyouth.org/give/369410/#!/donation/checkout');
  assert.equal(validDonationUrl('https://app.donorfy.com/form/WZYDSSDQ95/E21S3'),
    'https://app.donorfy.com/form/WZYDSSDQ95/E21S3');
});

test('strips tracking params, lowercases host', () => {
  assert.equal(validDonationUrl('https://WWW.Example.org/donate?utm_source=x&amount=5'),
    'https://www.example.org/donate?amount=5');
});

test('rejects http, giveready.org, credentials, junk', () => {
  assert.equal(validDonationUrl('http://example.org/donate'), null);
  assert.equal(validDonationUrl('https://giveready.org/donate/x'), null);
  assert.equal(validDonationUrl('https://www.giveready.org/donate/x'), null);
  assert.equal(validDonationUrl('https://user:pw@example.org/'), null);
  assert.equal(validDonationUrl('javascript:alert(1)'), null);
  assert.equal(validDonationUrl('not a url'), null);
  assert.equal(validDonationUrl('https://' + 'a'.repeat(600) + '.org'), null);
});

test('donation_url is enrichable but never auto-promotes', () => {
  const enrichable = src.slice(src.indexOf('const ENRICHABLE_FIELDS'), src.indexOf('function validDonationUrl'));
  assert.ok(enrichable.includes("'donation_url'"));
  const auto = src.slice(src.indexOf('const AUTO_PROMOTE_STRUCTURED'), src.indexOf('const AUTO_PROMOTE_PROSE_PENDING'));
  assert.ok(!auto.includes('donation_url'), 'donation_url must not auto-promote');
  assert.ok(src.includes("enrichment.field === 'donation_url' && !validDonationUrl(enrichment.value)"), 'admin apply re-validates');
});
