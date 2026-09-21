// wallet-proof-page.js
// 2026-09-21. The signing UI for the wallet ownership proof.
//
// WHY THIS PAGE HAS TO EXIST
// verifyWalletSignature() in wallet-proof.js verifies an ed25519 signature over
// the RAW UTF-8 bytes of the challenge. That is what a wallet's signMessage()
// produces, and it is what the Solana wallet-adapter ecosystem uses.
//
// It is NOT what the `solana` CLI produces. `solana sign-offchain-message` wraps
// the payload in the SIMD-0009 off-chain envelope — a \xff"solana offchain"
// prefix plus version, format and length bytes — and signs THAT. A signature from
// the CLI will therefore fail our check even when the key is correct, which would
// read as "the proof step is broken" rather than "wrong signing method".
//
// So the charity signs in a browser, through their wallet extension. The key
// never leaves the wallet, this page never sees it, and nothing here constructs a
// transaction. Read the page source before signing — that instruction is printed
// on the page itself, because telling someone to connect a wallet to a URL is
// exactly the shape of the attack this project keeps writing about.

export function walletProofPageHTML(slug) {
  const safeSlug = String(slug).replace(/[^a-z0-9-]/gi, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Wallet ownership proof — GiveReady</title>
<style>
  :root { --ink:#0C1825; --gold:#F0C132; --line:#dfe3e8; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
         max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; color: var(--ink); line-height:1.55; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color:#5b6672; margin-top:0; }
  pre { background:#f6f8fa; border:1px solid var(--line); border-radius:8px;
        padding:14px; white-space:pre-wrap; word-break:break-word; font-size:13px; }
  button { background: var(--ink); color:#fff; border:0; border-radius:8px;
           padding:12px 18px; font-size:15px; cursor:pointer; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .safety { border-left:3px solid var(--gold); padding:10px 14px; background:#fffdf5; margin:20px 0; font-size:14px; }
  .ok { color:#0a7d33; font-weight:600; }
  .bad { color:#b3261e; font-weight:600; }
  code { background:#f6f8fa; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<h1>Wallet ownership proof</h1>
<p class="sub">Charity: <code>${safeSlug}</code></p>

<div class="safety">
  <strong>Before you connect anything, read this.</strong><br>
  This page asks your wallet to sign a <em>message</em>. It does not build a transaction,
  cannot move funds, and never sees your private key or seed phrase.
  GiveReady will never ask for either. If any page ever does, close it.<br><br>
  The exact text you are signing is shown below in full before you sign. Read it.
</div>

<h3>1. The message</h3>
<pre id="msg">Loading…</pre>

<h3>2. Sign it</h3>
<p>Requires a Solana wallet extension (Phantom, Solflare, Backpack) holding the address shown above.</p>
<button id="go" disabled>Connect wallet and sign</button>
<p id="status"></p>

<h3>3. Signature</h3>
<pre id="sig">—</pre>
<p style="font-size:13px;color:#5b6672">Submitted automatically. If the automatic step fails, copy the signature above and POST it by hand:<br>
<code>curl -X POST https://giveready.org/api/wallet-proof/${safeSlug} -H 'Content-Type: application/json' -d '{"signature":"&lt;paste&gt;"}'</code></p>

<script>
const SLUG = ${JSON.stringify(safeSlug)};
const API = '/api/wallet-proof/' + SLUG;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf){
  const d=[0];
  for(const byte of buf){let c=byte;
    for(let j=0;j<d.length;j++){c+=d[j]<<8;d[j]=c%58;c=(c/58)|0;}
    while(c>0){d.push(c%58);c=(c/58)|0;}}
  let out='';
  for(const byte of buf){if(byte===0)out+='1';else break;}
  return out + d.reverse().map(x=>B58[x]).join('');
}
const $ = id => document.getElementById(id);
let MESSAGE = null;

(async () => {
  try {
    const r = await fetch(API);
    const j = await r.json();
    if (!r.ok) { $('msg').textContent = 'Error: ' + (j.error || r.status) + (j.note ? '\\n' + j.note : ''); return; }
    MESSAGE = j.message;
    $('msg').textContent = j.message;
    $('go').disabled = false;
  } catch (e) { $('msg').textContent = 'Could not load challenge: ' + e.message; }
})();

$('go').onclick = async () => {
  const provider = window.phantom?.solana || window.solflare || window.backpack || window.solana;
  if (!provider) { $('status').innerHTML = '<span class="bad">No Solana wallet extension found.</span>'; return; }
  $('go').disabled = true;
  $('status').textContent = 'Waiting for the wallet…';
  try {
    await provider.connect();
    // signMessage signs the raw bytes. This is the format the server verifies.
    const encoded = new TextEncoder().encode(MESSAGE);
    const res = await provider.signMessage(encoded, 'utf8');
    const raw = res.signature || res;
    const sig = b58(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
    $('sig').textContent = sig;
    $('status').textContent = 'Signed. Submitting…';

    const post = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: sig }),
    });
    const out = await post.json();
    if (out.verified) {
      $('status').innerHTML = '<span class="ok">Verified.</span> Proved at ' + out.proved_at +
        '.<br><span style="font-size:13px;color:#5b6672">' + (out.scope || '') + '</span>';
    } else {
      $('status').innerHTML = '<span class="bad">Not verified: ' + (out.reason || out.error) +
        '</span><br>Copy the signature above and submit it by hand.';
      $('go').disabled = false;
    }
  } catch (e) {
    $('status').innerHTML = '<span class="bad">' + e.message + '</span>';
    $('go').disabled = false;
  }
};
</script>
</body>
</html>`;
}
