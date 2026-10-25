'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const license = require('../src/license');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });

// Same key format scripts/licensing.js produces.
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeKey(payload, key = privateKey) {
  const p = b64url(JSON.stringify(payload));
  return `${p}.${b64url(crypto.sign(null, Buffer.from(p), key))}`;
}

test('accepts a correctly signed perpetual key', () => {
  const r = license.verifyKey(makeKey({ name: 'Jane', tier: 'pro', exp: 0 }), PUB);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.payload.tier, 'pro');
});

test('accepts a key with surrounding whitespace', () => {
  assert.strictEqual(license.verifyKey('  ' + makeKey({ name: 'J' }) + '\n', PUB).valid, true);
});

test('rejects an expired key', () => {
  const r = license.verifyKey(makeKey({ name: 'J', exp: Date.now() - 1000 }), PUB);
  assert.deepStrictEqual([r.valid, r.reason], [false, 'expired']);
});

test('accepts a key that has not expired yet', () => {
  assert.strictEqual(license.verifyKey(makeKey({ name: 'J', exp: Date.now() + 86400000 }), PUB).valid, true);
});

test('rejects a key signed by someone else', () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.strictEqual(license.verifyKey(makeKey({ name: 'J' }, other), PUB).reason, 'bad-signature');
});

test('rejects a tampered payload', () => {
  const [, sig] = makeKey({ name: 'J', tier: 'personal' }).split('.');
  const forged = b64url(JSON.stringify({ name: 'J', tier: 'pro' })) + '.' + sig;
  assert.strictEqual(license.verifyKey(forged, PUB).reason, 'bad-signature');
});

test('rejects malformed input', () => {
  for (const k of [undefined, 42, '', 'abc', 'a.b.c', '.sig', 'notjson.sig', b64url('null') + '.x']) {
    assert.strictEqual(license.verifyKey(k, PUB).reason, 'malformed', String(k));
  }
});

test('rejects everything when no public key is set', () => {
  assert.strictEqual(license.verifyKey(makeKey({ name: 'J' }), '').reason, 'no-public-key');
});

test('status is trial with nothing saved; bad activation is refused', () => {
  license.init(fs.mkdtempSync(path.join(os.tmpdir(), 'murmur-lic-')));
  assert.deepStrictEqual(license.status(), { licensed: false, tier: 'trial' });
  assert.deepStrictEqual(license.deactivate(), { ok: true });
  assert.strictEqual(license.activate('garbage').ok, false);
  assert.deepStrictEqual(license.status(), { licensed: false, tier: 'trial' });
});
