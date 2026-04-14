#!/usr/bin/env node
/**
 * GiveReady x402 Donation Test Script
 *
 * Simulates an AI agent making a real USDC donation via x402 protocol.
 * Uses a local Solana keypair to sign and submit real on-chain transactions.
 *
 * Prerequisites:
 *   npm install @solana/web3.js @solana/spl-token bs58
 *
 * Setup:
 *   1. Create a Solana wallet or use an existing one
 *   2. Fund it with USDC on Solana mainnet (even $10 is enough for testing)
 *   3. Export the private key as base58
 *   4. Set SOLANA_PRIVATE_KEY env var
 *
 * Usage:
 *   # Single donation
 *   SOLANA_PRIVATE_KEY=your_base58_key node scripts/test-donate.js finn-wardman-world-explorer-fund 1
 *
 *   # Multiple donations to prove the flow
 *   SOLANA_PRIVATE_KEY=your_base58_key node scripts/test-donate.js --batch
 *
 * What this proves:
 *   - An "agent" discovers a nonprofit via the GiveReady API
 *   - Requests donation via GET /api/donate/{slug} → receives 402 + payment requirements
 *   - Signs a real Solana USDC transaction
 *   - Submits it via POST /api/donate/{slug} with X-PAYMENT header
 *   - Transaction settles on-chain, verifiable on Solscan
 *   - GiveReady logs the donation with tx hash
 */

const {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  SystemProgram,
} = require('@solana/web3.js');
const splToken = require('@solana/spl-token');
const bs58 = require('bs58');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');

// ── Config ──────────────────────────────────────────────────────────
const API_BASE = 'https://giveready.org';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const AGENT_NAME = 'GiveReadyTestAgent/1.0';

// Batch mode: donate small amounts to multiple nonprofits
const BATCH_DONATIONS = [
  { slug: 'finn-wardman-world-explorer-fund', amount: 1 },
  { slug: 'bridges-for-music', amount: 1 },
  { slug: 'city-kids-surfing', amount: 1 },
  { slug: 'the-wave-project', amount: 1 },
  { slug: 'skateistan', amount: 1 },
];

// ── Helpers ─────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadKeypair() {
  const key = process.env.SOLANA_PRIVATE_KEY;
  const mnemonic = process.env.SOLANA_MNEMONIC;
  const walletIndex = parseInt(process.env.WALLET_INDEX || '0');

  if (!key && !mnemonic) {
    console.error('\nError: Need either SOLANA_PRIVATE_KEY or SOLANA_MNEMONIC.\n');
    console.error('Option 1 — Recovery phrase from Phantom:');
    console.error('  SOLANA_MNEMONIC="word1 word2 word3 ... word12" node scripts/test-donate.js\n');
    console.error('  Use WALLET_INDEX=1 for the second wallet in Phantom (default 0).\n');
    console.error('Option 2 — Base58 private key:');
    console.error('  SOLANA_PRIVATE_KEY=your_base58_key node scripts/test-donate.js\n');
    process.exit(1);
  }

  // Recovery phrase path (Phantom uses BIP44 derivation)
  if (mnemonic) {
    if (!bip39.validateMnemonic(mnemonic.trim())) {
      console.error('Invalid recovery phrase. Should be 12 or 24 words separated by spaces.');
      process.exit(1);
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
    // Phantom derivation path: m/44'/501'/walletIndex'/0'
    const path = `m/44'/501'/${walletIndex}'/0'`;
    const derived = derivePath(path, seed.toString('hex'));
    const keypair = Keypair.fromSeed(derived.key);
    log(`Derived wallet index ${walletIndex} from recovery phrase`);
    log(`Address: ${keypair.publicKey.toBase58()}`);
    return keypair;
  }

  // Private key path
  try {
    // Try base58 first
    const decoded = bs58.decode(key);
    return Keypair.fromSecretKey(decoded);
  } catch (e) {
    try {
      // Try JSON array format
      const arr = JSON.parse(key);
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch (e2) {
      console.error('Could not parse SOLANA_PRIVATE_KEY. Provide base58 or JSON array format.');
      process.exit(1);
    }
  }
}

async function checkBalance(connection, keypair) {
  const ata = await splToken.getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
  try {
    const account = await splToken.getAccount(connection, ata);
    const balance = Number(account.amount) / 1_000_000;
    return balance;
  } catch (e) {
    return 0;
  }
}

// ── Core: x402 donation flow ────────────────────────────────────────

async function donatex402(connection, keypair, slug, amountUSDC) {
  log(`\n════════════════════════════════════════`);
  log(`Donating $${amountUSDC} USDC to ${slug}`);
  log(`════════════════════════════════════════`);

  // Step 1: Agent discovers nonprofit
  log(`Step 1: Discovering nonprofit...`);
  const profileRes = await fetch(`${API_BASE}/api/nonprofits/${slug}`);
  if (!profileRes.ok) {
    log(`  ✗ Nonprofit not found: ${slug}`);
    return null;
  }
  const profile = await profileRes.json();
  log(`  ✓ Found: ${profile.name} (${profile.country})`);
  log(`  Wallet: ${profile.usdc_wallet}`);

  if (!profile.usdc_wallet) {
    log(`  ✗ No USDC wallet configured — skipping`);
    return null;
  }

  // Step 2: Request donation → get 402 + payment requirements
  log(`Step 2: Requesting donation via x402...`);
  const donateRes = await fetch(`${API_BASE}/api/donate/${slug}?amount=${amountUSDC}`, {
    headers: { 'User-Agent': AGENT_NAME },
  });

  if (donateRes.status !== 402) {
    log(`  ✗ Expected 402, got ${donateRes.status}`);
    const body = await donateRes.text();
    log(`  Response: ${body}`);
    return null;
  }

  const paymentRequiredHeader = donateRes.headers.get('X-PAYMENT-REQUIRED');
  if (!paymentRequiredHeader) {
    log(`  ✗ No X-PAYMENT-REQUIRED header in 402 response`);
    return null;
  }

  const paymentReqs = JSON.parse(atob(paymentRequiredHeader));
  const accept = paymentReqs.accepts[0];
  log(`  ✓ Got 402 response with payment requirements`);
  log(`  Pay to: ${accept.payTo}`);
  log(`  Amount: ${accept.maxAmountRequired} atomic USDC ($${Number(accept.maxAmountRequired) / 1_000_000})`);

  // Step 3: Build and sign the Solana USDC transfer
  log(`Step 3: Building Solana transaction...`);
  const amountAtomic = Number(accept.maxAmountRequired);
  const recipientPubkey = new PublicKey(accept.payTo);

  const senderATA = await splToken.getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
  const recipientATA = await splToken.getAssociatedTokenAddress(USDC_MINT, recipientPubkey);

  // Check if recipient ATA exists
  let recipientATAExists = true;
  try {
    await splToken.getAccount(connection, recipientATA);
  } catch (e) {
    recipientATAExists = false;
    log(`  ⚠ Recipient ATA doesn't exist — will need to create it`);
  }

  const transaction = new Transaction();

  // If recipient ATA doesn't exist, create it
  if (!recipientATAExists) {
    transaction.add(
      splToken.createAssociatedTokenAccountInstruction(
        keypair.publicKey,      // payer
        recipientATA,           // ata
        recipientPubkey,        // owner
        USDC_MINT,              // mint
      )
    );
  }

  // Add USDC transfer instruction
  transaction.add(
    splToken.createTransferInstruction(
      senderATA,              // source
      recipientATA,           // destination
      keypair.publicKey,      // authority
      amountAtomic,           // amount in atomic units
    )
  );

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = keypair.publicKey;

  // Sign
  transaction.sign(keypair);

  // Serialize to base64
  const serialized = transaction.serialize();
  const txBase64 = serialized.toString('base64');
  log(`  ✓ Transaction built and signed`);
  log(`  Sender: ${keypair.publicKey.toBase58()}`);

  // Step 4: Submit to GiveReady with X-PAYMENT header
  log(`Step 4: Submitting payment to GiveReady...`);
  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    payload: {
      transaction: txBase64,
    },
  };

  const settleRes = await fetch(`${API_BASE}/api/donate/${slug}?amount=${amountUSDC}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': AGENT_NAME,
      'X-PAYMENT': btoa(JSON.stringify(paymentPayload)),
    },
  });

  const result = await settleRes.json();

  if (settleRes.ok && result.success) {
    log(`  ✓ DONATION SUCCESSFUL!`);
    log(`  TX Hash: ${result.donation.tx_hash}`);
    log(`  Amount: $${result.donation.amount_usdc} USDC`);
    log(`  Confirmed: ${result.donation.confirmed}`);
    log(`  Solscan: https://solscan.io/tx/${result.donation.tx_hash}`);
    return result;
  } else {
    log(`  ✗ Settlement failed: ${result.error || JSON.stringify(result)}`);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const batchMode = args.includes('--batch');
  const dryRun = args.includes('--dry-run');

  const keypair = loadKeypair();
  const connection = new Connection(SOLANA_RPC, 'confirmed');

  log(`Wallet: ${keypair.publicKey.toBase58()}`);

  // Check USDC balance
  const balance = await checkBalance(connection, keypair);
  log(`USDC Balance: $${balance.toFixed(2)}`);

  if (balance < 1) {
    console.error('\nInsufficient USDC balance. Fund your wallet with USDC on Solana mainnet.');
    console.error(`Wallet address: ${keypair.publicKey.toBase58()}`);
    console.error('You can send USDC from Phantom, Coinbase, or any Solana wallet.\n');
    process.exit(1);
  }

  if (dryRun) {
    log('\n--- DRY RUN MODE ---');
    log('Would make the following donations:');
    if (batchMode) {
      for (const d of BATCH_DONATIONS) {
        log(`  $${d.amount} USDC → ${d.slug}`);
      }
      log(`Total: $${BATCH_DONATIONS.reduce((s, d) => s + d.amount, 0)} USDC`);
    } else {
      const slug = args[0];
      const amount = parseFloat(args[1] || '1');
      log(`  $${amount} USDC → ${slug}`);
    }
    log('Remove --dry-run to execute.\n');
    return;
  }

  const results = [];

  if (batchMode) {
    const total = BATCH_DONATIONS.reduce((s, d) => s + d.amount, 0);
    log(`\nBatch mode: ${BATCH_DONATIONS.length} donations, $${total} USDC total`);

    if (balance < total) {
      console.error(`\nInsufficient balance. Need $${total}, have $${balance.toFixed(2)}.`);
      process.exit(1);
    }

    for (const donation of BATCH_DONATIONS) {
      try {
        const result = await donatex402(connection, keypair, donation.slug, donation.amount);
        results.push({ slug: donation.slug, success: !!result, result });
        // Wait between donations to avoid rate limits
        if (BATCH_DONATIONS.indexOf(donation) < BATCH_DONATIONS.length - 1) {
          log('\nWaiting 5 seconds before next donation...');
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (err) {
        log(`  ✗ Error: ${err.message}`);
        results.push({ slug: donation.slug, success: false, error: err.message });
      }
    }
  } else {
    // Single donation
    const slug = args[0];
    const amount = parseFloat(args[1] || '1');

    if (!slug) {
      console.error('\nUsage:');
      console.error('  node scripts/test-donate.js <nonprofit-slug> [amount]');
      console.error('  node scripts/test-donate.js --batch');
      console.error('  node scripts/test-donate.js --batch --dry-run');
      console.error('\nExamples:');
      console.error('  node scripts/test-donate.js finn-wardman-world-explorer-fund 5');
      console.error('  node scripts/test-donate.js bridges-for-music 1\n');
      process.exit(1);
    }

    try {
      const result = await donatex402(connection, keypair, slug, amount);
      results.push({ slug, success: !!result, result });
    } catch (err) {
      log(`  ✗ Error: ${err.message}`);
      results.push({ slug, success: false, error: err.message });
    }
  }

  // Summary
  log(`\n════════════════════════════════════════`);
  log(`DONATION SUMMARY`);
  log(`════════════════════════════════════════`);
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  log(`Successful: ${successful.length}`);
  log(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    log(`\nOn-chain transactions (verify on Solscan):`);
    for (const r of successful) {
      log(`  ${r.slug}: https://solscan.io/tx/${r.result.donation.tx_hash}`);
    }
  }

  if (failed.length > 0) {
    log(`\nFailed:`);
    for (const r of failed) {
      log(`  ${r.slug}: ${r.error || 'no wallet configured'}`);
    }
  }

  // Check updated donation history
  log(`\nVerifying via API...`);
  for (const r of successful) {
    const histRes = await fetch(`${API_BASE}/api/donations/${r.slug}`);
    const hist = await histRes.json();
    log(`  ${r.slug}: $${hist.total_donated_usdc} USDC total, ${hist.donation_count} donations`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
