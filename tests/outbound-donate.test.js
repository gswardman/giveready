/**
 * Unit tests for GET /out/<slug>, the outbound donate click tracker.
 *
 * Run with:  node --test tests/outbound-donate.test.js
 *
 * WHAT THESE GUARD (2026-09-07)
 * This route sits between a donor and their donation. If it breaks, the money
 * does not merely go unmeasured, it does not get given. So the tests care much
 * more about "never strand the donor" than about "always record the click".
 * Every failure path below must still produce a 302 somewhere useful.
 *
 * The specific things that would hurt:
 *
 *   1. Open redirect. The destination must come from the database by slug and
 *      never from a query parameter. A `to=` or `url=` param must be ignored.
 *      This is a charity domain; an open redirect here would be phishing bait.
 *   2. The giveready.org loop. Registration stamps donation_url with
 *      GiveReady's own donate page. Bouncing there sends the donor back into
 *      the route they just left. The API donate path already had this guard;
 *      this route needs the same one.
 *   3. Unvalidated ref reaching a URL. utm_content is interpolated from a query
 *      param. It is pattern-checked, and anything failing the check has to
 *      degrade to 'direct' rather than being passed through.
 *   4. A dead lookup stranding the donor. Unknown slug, a throwing database, a
 *      malformed stored URL: all must still redirect.
 *
 * PURE tests against a stub database. No network, no D1.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pull handleOutboundDonate out of the Worker source by brace matching. */
function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
  const i = src.indexOf('async function handleOutboundDonate(');
  assert.ok(i > -1, 'handleOutboundDonate not found in src/index.js');
  let depth = 0;
  let body = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) { body = src.slice(i, k + 1); break; }
  }
  assert.ok(body, 'unterminated handleOutboundDonate');

  const logged = [];
  const preamble = `
    const __logged = [];
    async function logOnboardingEvent(db, step, fields) { __logged.push({ step, ...fields }); }
  `;
  const fn = new Function(preamble + body + '\nreturn { handleOutboundDonate, __logged };')();
  return { handler: fn.handleOutboundDonate, logged: fn.__logged };
}

/** db.prepare(...).bind(...).first() resolves to `row`; pass null for a miss. */
function stubDb(row, opts = {}) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (opts.throws) throw new Error('D1 exploded');
              return row;
            },
          };
        },
      };
    },
  };
}

const req = { headers: { get: () => 'Mozilla/5.0 (test)' } };
const U = (p) => new URL('https://www.giveready.org' + p);

const ROW = {
  id: 'np-1',
  name: 'Waves for Change',
  slug: 'waves-for-change',
  donation_url: 'https://waves-for-change.org/donate',
  website: 'https://waves-for-change.org',
};

function loc(res) {
  assert.equal(res.status, 302, 'must always redirect');
  return res.headers.get('Location');
}

test('happy path: redirects off-site with all four UTMs and the guide in utm_content', async () => {
  const { handler } = loadHandler();
  const res = await handler(
    stubDb(ROW), req,
    U('/out/waves-for-change?ref=guide-best-surf-therapy-charities-for-at-risk-youth'),
    'waves-for-change'
  );
  const u = new URL(loc(res));
  assert.equal(u.origin + u.pathname, 'https://waves-for-change.org/donate');
  assert.equal(u.searchParams.get('utm_source'), 'giveready.org');
  assert.equal(u.searchParams.get('utm_medium'), 'donor');
  assert.equal(u.searchParams.get('utm_campaign'), 'giveready-directory');
  assert.equal(
    u.searchParams.get('utm_content'),
    'guide-best-surf-therapy-charities-for-at-risk-youth',
    'utm_content must carry the originating guide, which the old constant utm_campaign threw away'
  );
});

test('the click is logged as donate_click_out with slug and ref', async () => {
  const { handler, logged } = loadHandler();
  await handler(stubDb(ROW), req, U('/out/waves-for-change?ref=guide-x'), 'waves-for-change');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].step, 'donate_click_out');
  assert.equal(logged[0].slug, 'waves-for-change');
  assert.equal(logged[0].nonprofit_id, 'np-1');
  assert.match(logged[0].reason, /ref=guide-x/);
  assert.match(logged[0].reason, /host=waves-for-change\.org/);
});

test('NOT an open redirect: a to= param is ignored entirely', async () => {
  const { handler } = loadHandler();
  const res = await handler(
    stubDb(ROW), req,
    U('/out/waves-for-change?to=https://evil.example/phish&url=https://evil.example'),
    'waves-for-change'
  );
  const u = new URL(loc(res));
  assert.equal(u.hostname, 'waves-for-change.org');
  assert.ok(!loc(res).includes('evil.example'), 'destination must come from the database only');
});

test('hostile or malformed ref degrades to direct rather than reaching the URL', async () => {
  const { handler } = loadHandler();
  for (const bad of [
    'guide-x&utm_source=evil.com',
    '../../etc/passwd',
    'https://evil.example',
    'GUIDE-UPPERCASE',
    'notaguide',
    'guide-' + 'a'.repeat(200),
  ]) {
    const res = await handler(
      stubDb(ROW), req,
      U('/out/waves-for-change?ref=' + encodeURIComponent(bad)),
      'waves-for-change'
    );
    const u = new URL(loc(res));
    assert.equal(u.searchParams.get('utm_content'), 'direct', `ref "${bad}" must be rejected`);
    assert.equal(u.searchParams.get('utm_source'), 'giveready.org', 'params must not be smuggled');
    assert.equal(u.hostname, 'waves-for-change.org');
  }
});

test('a donation_url stamped with giveready.org falls back to website, never loops', async () => {
  const { handler } = loadHandler();
  for (const stamped of [
    'https://giveready.org/donate/waves-for-change',
    'https://www.giveready.org/donate/waves-for-change',
    'http://giveready.org/donate/waves-for-change',
  ]) {
    const res = await handler(
      stubDb({ ...ROW, donation_url: stamped }), req,
      U('/out/waves-for-change'), 'waves-for-change'
    );
    const u = new URL(loc(res));
    assert.equal(u.hostname, 'waves-for-change.org', `${stamped} must not bounce back to GiveReady`);
  }
});

test('an existing query string on the donation URL is preserved', async () => {
  const { handler } = loadHandler();
  const res = await handler(
    stubDb({ ...ROW, donation_url: 'https://justgiving.com/give?cid=99' }), req,
    U('/out/waves-for-change?ref=guide-y'), 'waves-for-change'
  );
  const u = new URL(loc(res));
  assert.equal(u.searchParams.get('cid'), '99', 'must not clobber the charity own params');
  assert.equal(u.searchParams.get('utm_content'), 'guide-y');
});

test('unknown slug still redirects, to the directory', async () => {
  const { handler } = loadHandler();
  const res = await handler(stubDb(null), req, U('/out/nope'), 'nope');
  assert.equal(loc(res), '/nonprofits');
});

test('a throwing database still redirects rather than 500ing on a donor', async () => {
  const { handler } = loadHandler();
  const res = await handler(stubDb(ROW, { throws: true }), req, U('/out/waves-for-change'), 'waves-for-change');
  assert.equal(loc(res), '/nonprofits');
});

test('no donation_url and no website redirects to the profile', async () => {
  const { handler } = loadHandler();
  const res = await handler(
    stubDb({ ...ROW, donation_url: null, website: null }), req,
    U('/out/waves-for-change'), 'waves-for-change'
  );
  assert.equal(loc(res), '/nonprofits/waves-for-change');
});

test('a malformed stored URL redirects to the profile instead of throwing', async () => {
  const { handler } = loadHandler();
  const res = await handler(
    stubDb({ ...ROW, donation_url: 'not a url', website: null }), req,
    U('/out/waves-for-change'), 'waves-for-change'
  );
  assert.equal(loc(res), '/nonprofits/waves-for-change');
});

test('the redirect is noindex and uncacheable', async () => {
  const { handler } = loadHandler();
  const res = await handler(stubDb(ROW), req, U('/out/waves-for-change'), 'waves-for-change');
  assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

// 2026-09-09: the profile-page and listing Donate buttons must go through /out
// (or /donate/<slug> when the stored URL is GiveReady's own page). Before this
// they linked the charity directly and the funnel could not see the click.
test('profile and listing Donate buttons route through /out, never the raw charity URL', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
  assert.ok(!src.includes('href="${extHref(n.donation_url)}" rel="noopener">Donate'), 'listing links the charity directly');
  assert.ok(!src.includes('let dHref = extHref(np.donation_url);'), 'profile links the charity directly');
  assert.ok(src.includes('`/out/${escHtml(np.slug)}`'), 'profile Donate goes through /out');
  assert.ok(src.includes('href="/out/${escHtml(n.slug)}"'), 'listing Donate goes through /out');
  assert.ok(src.includes("user_agent NOT LIKE 'GiveReady-Smoketest/%'"), 'funnel excludes the smoke test');
});

test('nonprofit pages no longer link a per-slug /AGENTS.md URL', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
  assert.ok(!src.includes('href="/AGENTS.md?from=np'), 'per-slug manifest link still present');
});
