'use strict';

// Seller-side licensing CLI. Run with plain Node (not inside the app).
//
//   node scripts/licensing.js keygen
//       -> prints a PUBLIC key (paste into src/license.js PUBLIC_KEY_PEM)
//          and writes the PRIVATE key to  secrets/license_private.pem
//          (KEEP THAT FILE SECRET — never ship it, never commit it)
//
//   node scripts/licensing.js sign --name "Jane Doe" --email jane@x.com \
//        --tier pro --days 0
//       -> prints a license key to give the customer (days 0 = perpetual)
//
// Wire the `sign` step into your storefront's post-purchase webhook
// (Gumroad / Lemon Squeezy / Paddle) to auto-issue keys.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRETS = path.join(__dirname, '..', 'secrets');
const PRIV = path.join(SECRETS, 'license_private.pem');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function keygen() {
  fs.mkdirSync(SECRETS, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(PRIV, priv, 'utf8');
  console.log('Private key written to:', PRIV, '\n(KEEP SECRET — add secrets/ to .gitignore)\n');
  console.log('Paste this into src/license.js as PUBLIC_KEY_PEM (use a backtick template literal):\n');
  console.log(pub);
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

function sign() {
  if (!fs.existsSync(PRIV)) return console.error('No private key. Run: node scripts/licensing.js keygen');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIV, 'utf8'));
  const days = Number(arg('days', '0'));
  const payload = {
    name: arg('name', 'Customer'),
    email: arg('email', ''),
    tier: arg('tier', 'personal'),
    exp: days > 0 ? Date.now() + days * 86400000 : 0
  };
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.sign(null, Buffer.from(p), privateKey));
  console.log(`${p}.${sig}`);
}

const cmd = process.argv[2];
if (cmd === 'keygen') keygen();
else if (cmd === 'sign') sign();
else console.log('Usage: node scripts/licensing.js [keygen|sign]');
