/**
 * GiveReady — Shared HTTP response helpers: CORS/security headers, JSON responses, cache-control wrappers.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

// CORS. Dashboard auth is same-origin (giveready.org/dashboard → giveready.org/api/*),
// so Allow-Credentials is unnecessary and was incompatible with Allow-Origin: * anyway.
// Public endpoints (MCP, widget.js, nonprofit search) stay wildcard-open.
// CSP + anti-clickjacking headers apply to every response as defence-in-depth.
// CSO 2026-04-20 (H1 + M1): removed Allow-Credentials, added CSP + frame-ancestors.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, Cookie',
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://api.qrserver.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.resend.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

// Admin/telemetry responses must never be cached anywhere.
//
// WHY (2026-09-01). The daily digest read /api/admin/traffic and
// /api/admin/funnel-guides and got the previous day's response back, byte for
// byte, across five endpoints at once. Seven minutes later the same URLs
// returned live data. The responses carried NO cache-control header at all, so
// any intermediary was free to hold and replay them. A stale telemetry response
// is worse than an error: it reads as a real measurement, and it cost a digest
// headline that reported a 42-hour logging outage that never happened.
//
// Rule: any endpoint whose whole purpose is "what is true right now" declares
// itself uncacheable. Do not remove this to shave latency off an admin route.
export function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// The opposite of noStore(), for read-only public aggregates that cost real
// money to recompute. Added 2026-09-02 after the D1 rows_read diagnosis.
//
// NOTE ON WHAT THIS DOES AND DOES NOT DO. Cloudflare does not automatically
// store a Response constructed inside a Worker, so this header does not create
// an edge cache by itself. It helps browsers and shared caches only. The real
// saving on /api/stats comes from not running COUNT(*) over 41k rows; this is
// belt and braces on top of that. If Worker invocations ever need cutting too,
// the next step is caches.default with an explicit cache key, not a bigger
// max-age here.
export function cacheable(response, seconds) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${seconds}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
