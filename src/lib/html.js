/**
 * GiveReady — HTML escaping and URL helpers for server-rendered pages, plus the shared operator footer.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

const _HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => _HTML_ESC[c]);
}

// Normalise an external URL so it is always absolute. Stored website/donation
// values sometimes lack a scheme (e.g. "www.foo.org" or "foo.org/x"). A
// schemeless href is resolved RELATIVE to the current path by browsers and
// crawlers, producing junk like /causes/www.foo.org that 404s and burns crawl
// budget (OAI-SearchBot hit dozens of these — see giveready-daily.md 2026-06-02).
// Prepend https:// when no http(s) scheme is present. Returns '' for empty input.
export function normUrl(url) {
  let u = String(url == null ? '' : url).trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  return u;
}

// normUrl + HTML-escape, for use inside an href="" attribute.
export function extHref(url) {
  return escHtml(normUrl(url));
}

// Safe serialiser for inline JSON-LD <script type="application/ld+json"> blocks.
// JSON.stringify alone does NOT escape the literal "</script>" sequence; an
// attacker controlling any included string field (e.g. prose) could break out
// of the script tag with </script><script>...</script>. Escape `</` as `<\/`
// inside string contexts. Also escape U+2028 / U+2029 which are valid in JSON
// but break older JS parsers if anyone reuses the string in a JS context.
// CSO finding HIGH-1 (2026-05-05).
export function jsonLdSafe(value) {
  return JSON.stringify(value)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ============================================
// SHARED OPERATOR FOOTER (Google trust signal)
// ============================================
const OPERATOR_FOOTER_LINKS = `<a href="https://docs.giveready.org/introduction">About</a> · <a href="/privacy">Privacy</a> · <a href="mailto:geordie@testventures.net">Contact</a>`;

const OPERATOR_FOOTER_BLOCK = `<div style="margin-top:10px;font-size:11px;color:var(--light,#999);line-height:1.6;">
GiveReady is operated by <a href="https://testventures.net" style="color:inherit;text-decoration:underline;">TestVentures.net</a> (Geordie Wardman). Based in Switzerland.<br/>
Contact: <a href="mailto:geordie@testventures.net" style="color:inherit;text-decoration:underline;">geordie@testventures.net</a> · <a href="https://docs.giveready.org/introduction" style="color:inherit;text-decoration:underline;">About</a> · <a href="/terms" style="color:inherit;text-decoration:underline;">Terms</a> · <a href="/privacy" style="color:inherit;text-decoration:underline;">Privacy</a>
</div>`;

// Lightweight version for server-rendered content pages (causes, guides, leaderboard)
export const OPERATOR_FOOTER_PLAIN = `<div style="margin-top:0.75rem;font-size:0.8rem;color:#999;line-height:1.6;">
Operated by <a href="https://testventures.net" style="color:#999;">TestVentures.net</a> (Geordie Wardman). Based in Switzerland.
<a href="mailto:geordie@testventures.net" style="color:#999;">Contact</a> · <a href="https://docs.giveready.org/introduction" style="color:#999;">About</a> · <a href="/terms" style="color:#999;">Terms</a> · <a href="/privacy" style="color:#999;">Privacy</a>
</div>`;
