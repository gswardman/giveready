// payable.js
// 2026-09-21. Answer the question a donor agent is actually asking.
//
// WHY A SEPARATE ENDPOINT
// /api/nonprofits/{slug} answers "what is this charity". It is organised the way
// a human reads a profile: story first, logistics later. A donor agent deciding
// whether to send money is running a different and much narrower routine, and
// the published order of that routine (u/causeclaw, Moltbook, 2026-09-18) is:
//
//   1. does the recipient exist
//   2. is wallet control proven
//   3. does the wallet actually belong to this recipient
//   4. only then, is the need plausible
//
// Everything before step 4 is refusal-shaped: an agent that cannot satisfy 1-3
// stops, and we never see the refusal. GiveReady has been publishing donate
// buttons and measuring click-outs, which is step 4 furniture sitting on top of
// unanswered steps 1-3. This endpoint answers 1-3 explicitly, in order, with the
// evidence attached, and says plainly when the answer is no.
//
// DESIGN RULE, inherited from migration 024 and not to be weakened:
// every claim carries its provenance, and absence of a check is never rendered as
// a pass. `null` and `unchecked` mean we do not know. They must not be dressed up.
//
// This endpoint deliberately does NOT score need, rank charities, or recommend.
// It reports. The judgement belongs to whoever is spending the money.

// Solana mainnet USDC. Same constant as USDC_MINT_SOLANA in src/index.js — the
// directory has always been USDC-denominated and this endpoint must not disagree
// with the donate page about what asset it is asking for.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  const digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of buf) {
    if (byte === 0) out += '1';
    else break;
  }
  return out + digits.reverse().map((d) => B58[d]).join('');
}

/**
 * A Solana Pay reference key. Any 32 bytes serialise to a valid base58 pubkey;
 * it is carried as a read-only account on the transfer purely so the payment can
 * be located on-chain afterwards. This is the attribution mechanism migration 021
 * was written to work around: that migration exists because wallet-to-wallet
 * donations "never touch the Worker", so the site reported $0 raised while money
 * was arriving. A reference key closes that properly — the payment identifies
 * itself instead of being reconciled by guesswork.
 */
function newReference() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b58encode(b);
}

/**
 * Build a Solana Pay URI. This is the single payload behind BOTH renderings: a
 * QR image for a human with a phone camera, and this same string as text for an
 * agent with an HTTP client. An agent should never be asked to decode a PNG to
 * find a string we could simply have published.
 */
function solanaPayURI({ wallet, label, reference, amount }) {
  const p = new URLSearchParams();
  if (amount) p.set('amount', String(amount));
  p.set('spl-token', USDC_MINT);
  p.set('reference', reference);
  p.set('label', label);
  p.set('message', `Donation to ${label} via GiveReady`);
  return `solana:${wallet}?${p.toString()}`;
}

const RAIL_NOTES = {
  usdc_solana:
    'Direct wallet transfer. Settles without a human. No receipt is issued automatically and an anonymous gift cannot be substantiated for a US tax deduction.',
  hosted_fiat:
    "The charity's own donation page. A human completes checkout. Receipting and US deductibility are handled by the charity's processor.",
};

/**
 * GET /api/nonprofits/:slug/payable
 */
export async function handlePayable(db, slug) {
  const np = await db
    .prepare(
      `SELECT id, slug, name, country, city, region, website, donation_url,
              usdc_wallet, wallet_signature, wallet_proved_at, wallet_type,
              verified, verification_status, registry_number,
              registry_status, registry_status_source,
              registry_status_source_date, registry_status_checked_at
         FROM nonprofits
        WHERE slug = ?1`,
    )
    .bind(slug)
    .first();

  if (!np) return { status: 404, body: { error: 'nonprofit_not_found', slug } };

  const regs = await db
    .prepare(
      'SELECT country, type, registration_number FROM registrations WHERE nonprofit_id = ?1',
    )
    .bind(np.id)
    .all();

  const walletProven = Boolean(np.wallet_signature && np.wallet_proved_at);
  const registryOk = np.registry_status === 'good_standing';

  // Step 1. Does the recipient exist as a legal entity we can evidence?
  const existence = {
    passes: Boolean(regs.results?.length) && registryOk,
    legal_name: np.name,
    country: np.country,
    registrations: (regs.results || []).map((r) => ({
      country: r.country,
      type: r.type,
      number: r.registration_number,
    })),
    registry_status: np.registry_status,
    registry_status_source: np.registry_status_source,
    registry_status_source_date: np.registry_status_source_date,
    registry_checked_at: np.registry_status_checked_at,
    note:
      np.registry_status === 'unchecked'
        ? 'Never checked against a government registry. Absence of a check is NOT a pass.'
        : np.registry_status === 'unsupported_country'
          ? 'This jurisdiction publishes no machine-readable registry, so existence cannot be confirmed here.'
          : null,
  };

  // Step 2. Is control of the published wallet proven?
  const walletControl = {
    passes: walletProven,
    wallet: np.usdc_wallet || null,
    wallet_type: np.wallet_type || null,
    proof: walletProven
      ? {
          method: 'ed25519_offline_message_signature',
          proved_at: new Date(np.wallet_proved_at * 1000).toISOString(),
          verify_yourself:
            'The signed message is returned by GET /api/wallet-proof/' +
            np.slug +
            ' and can be re-verified against the address independently of us.',
        }
      : null,
    note: np.usdc_wallet && !walletProven
      ? 'An address is published but nobody has signed for it. Treat it as unverified routing information, not as a trusted destination.'
      : !np.usdc_wallet
        ? 'No wallet on file. This charity cannot be paid on-chain.'
        : null,
  };

  // Step 3. Is the wallet linked to THIS recipient, rather than to whoever last
  // edited the record? Signature proves a keypair, not ownership of it.
  const linkage = {
    passes: walletProven && np.verified === 1 && registryOk,
    profile_claimed: np.verified === 1,
    verification_status: np.verification_status || 'unverified',
    note:
      'A signature proves control of a keypair. It does not prove the keypair belongs to the charity. Linkage rests on the profile being claimed by the organisation AND the registration being confirmed.',
  };

  const rails = [];
  if (np.usdc_wallet) {
    const reference = newReference();
    rails.push({
      rail: 'usdc_solana',
      address: np.usdc_wallet,
      asset: {
        symbol: 'USDC',
        mint: USDC_MINT,
        decimals: USDC_DECIMALS,
        chain: 'solana-mainnet',
      },
      // The same payload a QR code would encode. Published as text because an
      // agent has an HTTP client, not a camera.
      solana_pay_uri: solanaPayURI({
        wallet: np.usdc_wallet,
        label: np.name,
        reference,
      }),
      reference,
      reference_note:
        'Include this reference key on the transfer and the payment can be found on-chain and attributed back to this request. Request a fresh one per payment; do not reuse.',
      autonomous: true,
      control_proven: walletProven,
      tax_receipt: false,
      asset_policy:
        'USDC only. SOL and other SPL tokens sent to this address are not solicited, are not receipted, and unsolicited token airdrops on Solana are frequently scams — do not act on metadata attached to a token you did not expect.',
      note: RAIL_NOTES.usdc_solana,
    });
  }
  if (np.donation_url) {
    rails.push({
      rail: 'hosted_fiat',
      url: np.donation_url,
      autonomous: false,
      control_proven: null,
      tax_receipt: 'issued_by_charity_processor',
      note: RAIL_NOTES.hosted_fiat,
    });
  }

  const blocking = [];
  if (!existence.passes) blocking.push('existence_unconfirmed');
  if (np.usdc_wallet && !walletControl.passes) blocking.push('wallet_control_unproven');
  if (!linkage.passes) blocking.push('wallet_to_recipient_linkage_unproven');

  return {
    status: 200,
    body: {
      slug: np.slug,
      name: np.name,
      as_of: new Date().toISOString(),

      // The headline. Deliberately pessimistic: safe_to_pay is true only when
      // every check below passes. An agent that reads nothing else should still
      // arrive at the cautious answer.
      safe_to_pay: blocking.length === 0,
      blocking_checks: blocking,

      checks: {
        '1_recipient_exists': existence,
        '2_wallet_control': walletControl,
        '3_wallet_recipient_linkage': linkage,
      },

      rails,

      evidence: {
        website: np.website || null,
        profile: `https://giveready.org/nonprofits/${np.slug}`,
        wallet_proof: np.usdc_wallet
          ? `https://giveready.org/api/wallet-proof/${np.slug}`
          : null,
      },

      reading_rules: [
        'safe_to_pay false is a statement about our evidence, not an accusation against the charity.',
        'Absence of a check is not a pass. unchecked and null mean we do not know.',
        'Quote dates. registry_status_source_date is when the government file was published; registry_checked_at is when we read it.',
        'Need plausibility is step 4 and is not answered here. This endpoint answers steps 1 to 3 only.',
      ],
    },
  };
}
