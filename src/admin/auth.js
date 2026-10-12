/**
 * GiveReady — Admin bearer-token authentication.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { error } from '../lib/http.js';

// Helper: check admin auth
export function checkAdminAuth(env, request) {
  // Accept token via Authorization header OR ?token= query param (for browser bookmarks)
  const authHeader = request.headers.get('Authorization');
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');

  const token = queryToken || (authHeader ? authHeader.replace(/^Bearer\s+/, '') : null);

  if (!token) {
    return error('Missing admin token. Use ?token= or Authorization: Bearer header.', 401);
  }
  if (token !== env.ADMIN_TOKEN) {
    return error('Invalid admin token', 403);
  }
  return null; // auth OK
}
