'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../src/settings');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmur-settings-'));
settings.init(dir);

test('load returns defaults when nothing is saved', () => {
  assert.deepStrictEqual(settings.load(), settings.DEFAULTS);
});

test('save merges a patch and persists it', () => {
  settings.save({ language: 'en' });
  const s = settings.save({ summarySentences: 3 });
  assert.strictEqual(s.language, 'en');
  assert.strictEqual(settings.load().summarySentences, 3);
  assert.strictEqual(settings.load().theme, settings.DEFAULTS.theme);
});

test('load falls back to defaults on a corrupt file', () => {
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  assert.deepStrictEqual(settings.load(), settings.DEFAULTS);
});

test('callers cannot mutate DEFAULTS through load', () => {
  settings.load().theme = 'pink';
  assert.notStrictEqual(settings.DEFAULTS.theme, 'pink');
});
