'use strict';
// Covers the stand-in src/library.js. Delete this file when nigga's Claude's
// library.js and test/library.test.js land.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const library = require('../src/library');

const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'murmur-lib-')), 'library');
library.init(dir);
const rec = (id, createdAt) => ({ id, title: id, createdAt, engine: 'test', text: 'hi', segments: [], summary: [] });

test('init creates the folder and an empty index reads as []', () => {
  assert.ok(fs.existsSync(dir));
  assert.deepStrictEqual(library.readIndex(), []);
});

test('records round-trip and bad ids are refused', () => {
  library.writeRecord(rec('a-1', '2026-01-01T00:00:00.000Z'));
  assert.strictEqual(library.readRecord('a-1').title, 'a-1');
  assert.strictEqual(library.readRecord('../settings'), null);
  assert.throws(() => library.writeRecord(rec('../x', '')), /Invalid record id/);
});

test('deleteRecord ignores path traversal and missing files', () => {
  const outside = path.join(path.dirname(dir), 'keep.json');
  fs.writeFileSync(outside, '{}');
  library.deleteRecord('../keep');
  assert.ok(fs.existsSync(outside));
  assert.doesNotThrow(() => library.deleteRecord('nope'));
});

test('a corrupt index is backed up and rebuilt newest first', () => {
  library.writeRecord(rec('b-2', '2026-02-01T00:00:00.000Z'));
  fs.writeFileSync(path.join(dir, 'index.json'), '{not json');
  assert.deepStrictEqual(library.readIndex().map((i) => i.id), ['b-2', 'a-1']);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('index.json.corrupt-')));
});
