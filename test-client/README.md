# X402 GiveReady Test Client

A Node.js script that tests GiveReady's donation endpoint using the X402 payment protocol with Solana USDC.

## Setup

```bash
npm install
```

## Verify Mode (no payment)

Just check the 402 response and payment requirements:

```bash
node test-donate.js
```

Or explicitly:

```bash
node test-donate.js --verify
```

This hits the endpoint, receives the 402 response, parses the X-PAYMENT-REQUIRED header, and displays what's needed.

## Payment Mode

Actually sign and submit a Solana USDC payment:

```bash
SOLANA_PRIVATE_KEY=<base58-encoded-keypair> node test-donate.js
```

The script will build a v0 transaction, sign it, and send it back in the X-PAYMENT header.

## Environment Variables

- `DONATE_ENDPOINT` — donation endpoint URL (default: finn-wardman-world-explorer-fund on giveready.geordie-08d.workers.dev)
- `DONATE_AMOUNT` — amount in USDC (default: 0.01)
- `SOLANA_PRIVATE_KEY` — base58-encoded keypair for signing payments (optional; if not set, verify mode only)

## Example Usage

Verify the endpoint is working:

```bash
node test-donate.js
```

Test against a different endpoint:

```bash
DONATE_ENDPOINT=https://example.com/api/donate/nonprofit \
  node test-donate.js
```

Make an actual payment (requires SOLANA_PRIVATE_KEY):

```bash
SOLANA_PRIVATE_KEY=<your-keypair> \
  DONATE_AMOUNT=0.05 \
  node test-donate.js
```

## What It Does

1. Makes a GET request to the donation endpoint with `?amount=X` query parameter
2. Receives a 402 Payment Required response
3. Decodes the X-PAYMENT-REQUIRED header (base64-encoded JSON) to get payment details
4. Displays the payment requirements in readable format
5. If SOLANA_PRIVATE_KEY is set, builds and signs a Solana token transfer transaction
6. Retries the request with X-PAYMENT header containing the signed transaction
7. Reports success or failure

## Payment Details

- Chain: Solana mainnet
- Token: USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
- RPC: https://api.mainnet-beta.solana.com
- Facilitator: https://x402.org/facilitator

## Dependencies

- `@solana/web3.js` — transaction building and signing
- `@solana/spl-token` — token transfer instruction creation
- `bs58` — base58 encoding/decoding for keypairs
- `tweetnacl` — cryptographic signatures
