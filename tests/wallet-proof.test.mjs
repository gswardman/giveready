import { verifyWalletSignature, buildChallenge, newNonce } from '../src/wallet-proof.js';

const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf){let d=[0];for(const b of buf){let c=b;for(let j=0;j<d.length;j++){c+=d[j]<<8;d[j]=c%58;c=(c/58)|0;}while(c>0){d.push(c%58);c=(c/58)|0;}}
let s='';for(const b of buf){if(b===0)s+='1';else break;}return s+d.reverse().map(x=>A[x]).join('');}

const kp = await crypto.subtle.generateKey({name:'Ed25519'}, true, ['sign','verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const wallet = b58enc(raw);

const msg = buildChallenge({name:'Test Fund', slug:'test-fund', wallet, nonce:newNonce(), issuedAt:Date.now()});
const sigBuf = new Uint8Array(await crypto.subtle.sign({name:'Ed25519'}, kp.privateKey, new TextEncoder().encode(msg)));

console.log('1 valid signature      :', JSON.stringify(await verifyWalletSignature({wallet, message:msg, signature:b58enc(sigBuf)})));
console.log('2 base64 signature     :', JSON.stringify(await verifyWalletSignature({wallet, message:msg, signature:Buffer.from(sigBuf).toString('base64')})));
console.log('3 tampered message     :', JSON.stringify(await verifyWalletSignature({wallet, message:msg+' ', signature:b58enc(sigBuf)})));

const other = await crypto.subtle.generateKey({name:'Ed25519'}, true, ['sign','verify']);
const otherRaw = new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey));
console.log('4 wrong wallet         :', JSON.stringify(await verifyWalletSignature({wallet:b58enc(otherRaw), message:msg, signature:b58enc(sigBuf)})));
console.log('5 garbage signature    :', JSON.stringify(await verifyWalletSignature({wallet, message:msg, signature:'not-a-sig!!'})));
console.log('6 garbage wallet       :', JSON.stringify(await verifyWalletSignature({wallet:'0OIl', message:msg, signature:b58enc(sigBuf)})));
