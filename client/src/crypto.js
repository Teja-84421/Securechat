// End-to-end encryption using ONLY the browser's built-in Web Crypto API.
//
//   1. Each user has an ECDH P-256 key pair (created once, in the browser).
//   2. Alice's private key + Bob's public key  ==  Bob's private key + Alice's public key
//      -> both sides compute the same shared secret without ever sending it.
//   3. HKDF turns that secret into a 256-bit AES-GCM key.
//   4. Every message is encrypted with AES-256-GCM and a fresh random 12-byte IV.
//
// SECURITY TRADEOFF: the private key is stored in localStorage as a JWK so that the
// app stays simple. It never leaves the browser, but it is readable by scripts on
// this origin (XSS) and is not available on other devices. See README.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();
const keyStore = (userId) => `securechat_keys_${userId}`;
const sharedKeyCache = new Map();

function subtle() {
  if (!window.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable. Open the app via http://localhost or HTTPS.');
  }
  return window.crypto.subtle;
}

export const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); // chunked: safe for big audio
  }
  return btoa(s);
};
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

// Returns this user's public key (JWK string), creating the key pair on first use.
export async function getOrCreateKeyPair(userId) {
  const stored = localStorage.getItem(keyStore(userId));
  if (stored) return JSON.parse(stored).pub;

  const pair = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const priv = await subtle().exportKey('jwk', pair.privateKey);
  const pub = JSON.stringify(await subtle().exportKey('jwk', pair.publicKey));
  localStorage.setItem(keyStore(userId), JSON.stringify({ priv, pub }));
  return pub;
}

// Derives the AES-256-GCM key shared between me and one peer.
async function getSharedKey(myId, peerPublicKey) {
  const cacheKey = `${myId}:${peerPublicKey}`;
  if (sharedKeyCache.has(cacheKey)) return sharedKeyCache.get(cacheKey);

  const stored = JSON.parse(localStorage.getItem(keyStore(myId)));
  if (!stored) throw new Error('Missing private key on this device');

  const myPrivate = await subtle().importKey('jwk', stored.priv, ECDH, false, ['deriveBits']);
  const peerPublic = await subtle().importKey('jwk', JSON.parse(peerPublicKey), ECDH, false, []);

  const secret = await subtle().deriveBits({ name: 'ECDH', public: peerPublic }, myPrivate, 256);
  const hkdfKey = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const aesKey = await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('SecureChat v1 message key') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  sharedKeyCache.set(cacheKey, aesKey);
  return aesKey;
}

export async function encryptMessage(myId, peerPublicKey, plaintext) {
  const key = await getSharedKey(myId, peerPublicKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // unique nonce per message
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: toB64(ciphertext), iv: toB64(iv) };
}

// Returns the plaintext, or null if decryption/authentication fails.
export async function decryptMessage(myId, peerPublicKey, ciphertext, iv) {
  try {
    const key = await getSharedKey(myId, peerPublicKey);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext));
    return dec.decode(plain);
  } catch {
    return null;
  }
}

// ---- Voice messages ----------------------------------------------------------
// The recording is encrypted exactly like a text message (same shared key, AES-256-GCM,
// fresh IV). The audio's MIME type is packed inside the encrypted payload so the server
// can't even tell what format it is:  [1 byte: mime length][mime][audio bytes]

export async function encryptVoice(myId, peerPublicKey, blob) {
  const audio = new Uint8Array(await blob.arrayBuffer());
  const mime = enc.encode(blob.type || 'audio/webm');
  const payload = new Uint8Array(1 + mime.length + audio.length);
  payload[0] = mime.length;
  payload.set(mime, 1);
  payload.set(audio, 1 + mime.length);

  const key = await getSharedKey(myId, peerPublicKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, payload);
  return { ciphertext: toB64(ciphertext), iv: toB64(iv) };
}

// Returns an audio Blob, or null if decryption/authentication fails.
export async function decryptVoice(myId, peerPublicKey, ciphertext, iv) {
  try {
    const key = await getSharedKey(myId, peerPublicKey);
    const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext)));
    const mimeLength = plain[0];
    const mime = dec.decode(plain.subarray(1, 1 + mimeLength));
    return new Blob([plain.subarray(1 + mimeLength)], { type: mime });
  } catch {
    return null;
  }
}

// ---- Safety number ------------------------------------------------------------
// Both people compute the same six 5-digit groups from the two public keys. If they
// match when compared out loud, nobody (including the server) swapped a key.
export async function safetyNumber(publicKeyA, publicKeyB) {
  const [a, b] = [publicKeyA, publicKeyB].sort();
  const hash = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`${a}|${b}`)));
  return Array.from({ length: 6 }, (_, i) => {
    const n = ((hash[i * 4] << 24) | (hash[i * 4 + 1] << 16) | (hash[i * 4 + 2] << 8) | hash[i * 4 + 3]) >>> 0;
    return String(n % 100000).padStart(5, '0');
  });
}
