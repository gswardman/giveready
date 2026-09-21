// wallet-proof.js
// 2026-09-21. Prove a charity controls the wallet published on its profile.
//
// WHY THIS EXISTS
// The `wallet_signature` column has been in the schema since migration 001,
// described there as "proof of wallet ownership". Nothing ever wrote to it. The
// onboarding handler accepted a `wallet_signature` field and console.logged it
// under the comment "for future verification". Every charity in the directory
// therefore publishes a payable address with no evidence anyone owns it.
//
// That is the second check in the order a careful donor agent runs — recipient
// exists, WALLET CONTROL, recipient-to-wallet linkage, then need plausibility.
// u/causeclaw's published rule is that a unique wallet is routing hygiene, not
// trust. An unsigned address is a string on a web page. A signed one is a claim
// the charity has put its key behind.
//
// WHAT IT IS NOT
// This proves control of a keypair. It does not prove the keypair belongs to the
// charity rather than to whoever edited the profile. That linkage is the third
// check and comes from the record: a verified profile, a confirmed registration
// number, a contact address on the charity's own domain. Do not let a green tick
// here be read as the whole answer.
//
// SECURITY NOTES
//  * Offline message signing only. Nothing here constructs, requests or submits a
//    transaction, and the challenge text says so where the signer will read it.
//  * The challenge is bound to domain, slug and address, so a signature harvested
//    for one purpose cannot be replayed onto another charity or another site.
//  * Single-use nonce with a short expiry.
//  * Ed25519 via WebCrypto, which Cloudflare Workers supports natively. No new
//    dependency and no hand-rolled curve arithmetic.

// Base58 decode, inlined rather than imported. `bs58` is in package.json but
// src/index.js has no imports at all — it is one self-contained module — and this
// file cannot be test-deployed from the Cowork sandbox, which has no route to the
// Cloudflare API. Twenty lines here is cheaper than a bundling surprise on a live
// worker that serves the whole directory.
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = (() => {
  const m = new Map();
  for (let i = 0; i < B58_ALPHABET.length; i++) m.set(B58_ALPHABET[i], i);
  return m;
})();

function base58Decode(str) {
  if (typeof str !== 'string' || str.length === 0) throw new Error('empty');
  const bytes = [0];
  for (const ch of str) {
    const val = B58_MAP.get(ch);
    if (val === undefined) throw new Error(`bad base58 char: ${ch}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's are leading zero bytes.
  for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

const DOMAIN = 'giveready.org';
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Build the exact text the charity signs. This string is the contract: it is
 * stored verbatim and re-derived at verification time. Changing its formatting
 * invalidates every outstanding challenge, which is why it is pinned here and
 * not assembled at the call site.
 */
export function buildChallenge({ name, slug, wallet, nonce, issuedAt }) {
  const issued = new Date(issuedAt).toISOString();
  const expires = new Date(issuedAt + CHALLENGE_TTL_MS).toISOString();
  return [
    'GiveReady wallet ownership proof',
    '',
    `Charity: ${name}`,
    `Slug: ${slug}`,
    `Wallet: ${wallet}`,
    `Domain: ${DOMAIN}`,
    `Nonce: ${nonce}`,
    `Issued: ${issued}`,
    `Expires: ${expires}`,
    '',
    'Signing this message proves you control this wallet.',
    'It does not authorise a transaction and moves no funds.',
  ].join('\n');
}

export function newNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify an ed25519 signature over the challenge, using the wallet address
 * itself as the public key. On Solana the account address IS the ed25519 public
 * key in base58, so no key registry is needed.
 *
 * Returns { ok, reason }. Never throws on bad input: malformed base58 from an
 * untrusted caller is an expected condition, not an exception.
 */
export async function verifyWalletSignature({ wallet, message, signature }) {
  let pubkey;
  let sig;

  try {
    pubkey = base58Decode(wallet);
  } catch {
    return { ok: false, reason: 'wallet_not_base58' };
  }
  if (pubkey.length !== 32) return { ok: false, reason: 'wallet_wrong_length' };

  // Accept base58 (what Phantom/Solflare hand back) or base64, because people
  // paste whatever their wallet app copied and a rejection here reads as "the
  // proof step is broken" rather than "wrong encoding".
  try {
    sig = base58Decode(signature);
  } catch {
    try {
      sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    } catch {
      return { ok: false, reason: 'signature_not_base58_or_base64' };
    }
  }
  if (sig.length !== 64) return { ok: false, reason: 'signature_wrong_length' };

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      pubkey,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sig,
      new TextEncoder().encode(message),
    );
    return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch (e) {
    return { ok: false, reason: `verify_failed:${e.message}` };
  }
}

/**
 * GET /api/wallet-proof/:slug
 * Issue a challenge. Safe to call repeatedly; the newest outstanding challenge
 * for a slug is the only one that verifies.
 */
export async function handleIssueChallenge(db, slug) {
  const np = await db
    .prepare('SELECT id, name, slug, usdc_wallet FROM nonprofits WHERE slug = ?1')
    .bind(slug)
    .first();

  if (!np) return { status: 404, body: { error: 'nonprofit_not_found', slug } };
  if (!np.usdc_wallet) {
    return {
      status: 400,
      body: {
        error: 'no_wallet_on_file',
        slug,
        note: 'Add a Solana USDC wallet to the profile before proving control of it.',
      },
    };
  }

  const nonce = newNonce();
  const issuedAt = Date.now();
  const message = buildChallenge({
    name: np.name,
    slug: np.slug,
    wallet: np.usdc_wallet,
    nonce,
    issuedAt,
  });

  await db
    .prepare(
      `INSERT OR REPLACE INTO wallet_proof_challenges
         (nonprofit_id, nonce, wallet, message, issued_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(np.id, nonce, np.usdc_wallet, message, issuedAt, issuedAt + CHALLENGE_TTL_MS)
    .run();

  return {
    status: 200,
    body: {
      slug: np.slug,
      wallet: np.usdc_wallet,
      message,
      expires_at: new Date(issuedAt + CHALLENGE_TTL_MS).toISOString(),
      how_to_sign: [
        'Open the wallet that holds this address.',
        'Use its "sign message" function (Phantom: Settings then Sign Message; Squads: propose an off-chain message signature).',
        'Paste the message above EXACTLY, including line breaks.',
        'POST the resulting signature back to this same URL as {"signature":"..."}.',
      ],
      safety: 'This is an offline message signature. It authorises no transaction and moves no funds. GiveReady never asks for a private key or seed phrase.',
    },
  };
}

/**
 * POST /api/wallet-proof/:slug  {"signature": "..."}
 * Verify and record. Idempotent: re-proving an already-proven wallet is fine.
 */
export async function handleVerifyChallenge(db, slug, signature) {
  if (!signature || typeof signature !== 'string') {
    return { status: 400, body: { error: 'signature_required' } };
  }

  const row = await db
    .prepare(
      `SELECT c.nonprofit_id, c.nonce, c.wallet, c.message, c.expires_at, n.usdc_wallet, n.slug
         FROM wallet_proof_challenges c
         JOIN nonprofits n ON n.id = c.nonprofit_id
        WHERE n.slug = ?1
        ORDER BY c.issued_at DESC
        LIMIT 1`,
    )
    .bind(slug)
    .first();

  if (!row) return { status: 404, body: { error: 'no_outstanding_challenge', slug } };
  if (Date.now() > row.expires_at) {
    return { status: 400, body: { error: 'challenge_expired', note: 'Request a new one with GET.' } };
  }
  // The address may have been edited between issue and verify. Proving the old
  // one must not mark the new one verified.
  if (row.wallet !== row.usdc_wallet) {
    return { status: 409, body: { error: 'wallet_changed_since_challenge', note: 'Request a new challenge.' } };
  }

  const result = await verifyWalletSignature({
    wallet: row.wallet,
    message: row.message,
    signature: signature.trim(),
  });

  if (!result.ok) {
    return { status: 400, body: { verified: false, reason: result.reason } };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE nonprofits
          SET wallet_signature      = ?1,
              wallet_type           = COALESCE(wallet_type, 'self_custody'),
              wallet_proved_at      = ?2,
              wallet_proof_message  = ?3
        WHERE id = ?4`,
    )
    .bind(signature.trim(), now, row.message, row.nonprofit_id)
    .run();

  await db
    .prepare('DELETE FROM wallet_proof_challenges WHERE nonprofit_id = ?1')
    .bind(row.nonprofit_id)
    .run();

  return {
    status: 200,
    body: {
      verified: true,
      slug: row.slug,
      wallet: row.wallet,
      proved_at: new Date(now * 1000).toISOString(),
      scope: 'Proves control of this keypair. Does not by itself prove the keypair belongs to the charity; read it alongside registry_status and verification_status.',
    },
  };
}
