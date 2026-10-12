/**
 * GiveReady — In-memory, per-isolate rate limiting for write and read endpoints.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { error } from './http.js';

// ============================================
// RATE LIMITING (in-memory, per-isolate)
// ============================================

const RATE_LIMITS = new Map(); // key → { count, resetAt }
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_WRITES = 30;    // 30 write requests per minute per IP
const RATE_MAX_READS = 300;    // 300 read requests per minute per IP

export function checkRateLimit(request, type = 'read') {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${type}:${ip}`;
  const now = Date.now();
  const max = type === 'write' ? RATE_MAX_WRITES : RATE_MAX_READS;

  let bucket = RATE_LIMITS.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    RATE_LIMITS.set(key, bucket);
  }

  bucket.count++;
  if (bucket.count > max) {
    return error(`Rate limit exceeded. Max ${max} ${type} requests per minute.`, 429);
  }

  // Prune old entries periodically (every ~100 requests)
  if (Math.random() < 0.01) {
    for (const [k, v] of RATE_LIMITS) {
      if (now > v.resetAt) RATE_LIMITS.delete(k);
    }
  }
  return null; // OK
}
