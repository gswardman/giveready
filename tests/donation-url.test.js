import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validDonationUrl,
  ENRICHABLE_FIELDS,
  AUTO_PROMOTE_STRUCTURED,
} from '../src/api/enrichment.js';
import { readSrc } from './_src.js';

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
  assert.ok(ENRICHABLE_FIELDS.has('donation_url'));
  assert.ok(!AUTO_PROMOTE_STRUCTURED.has('donation_url'), 'donation_url must not auto-promote');
  assert.ok(readSrc('admin/enrichments.js').includes("enrichment.field === 'donation_url' && !validDonationUrl(enrichment.value)"), 'admin apply re-validates');
});
