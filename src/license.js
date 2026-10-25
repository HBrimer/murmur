'use strict';

// Offline license verification.
//
// A license key is:  <base64url(payload)>.<base64url(ed25519 signature)>
// payload = { name, email, tier, exp }  (exp optional, ms epoch; 0/absent = perpetual)
//
// You (the seller) hold the PRIVATE key and sign keys at purchase time
// (see scripts/licensing.js). The app ships only the PUBLIC key below, so it
// can verify a key fully offline — no license server, no phone-home.
//
// Until you generate your own keypair, PUBLIC_KEY_PEM is empty and the app
// runs in TRIAL mode (fully functional; exports carry a small footer).

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Replace via: `node scripts/licensing.js keygen`
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAnvLjujdbRV1asxHn29VeWzu7s2JiLrpm1BaUVw9KVM4=
-----END PUBLIC KEY-----
`;

let FILE = null;
function init(userDataDir) {
  FILE = path.join(userDataDir, 'license.key');
}

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// publicKeyPem is overridable so tests can verify against a throwaway keypair.
function verifyKey(key, publicKeyPem = PUBLIC_KEY_PEM) {
  if (!publicKeyPem) return { valid: false, reason: 'no-public-key' };
  if (typeof key !== 'string') return { valid: false, reason: 'malformed' };
  const parts = key.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' };
  const [p, s] = parts;
  let payload;
  try {
    payload = JSON.parse(b64urlToBuf(p).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { valid: false, reason: 'malformed' };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(p), publicKeyPem, b64urlToBuf(s));
  } catch {
    return { valid: false, reason: 'bad-signature' };
  }
  if (!ok) return { valid: false, reason: 'bad-signature' };
  if (payload.exp && Date.now() > payload.exp) return { valid: false, reason: 'expired', payload };
  return { valid: true, payload };
}

function status() {
  let key = '';
  try { key = fs.readFileSync(FILE, 'utf8'); } catch {}
  if (!key) return { licensed: false, tier: 'trial' };
  const r = verifyKey(key);
  return r.valid
    ? { licensed: true, tier: r.payload.tier || 'personal', name: r.payload.name }
    : { licensed: false, tier: 'trial', reason: r.reason };
}

function activate(key) {
  const r = verifyKey(key);
  if (!r.valid) return { ok: false, reason: r.reason };
  fs.writeFileSync(FILE, key.trim(), 'utf8');
  return { ok: true, tier: r.payload.tier || 'personal', name: r.payload.name };
}

function deactivate() {
  try { fs.unlinkSync(FILE); } catch {}
  return { ok: true };
}

module.exports = { init, status, activate, deactivate, verifyKey };
