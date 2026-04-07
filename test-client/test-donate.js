#!/usr/bin/env node

/**
 * X402 GiveReady Donation Test Client
 *
 * Verify mode (default): hits the endpoint, decodes the 402, shows payment requirements
 * Payment mode: signs a USDC transfer and submits via x402
 *
 * Usage:
 *   node test-donate.js                              # verify mode
 *   SOLANA_PRIVATE_KEY=<bs58> node test-donate.js     # payment mode
 *   DONATE_AMOUNT=5 node test-donate.js               # custom amount
 */

import { PublicKey, Keypair, Connection, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

// ============================================
// CONFIG
// ============================================

const CONFIG = {
  endpoint: process.env.DONATE_ENDPOINT || 'https://giveready.geordie-08d.workers.dev/api/donate/finn-wardman-world-explorer-fund',
  amount: process.env.DONATE_AMOUNT ? parseFloat(process.env.DONATE_AMOUNT) : 0.01,
  rpcUrl: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  facilitatorUrl: 'https://x402.org/facilitator',
  usdcMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  usdcDecimals: 6,
};

// ============================================
// STEP 1: HIT ENDPOINT, GET 402
// ============================================

async function getPaymentRequirements(endpoint, amount) {
  const url = `${endpoint}?amount=${amount}`;
  console.log(`GET ${url}\n`);

  const response = await fetch(url);
  console.log(`Status: ${response.status}`);

  // Show relevant headers
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase().includes('payment')) {
      console.log(`  ${key}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
    }
  }

  if (response.status !== 402) {
    const body = await response.text();
    console.log(`\nExpected 402, got ${response.status}`);
    console.log('Body:', body);
    return null;
  }

  // Parse the body (our endpoint returns JSON with error message)
  const body = await response.json();
  console.log('\nResponse body:');
  console.log(JSON.stringify(body, null, 2));

  // Decode X-PAYMENT-REQUIRED header
  const header = response.headers.get('x-payment-required');
  if (!header) {
    console.log('\nNo X-PAYMENT-REQUIRED header found.');
    return null;
  }

  let requirements;
  try {
    requirements = JSON.parse(atob(header));
  } catch (e) {
    console.log(`\nFailed to decode header: ${e.message}`);
    console.log('Raw header:', header);
    return null;
  }

  return requirements;
}

function displayRequirements(req) {
  console.log('\n=== PAYMENT REQUIREMENTS ===\n');
  console.log('x402 Version:', req.x402Version);

  if (req.accepts && req.accepts.length > 0) {
    const accept = req.accepts[0];
    console.log('Scheme:', accept.scheme);
    console.log('Network:', accept.network);
    console.log('Amount (atomic):', accept.maxAmountRequired);
    console.log('Amount (USDC):', `$${parseInt(accept.maxAmountRequired) / 1_000_000}`);
    console.log('Pay to:', accept.payTo);
    console.log('Asset:', accept.asset);
    console.log('Description:', accept.description);
    console.log('Timeout:', accept.maxTimeoutSeconds, 'seconds');
    if (accept.extra) {
      console.log('Nonprofit:', accept.extra.name);
      console.log('Slug:', accept.extra.slug);
      console.log('Nonce:', accept.extra.nonce);
    }
  } else {
    console.log('Full requirements:');
    console.log(JSON.stringify(req, null, 2));
  }
}

// ============================================
// STEP 2: BUILD PAYMENT TRANSACTION
// ============================================

async function buildPaymentTransaction(requirements, signer) {
  const accept = requirements.accepts[0];
  const recipientWallet = new PublicKey(accept.payTo);
  const amountAtomic = BigInt(accept.maxAmountRequired);

  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');

  // Get associated token accounts for sender and recipient
  const senderATA = await getAssociatedTokenAddress(
    CONFIG.usdcMint,
    signer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const recipientATA = await getAssociatedTokenAddress(
    CONFIG.usdcMint,
    recipientWallet,
    true, // allowOwnerOffCurve for recipient
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log('Sender wallet:', signer.publicKey.toBase58());
  console.log('Sender USDC ATA:', senderATA.toBase58());
  console.log('Recipient wallet:', recipientWallet.toBase58());
  console.log('Recipient USDC ATA:', recipientATA.toBase58());
  console.log('Amount:', amountAtomic.toString(), 'atomic USDC');

  // Check sender balance
  try {
    const balance = await connection.getTokenAccountBalance(senderATA);
    console.log('Sender USDC balance:', balance.value.uiAmountString, 'USDC');

    if (BigInt(balance.value.amount) < amountAtomic) {
      throw new Error(`Insufficient USDC balance. Have ${balance.value.uiAmountString}, need ${Number(amountAtomic) / 1_000_000}`);
    }
  } catch (e) {
    if (e.message.includes('Insufficient')) throw e;
    console.log('Warning: Could not check balance:', e.message);
  }

  // Build the transfer instruction
  const transferIx = createTransferCheckedInstruction(
    senderATA,        // source
    CONFIG.usdcMint,  // mint
    recipientATA,     // destination
    signer.publicKey,  // owner
    amountAtomic,     // amount (atomic)
    CONFIG.usdcDecimals, // decimals
    [],                  // multisigners
    TOKEN_PROGRAM_ID
  );

  // Build versioned transaction
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const messageV0 = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [transferIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([signer]);

  console.log('Transaction built and signed.');

  return {
    serialized: Buffer.from(tx.serialize()).toString('base64'),
    blockhash,
    lastValidBlockHeight,
  };
}

// ============================================
// STEP 3: SUBMIT PAYMENT
// ============================================

async function submitPayment(endpoint, amount, requirements, serializedTx) {
  // Encode as X-PAYMENT header
  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: requirements.accepts[0].network,
    payload: {
      transaction: serializedTx,
      nonce: requirements.accepts[0].extra?.nonce,
    },
  };

  const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  console.log('\nRetrying with X-PAYMENT header...');

  const url = `${endpoint}?amount=${amount}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-PAYMENT': xPayment,
      'Content-Type': 'application/json',
    },
  });

  console.log(`Status: ${response.status}`);

  const body = await response.json();
  console.log('Response:', JSON.stringify(body, null, 2));

  // Check for payment response header
  const paymentResponse = response.headers.get('x-payment-response');
  if (paymentResponse) {
    try {
      const decoded = JSON.parse(atob(paymentResponse));
      console.log('\nSettlement receipt:', JSON.stringify(decoded, null, 2));
    } catch (e) {
      console.log('\nPayment response header:', paymentResponse);
    }
  }

  return { status: response.status, body };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('GiveReady x402 Donation Test Client\n');
  console.log('Endpoint:', CONFIG.endpoint);
  console.log('Amount: $' + CONFIG.amount, 'USDC');

  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  console.log('Mode:', privateKey ? 'PAYMENT (will send real USDC)' : 'VERIFY ONLY');
  console.log('---\n');

  // Step 1: Get 402 response
  console.log('=== STEP 1: REQUEST PAYMENT REQUIREMENTS ===\n');
  const requirements = await getPaymentRequirements(CONFIG.endpoint, CONFIG.amount);

  if (!requirements) {
    console.log('\nCould not get payment requirements. Check endpoint.');
    process.exit(1);
  }

  displayRequirements(requirements);

  // Verify only mode
  if (!privateKey) {
    console.log('\n---');
    console.log('Verify complete. To make a real payment:');
    console.log('  SOLANA_PRIVATE_KEY=<your-bs58-key> node test-donate.js');
    console.log('\nThe private key must be for a wallet with USDC on Solana mainnet.');
    return;
  }

  // Step 2: Build and sign payment
  console.log('\n=== STEP 2: BUILD PAYMENT TRANSACTION ===\n');

  let signer;
  try {
    signer = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (e) {
    console.error('Invalid private key:', e.message);
    process.exit(1);
  }

  const { serialized } = await buildPaymentTransaction(requirements, signer);

  // Step 3: Submit
  console.log('\n=== STEP 3: SUBMIT PAYMENT ===');
  const result = await submitPayment(CONFIG.endpoint, CONFIG.amount, requirements, serialized);

  if (result.status === 200) {
    console.log('\n✅ Donation successful!');
    if (result.body?.donation?.tx_hash) {
      console.log(`TX: https://solscan.io/tx/${result.body.donation.tx_hash}`);
    }
  } else {
    console.log('\n❌ Payment not accepted. Status:', result.status);
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
