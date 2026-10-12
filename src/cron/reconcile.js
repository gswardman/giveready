/**
 * GiveReady — On-chain USDC reconciliation for the hourly cron and the admin endpoint.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { USDC_MINT_SOLANA, SOLANA_MAINNET } from '../api/donate.js';
import { logOnboardingEvent } from '../lib/funnel.js';

// ============================================
// ON-CHAIN RECONCILIATION
// ============================================
//
// The x402 path writes a donations row because the Worker builds and broadcasts
// the transaction itself. A donor who pays from their own wallet -- the QR or
// the solana: link on /donate/<slug> -- never touches the Worker, so until this
// existed those donations were invisible: the charity's page reported $0 raised
// while real money was arriving in their wallet.
//
// This reads each verified nonprofit's USDC token account on chain and records
// anything it has not seen before. It claims no attribution: a row written here
// is marked source='onchain', meaning "money arrived", not "GiveReady referred
// it". Reference-key attribution is a separate change.

const USDC_DECIMALS = 6;
const RECONCILE_SIG_LIMIT = 50;    // signatures per wallet per run
const RECONCILE_MAX_WALLETS = 25;  // wallets per scheduled run

async function solanaRpc(env, method, params) {
  if (!env.SOLANA_RPC) throw new Error('SOLANA_RPC is not configured');
  const res = await fetch(env.SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    throw new Error(`RPC ${method}: ${body.error.message || JSON.stringify(body.error)}`);
  }
  return body.result;
}

// Signatures must be read from the USDC token account, not the owner wallet.
// In a plain SPL transfer the recipient's owner address is usually absent from
// the account list, so getSignaturesForAddress(wallet) would return nothing.
async function usdcTokenAccount(env, ownerWallet) {
  const r = await solanaRpc(env, 'getTokenAccountsByOwner', [
    ownerWallet,
    { mint: USDC_MINT_SOLANA },
    { encoding: 'jsonParsed' },
  ]);
  const first = r && r.value && r.value[0];
  return first ? first.pubkey : null;
}

// Atomic USDC credited to `tokenAccount` by this transaction. Taken from the
// pre/post token balances rather than by parsing instructions, so it stays
// correct for transfer, transferChecked, and multi-instruction transactions.
function creditedAtomic(tx, tokenAccount) {
  const keys = (tx && tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
  const idx = keys.findIndex(k => (typeof k === 'string' ? k : k && k.pubkey) === tokenAccount);
  if (idx < 0) return 0;
  const meta = tx.meta || {};
  const post = (meta.postTokenBalances || []).find(b => b.accountIndex === idx);
  if (!post || post.mint !== USDC_MINT_SOLANA) return 0;
  const pre = (meta.preTokenBalances || []).find(b => b.accountIndex === idx);
  const before = BigInt((pre && pre.uiTokenAmount && pre.uiTokenAmount.amount) || '0');
  const after = BigInt((post.uiTokenAmount && post.uiTokenAmount.amount) || '0');
  const delta = after - before;
  return delta > 0n ? Number(delta) : 0;
}

// Best available stand-in for "who paid". The fee payer is the first account
// key and, for a wallet-initiated donation, is the donor.
function feePayer(tx) {
  const k = tx && tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys && tx.transaction.message.accountKeys[0];
  return k ? (typeof k === 'string' ? k : k.pubkey) : null;
}

async function saveReconcileState(db, np, tokenAccount, lastSignature, err) {
  try {
    await db.prepare(
      `INSERT INTO wallet_reconcile_state
         (nonprofit_id, wallet, token_account, last_signature, last_run_at, last_error)
       VALUES (?1, ?2, ?3, ?4, datetime('now'), ?5)
       ON CONFLICT(nonprofit_id) DO UPDATE SET
         wallet = ?2,
         token_account = COALESCE(?3, token_account),
         last_signature = COALESCE(?4, last_signature),
         last_run_at = datetime('now'),
         last_error = ?5`
    ).bind(np.id, np.usdc_wallet, tokenAccount, lastSignature, err ? String(err).slice(0, 300) : null).run();
  } catch (e) {
    console.error(`[Reconcile] state write failed for ${np.slug}: ${e.message}`);
  }
}

async function reconcileNonprofit(db, env, np, backfill) {
  const result = { slug: np.slug, checked: 0, recorded: 0, skipped_prior: 0, error: null };
  try {
    const tokenAccount = await usdcTokenAccount(env, np.usdc_wallet);
    if (!tokenAccount) {
      // No USDC token account means nobody has ever sent them USDC. Not an error.
      await saveReconcileState(db, np, null, null, null);
      return result;
    }

    const state = await db.prepare(
      `SELECT last_signature FROM wallet_reconcile_state WHERE nonprofit_id = ?1`
    ).bind(np.id).first();

    const opts = { limit: RECONCILE_SIG_LIMIT };
    if (state && state.last_signature) opts.until = state.last_signature;
    const sigs = await solanaRpc(env, 'getSignaturesForAddress', [tokenAccount, opts]);
    result.checked = sigs.length;

    // Oldest first, so the cursor only advances past work that is done.
    const ordered = sigs.slice().reverse();
    let newest = (state && state.last_signature) || null;

    // First sight of a wallet: set the cursor to now and record nothing. These
    // wallets predate the reconciler and their history is not necessarily
    // donations -- a charity may use one wallet for everything. Reinterpreting
    // old transfers as GiveReady donations would silently rewrite the numbers on
    // the progress page. Backfill is available but has to be asked for, per
    // wallet, and looked at: /api/admin/reconcile?slug=<slug>&backfill=1
    if (!state && !backfill) {
      result.skipped_prior = ordered.length;
      const last = ordered.length ? ordered[ordered.length - 1].signature : null;
      await saveReconcileState(db, np, tokenAccount, last, null);
      return result;
    }

    for (const sig of ordered) {
      if (sig.err) { newest = sig.signature; continue; }

      const seen = await db.prepare(
        `SELECT id FROM donations WHERE tx_hash = ?1`
      ).bind(sig.signature).first();
      if (seen) { newest = sig.signature; continue; }

      const tx = await solanaRpc(env, 'getTransaction', [
        sig.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ]);
      const atomic = creditedAtomic(tx, tokenAccount);

      if (atomic > 0) {
        const amount = atomic / Math.pow(10, USDC_DECIMALS);
        const settledAt = sig.blockTime
          ? new Date(sig.blockTime * 1000).toISOString().replace('T', ' ').slice(0, 19)
          : null;
        try {
          await db.prepare(
            `INSERT INTO donations
               (id, nonprofit_id, amount_usdc, amount_atomic, network, tx_hash,
                sender_address, status, source, facilitator_response, settled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'settled', 'onchain', ?8,
                     COALESCE(?9, datetime('now')))`
          ).bind(
            crypto.randomUUID(), np.id, amount, atomic, SOLANA_MAINNET, sig.signature,
            feePayer(tx),
            JSON.stringify({ method: 'onchain-reconcile', token_account: tokenAccount }),
            settledAt,
          ).run();
          result.recorded++;
          await logOnboardingEvent(db, 'donate_reconciled', {
            nonprofit_id: np.id, slug: np.slug,
            reason: `$${amount} USDC observed on chain`,
          });
        } catch (e) {
          // The unique index on tx_hash is the real guard against double
          // counting; a concurrent run losing this race is expected, not a fault.
          if (!/UNIQUE/i.test(e.message || '')) throw e;
        }
      }
      newest = sig.signature;
    }

    await saveReconcileState(db, np, tokenAccount, newest, null);
  } catch (e) {
    result.error = e.message;
    console.error(`[Reconcile] ${np.slug}: ${e.message}`);
    await saveReconcileState(db, np, null, null, e.message);
  }
  return result;
}

export async function reconcileAll(db, env, slug, backfill) {
  const rows = slug
    ? await db.prepare(
        `SELECT id, slug, usdc_wallet FROM nonprofits
         WHERE slug = ?1 AND verified = 1 AND usdc_wallet IS NOT NULL AND usdc_wallet != ''`
      ).bind(slug).all()
    : await db.prepare(
        `SELECT id, slug, usdc_wallet FROM nonprofits
         WHERE verified = 1 AND usdc_wallet IS NOT NULL AND usdc_wallet != ''
         ORDER BY updated_at DESC LIMIT ?1`
      ).bind(RECONCILE_MAX_WALLETS).all();

  const out = [];
  for (const np of (rows.results || [])) {
    out.push(await reconcileNonprofit(db, env, np, backfill));
  }
  return out;
}
