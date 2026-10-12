/**
 * GiveReady — POST /api/admin/reconcile: on-demand on-chain reconciliation.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { reconcileAll } from '../cron/reconcile.js';
import { json, error } from '../lib/http.js';
import { checkAdminAuth } from './auth.js';

export async function handleAdminReconcile(db, env, request) {
  const authError = checkAdminAuth(env, request);
  if (authError) return authError;
  const url = new URL(request.url);
  const backfill = url.searchParams.get('backfill') === '1';
  const slug = url.searchParams.get('slug') || null;
  if (backfill && !slug) {
    return error('Backfill must name a single ?slug= so its history can be reviewed one wallet at a time.', 400);
  }
  const results = await reconcileAll(db, env, slug, backfill);
  return json({
    backfill,
    wallets: results.length,
    signatures_checked: results.reduce((n, r) => n + r.checked, 0),
    donations_recorded: results.reduce((n, r) => n + r.recorded, 0),
    prior_history_skipped: results.reduce((n, r) => n + r.skipped_prior, 0),
    errors: results.filter(r => r.error).map(r => ({ slug: r.slug, error: r.error })),
    results,
  });
}
