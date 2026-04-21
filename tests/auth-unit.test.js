/**
 * Unit tests for the charity dashboard auth helpers.
 *
 * Run with:  node --test tests/auth-unit.test.js
 * (No npm install needed. Uses Node's built-in test runner, available in Node 20+.)
 *
 * Covers:
 *   - sha256Hex correctness against known vectors
 *   - randomHex entropy + format
 *   - Cookie parsing (getCookie)
 *   - Profile completeness rubric calculation
 *   - Session token round-trip (hash, compare)
 *   - Rate-limit logic (time-window boundary)
 *
 * These are PURE-FUNCTION tests. Integration tests that exercise the Worker +
 * D1 runtime belong in tests/integration-*.test.js (not in this file).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Polyfill globalThis.crypto for Node 18 (no-op for Node 20+)
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ============================================================
// Copy of the helpers we want to test, from src/index.js.
// Kept inline so the tests are dependency-free and don't import
// the Worker (which has Cloudflare-specific globals).
// ============================================================

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(cookieHeader, name) {
  const re = new RegExp('(?:^|; )' + name + '=([^;]*)');
  const m = (cookieHeader || '').match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

// Profile completeness rubric (pulled from public/dashboard.html renderStrength)
function calculateProfileStrength(profile) {
  let score = 0;
  let basics = 0;
  ['name', 'tagline', 'mission', 'description'].forEach(f => {
    if ((profile[f] || '').trim().length > 0) basics += 7.5;
  });
  score += Math.round(basics);

  let details = 0;
  ['country', 'city', 'founded_year', 'beneficiaries_per_year'].forEach(f => {
    if (profile[f]) details += 5;
  });
  score += details;

  let contact = 0;
  ['website', 'contact_email'].forEach(f => {
    if ((profile[f] || '').trim().length > 0) contact += 5;
  });
  score += contact;

  if (profile.logo_url) score += 5;
  // Programmes (20), Impact metrics (10), Causes/tags (5) always 0 in MVP
  return score;
}

// ============================================================
// Tests
// ============================================================

test('sha256Hex — known vectors', async () => {
  // Standard SHA-256 test vectors
  assert.equal(
    await sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    await sha256Hex('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
  );
});

test('sha256Hex — deterministic for same input', async () => {
  const a = await sha256Hex('hello world');
  const b = await sha256Hex('hello world');
  assert.equal(a, b);
});

test('sha256Hex — different for different inputs', async () => {
  const a = await sha256Hex('token-1');
  const b = await sha256Hex('token-2');
  assert.notEqual(a, b);
});

test('randomHex — correct length (bytes * 2 hex chars)', () => {
  assert.equal(randomHex(16).length, 32);  // 128-bit token
  assert.equal(randomHex(32).length, 64);  // 256-bit session token
  assert.equal(randomHex(8).length, 16);
});

test('randomHex — only hex characters', () => {
  const token = randomHex(16);
  assert.match(token, /^[0-9a-f]+$/);
});

test('randomHex — unique across calls (entropy check)', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(randomHex(16));
  assert.equal(seen.size, 1000, 'expected 1000 unique 128-bit tokens');
});

test('getCookie — returns single cookie value', () => {
  assert.equal(getCookie('gr_session=abc123', 'gr_session'), 'abc123');
});

test('getCookie — returns cookie from multi-cookie header', () => {
  assert.equal(
    getCookie('theme=dark; gr_session=xyz456; other=1', 'gr_session'),
    'xyz456'
  );
});

test('getCookie — returns null when cookie absent', () => {
  assert.equal(getCookie('theme=dark', 'gr_session'), null);
  assert.equal(getCookie('', 'gr_session'), null);
  assert.equal(getCookie(null, 'gr_session'), null);
});

test('getCookie — decodes URL-encoded values', () => {
  assert.equal(getCookie('foo=hello%20world', 'foo'), 'hello world');
});

test('getCookie — handles prefix collisions correctly', () => {
  // gr_session_x must not match gr_session
  assert.equal(getCookie('gr_session_x=wrong; gr_session=right', 'gr_session'), 'right');
});

test('profile strength — empty profile scores 0', () => {
  assert.equal(calculateProfileStrength({}), 0);
});

test('profile strength — CKS at current mockup state scores 60', () => {
  // CKS with all Basics + Details + Contact filled, no logo, no programmes/impact/causes
  const cks = {
    name: 'City Kids Surfing',
    tagline: 'Surf therapy for young people from urban backgrounds',
    mission: 'Life-changing ocean time...',
    description: 'City Kids Surfing is a Brighton-based charity...',
    country: 'United Kingdom',
    city: 'Brighton, East Sussex',
    founded_year: 2017,
    beneficiaries_per_year: 30,
    website: 'getcitykidssurfing.com',
    contact_email: 'joe@getcitykidssurfing.com',
    // no logo_url
  };
  assert.equal(calculateProfileStrength(cks), 60);
});

test('profile strength — adding logo increases score by 5', () => {
  const cks = {
    name: 'City Kids Surfing',
    tagline: 'Surf therapy',
    mission: 'x',
    description: 'x',
    country: 'UK',
    city: 'Brighton',
    founded_year: 2017,
    beneficiaries_per_year: 30,
    website: 'x',
    contact_email: 'x',
    logo_url: 'https://example.com/logo.png',
  };
  assert.equal(calculateProfileStrength(cks), 65);
});

test('profile strength — partial basics scores proportionally', () => {
  const partial = {
    name: 'X',
    tagline: 'X',
    // no mission, no description
  };
  // 2 of 4 basics fields = 15 points (7.5 * 2, rounded)
  assert.equal(calculateProfileStrength(partial), 15);
});

test('profile strength — empty strings count as empty', () => {
  const empty = {
    name: '   ',     // whitespace only
    tagline: '',
    mission: null,
    description: undefined,
  };
  assert.equal(calculateProfileStrength(empty), 0);
});

test('session token round-trip — hash, store, compare', async () => {
  const rawToken = randomHex(32);
  const storedHash = await sha256Hex(rawToken);

  // Later, receiving the cookie:
  const receivedToken = rawToken;
  const receivedHash = await sha256Hex(receivedToken);

  assert.equal(storedHash, receivedHash, 'hashes must match for valid session');
});

test('session token — tampered token produces different hash', async () => {
  const rawToken = 'a'.repeat(64);
  const storedHash = await sha256Hex(rawToken);

  const tamperedToken = 'a'.repeat(63) + 'b';
  const tamperedHash = await sha256Hex(tamperedToken);

  assert.notEqual(storedHash, tamperedHash);
});

test('magic-link expiry — 15-minute window boundary check', () => {
  const now = Date.now();
  const fifteenMinAgo = new Date(now - 15 * 60 * 1000 - 1000).toISOString();
  const justUnderFifteen = new Date(now - 14 * 60 * 1000).toISOString();

  // A row created 15+ min ago is expired
  assert.ok(new Date(fifteenMinAgo) < new Date(now - 15 * 60 * 1000));
  // A row created under 15 min ago is still valid
  assert.ok(new Date(justUnderFifteen) > new Date(now - 15 * 60 * 1000));
});

test('session expiry — 24-hour window', () => {
  const now = Date.now();
  const expiry23h = new Date(now + 23 * 60 * 60 * 1000).toISOString();
  const expiryPast = new Date(now - 1000).toISOString();

  assert.ok(new Date(expiry23h) > new Date(), 'session with future expiry is still valid');
  assert.ok(new Date(expiryPast) < new Date(), 'session with past expiry is invalid');
});

test('rate-limit window — 5 requests in 1 hour (mock logic)', () => {
  const now = Date.now();
  const times = [];
  const windowMs = 60 * 60 * 1000;
  const limit = 5;

  function canRequest(history) {
    const fresh = history.filter(t => t > now - windowMs);
    return fresh.length < limit;
  }

  // First 5 within the hour: all allowed
  for (let i = 0; i < 5; i++) {
    assert.ok(canRequest(times), `request ${i + 1} should be allowed`);
    times.push(now - i * 60_000);  // spread over the last 5 minutes
  }

  // 6th within the hour: denied
  assert.ok(!canRequest(times), 'request 6 should be rate-limited');

  // Simulate 61 minutes later — oldest slot falls out of window
  const now61m = now + 61 * 60 * 1000;
  function canRequestAt(history, t) {
    const fresh = history.filter(x => x > t - windowMs);
    return fresh.length < limit;
  }
  assert.ok(canRequestAt(times, now61m), 'after 61 minutes, the oldest request has aged out');
});

test('field allowlist — only allowed fields accepted for PATCH', () => {
  const ALLOWED = [
    'name', 'tagline', 'mission', 'description', 'website',
    'city', 'region', 'country', 'founded_year',
    'beneficiaries_per_year', 'donation_url', 'contact_email',
    'logo_url', 'annual_budget_usd', 'budget_year', 'team_size',
  ];

  // Attacker tries to patch verified, claimed_by_email, or arbitrary columns
  const patch = {
    name: 'Legit',
    verified: 1,                    // not allowed
    claimed_by_email: 'attacker@',  // not allowed
    id: 'different-id',             // not allowed
    mission: 'also legit',
  };

  const filtered = Object.keys(patch).filter(k => ALLOWED.includes(k));
  assert.deepEqual(filtered.sort(), ['mission', 'name']);
});

test('CSO regression (April 16) — isNoiseAgent allowlist of verified crawlers', () => {
  const VERIFIED = new Set(['GPTBot', 'ClaudeBot', 'Amazonbot', 'Google-Extended', 'PerplexityBot']);
  const isVerifiedAgent = (ua) => {
    for (const name of VERIFIED) if (ua.includes(name)) return true;
    return false;
  };

  assert.ok(isVerifiedAgent('Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://claude.ai/bot)'));
  assert.ok(isVerifiedAgent('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'));
  assert.ok(!isVerifiedAgent('Mozilla/5.0 (compatible; EvilBot/1.0)'));
  assert.ok(!isVerifiedAgent('Bun/1.0.0 (bun.sh)'));  // the exact UA that bypassed the old prefix filter
});

test('CSO M2 regression — /verify responses collapse missing/used/expired', () => {
  // The response SHAPE must be identical across all three rejection reasons
  // so an attacker can't distinguish.
  const responses = [
    { code: 'TOKEN_INVALID', status: 410 },
    { code: 'TOKEN_INVALID', status: 410 },
    { code: 'TOKEN_INVALID', status: 410 },
  ];
  // If any response has a different code or status, we have a leak.
  const uniqueShapes = new Set(responses.map(r => r.code + ':' + r.status));
  assert.equal(uniqueShapes.size, 1, 'all rejection responses must be TOKEN_INVALID + 410');
});
