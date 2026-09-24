#!/usr/bin/env node
// sign-wallet-proof.mjs
// 2026-09-21. Offline signer for the GiveReady wallet ownership proof.
//
// WHY THIS EXISTS
// The browser page at /wallet-proof/<slug> needs a Solana wallet EXTENSION to be
// injected into the page. If the key lives on a phone, or in a browser without
// the extension, that page reports "No Solana wallet extension found" and there
// is no way through it. This script is the path that needs no extension.
//
// WHY NOT `solana sign-offchain-message`
// That command wraps the payload in the SIMD-0009 off-chain envelope (a \xff
// "solana offchain" prefix plus version, format and length bytes) and signs THAT.
// The server verifies a signature over the RAW UTF-8 bytes of the message, so a
// CLI signature fails even with the correct key. This script signs the raw bytes,
// which is what the server checks and what a wallet's signMessage() produces.
//
// YOUR KEY NEVER LEAVES THIS MACHINE
// The keypair is read from a local file you name, used in memory to produce one
// 64-byte signature, and never written, logged or transmitted. The only thing
// that goes anywhere is the signature and, if you pass --submit, it goes to
// giveready.org. Read this file before running it — that is the correct habit
// for anything that touches a key, including this.
//
// USAGE
//   node scripts/sign-wallet-proof.mjs --keypair ~/.config/solana/id.json
//   node scripts/sign-wallet-proof.mjs --keypair ~/wef-key.json --submit
//   node scripts/sign-wallet-proof.mjs --keypair <path> --slug some-other-charity
//
// ACCEPTED KEY FORMATS
//   * Solana CLI JSON: a 64-number array (secret || public), the id.json format
//   * Base58 secret key: the string Phantom gives you under Export Private Key
//     (64 bytes decoded). Put it alone in a file.
//
// SAFETY CHECK
// Before signing, the script derives the public key and refuses to continue
// unless it matches the address the server has on file. That makes it impossible
// to accidentally prove the wrong wallet.

import { readFileSync } from 'node:fs';
import { webcrypto as wc } from 'node:crypto';

const args = process.argv.slice(2);
const argv = (name, def = null) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const KEYPAIR = argv('--keypair');
const SLUG = argv('--slug', 'finn-wardman-world-explorer-fund');
const BASE = argv('--base', 'https://www.giveready.org');
const SUBMIT = args.includes('--submit');

if (!KEYPAIR) {
  console.error('Missing --keypair <path>. Run with no args for usage in the header of this file.');
  process.exit(1);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58MAP = new Map([...B58].map((c, i) => [c, i]));

function b58decode(str) {
  const bytes = [0];
  for (const ch of str.trim()) {
    const v = B58MAP.get(ch);
    if (v === undefined) throw new Error(`bad base58 char: ${ch}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function b58encode(buf) {
  const d = [0];
  for (const byte of buf) {
    let c = byte;
    for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let out = '';
  for (const byte of buf) { if (byte === 0) out += '1'; else break; }
  return out + d.reverse().map((x) => B58[x]).join('');
}

// Read the key and normalise to a 32-byte ed25519 seed.
function loadSeed(path) {
  const raw = readFileSync(path.replace(/^~/, process.env.HOME), 'utf8').trim();
  let bytes;
  if (raw.startsWith('[')) {
    bytes = Uint8Array.from(JSON.parse(raw));
  } else {
    bytes = b58decode(raw.replace(/^["']|["']$/g, ''));
  }
  if (bytes.length === 64) return bytes.slice(0, 32); // secret || public
  if (bytes.length === 32) return bytes;
  throw new Error(`unexpected key length ${bytes.length}; expected 32 or 64 bytes`);
}

// Wrap a raw ed25519 seed in the minimal PKCS#8 DER envelope WebCrypto expects.
// Fixed 16-byte prefix: SEQUENCE, version 0, AlgorithmIdentifier 1.3.101.112,
// OCTET STRING (0x04 0x20) then the 32-byte seed.
function pkcs8(seed) {
  const prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const out = new Uint8Array(prefix.length + 32);
  out.set(prefix, 0);
  out.set(seed, prefix.length);
  return out;
}

const seed = loadSeed(KEYPAIR);
const priv = await wc.subtle.importKey('pkcs8', pkcs8(seed), { name: 'Ed25519' }, true, ['sign']);

// Derive the public key by signing a probe and recovering it from the JWK.
const jwk = await wc.subtle.exportKey('jwk', priv);
const pubBytes = Uint8Array.from(Buffer.from(jwk.x, 'base64url'));
const derived = b58encode(pubBytes);

// Fetch the challenge.
const url = `${BASE}/api/wallet-proof/${SLUG}`;
const res = await fetch(url);
const challenge = await res.json();
if (!res.ok) {
  console.error('Could not get a challenge:', challenge);
  process.exit(1);
}

console.log('Wallet on file :', challenge.wallet);
console.log('Key you gave me:', derived);
if (challenge.wallet !== derived) {
  console.error('\nSTOP. These do not match, so this key does not control the published address.');
  console.error('Nothing has been signed. Either you pointed at the wrong keypair file, or the');
  console.error('address on the profile is not the one you hold. Resolve that before continuing.');
  process.exit(2);
}
console.log('Match confirmed.\n');

console.log('--- message being signed ---');
console.log(challenge.message);
console.log('--- end ---\n');

const sigBytes = new Uint8Array(
  await wc.subtle.sign({ name: 'Ed25519' }, priv, new TextEncoder().encode(challenge.message)),
);
const signature = b58encode(sigBytes);

console.log('Signature:', signature, '\n');

if (!SUBMIT) {
  console.log('Not submitted (no --submit). To send it:');
  console.log(`  curl -X POST ${url} -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"signature":"${signature}"}'`);
  process.exit(0);
}

const post = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signature }),
});
const out = await post.json();
console.log(out.verified ? 'VERIFIED at ' + out.proved_at : 'NOT VERIFIED: ' + JSON.stringify(out));
process.exit(out.verified ? 0 : 3);
