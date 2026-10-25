'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../src/engine');
const { parseSegments } = require('../src/transcribe');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmur-models-'));
engine.setUserModelsDir(dir);
const MB = 1024 * 1024;

test('truncated model files are ignored', () => {
  fs.writeFileSync(path.join(dir, 'ggml-tiny.en.bin'), Buffer.alloc(10));
  assert.strictEqual(engine.listModels().some((m) => m.name === 'ggml-tiny.en.bin'), false);
});

test('resolveModel prefers the configured model, else the first one found', () => {
  fs.writeFileSync(path.join(dir, 'ggml-base.en.bin'), Buffer.alloc(2 * MB));
  fs.writeFileSync(path.join(dir, 'ggml-small.en.bin'), Buffer.alloc(2 * MB));
  assert.strictEqual(path.basename(engine.resolveModel('ggml-small.en.bin')), 'ggml-small.en.bin');
  assert.ok(engine.resolveModel('ggml-missing.bin'));
});

test('catalog marks installed models and the recommended default', () => {
  const cat = engine.catalog();
  assert.strictEqual(cat.find((m) => m.key === 'base.en').installed, true);
  assert.strictEqual(cat.find((m) => m.key === 'large-v3').installed, false);
  assert.deepStrictEqual(cat.filter((m) => m.recommended).map((m) => m.key), [engine.DEFAULT_MODEL]);
});

test('unknown model downloads are rejected without touching the network', async () => {
  await assert.rejects(engine.downloadModel('nope'), /Unknown model/);
});

test('parseSegments keeps timestamps and drops silence markers', () => {
  const segs = parseSegments({ transcription: [
    { timestamps: { from: '00:00:00,000', to: '00:00:02,000' }, text: ' Hello there. ' },
    { timestamps: { from: '00:00:02,000', to: '00:00:04,000' }, text: ' [BLANK_AUDIO]' },
    { text: '' }
  ] });
  assert.deepStrictEqual(segs, [{ from: '00:00:00,000', to: '00:00:02,000', text: 'Hello there.' }]);
  assert.deepStrictEqual(parseSegments({}), []);
});
