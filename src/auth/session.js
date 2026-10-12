/**
 * GiveReady — Charity dashboard session lookup.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { sha256Hex } from '../lib/crypto.js';
import { apiError, getCookie } from './magic-link.js';

// ---- session middleware ----

export async function requireCharitySession(db, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const path = new URL(request.url).pathname;
  const token = getCookie(request, 'gr_session');
  if (!token) {
    console.log(`[Auth.reject] session no-cookie path=${path} ip=${ip}`);
    return { error: apiError('UNAUTHORIZED', 'Sign in required', 401) };
  }
  const hash = await sha256Hex(token);
  const session = await db.prepare(`
    SELECT cs.token_hash, cs.charity_user_id, cs.active_nonprofit_id, cs.expires_at, cs.revoked_at, cu.email
    FROM charity_sessions cs
    JOIN charity_users cu ON cs.charity_user_id = cu.id
    WHERE cs.token_hash = ?1
  `).bind(hash).first();
  if (!session) {
    console.log(`[Auth.reject] session invalid path=${path} ip=${ip}`);
    return { error: apiError('UNAUTHORIZED', 'Invalid session', 401) };
  }
  if (session.revoked_at) {
    console.log(`[Auth.reject] session revoked path=${path} ip=${ip} email=${session.email}`);
    return { error: apiError('UNAUTHORIZED', 'Session revoked', 401) };
  }
  if (new Date(session.expires_at) < new Date()) {
    console.log(`[Auth.reject] session expired path=${path} ip=${ip} email=${session.email}`);
    return { error: apiError('UNAUTHORIZED', 'Session expired', 401) };
  }
  // Best-effort last_seen refresh (don't block on errors)
  db.prepare(`UPDATE charity_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?1`)
    .bind(hash).run().catch(() => {});
  return { session };
}
