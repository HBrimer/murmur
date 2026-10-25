'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const library = require('../src/library');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmur-library-'));
library.init(dir);

const rec = (id, createdAt) => ({ id, title: `t-${id}`, createdAt, engine: 'whisper', text: 'hi' });

test('readIndex returns [] when no index exists', () => {
  assert.deepStrictEqual(library.readIndex(), []);
});

test('writeRecord/readRecord round-trip and writeIndex persists', () => {
  library.writeRecord(rec('a1', '2026-01-01T00:00:00.000Z'));
  assert.strictEqual(library.readRecord('a1').title, 't-a1');
  library.writeIndex([{ id: 'a1' }]);
  assert.deepStrictEqual(library.readIndex(), [{ id: 'a1' }]);
  assert.ok(!fs.existsSync(path.join(dir, 'index.json.tmp')));
});

test('readRecord returns null for missing, corrupt or unsafe ids', () => {
  assert.strictEqual(library.readRecord('nope'), null);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{trunc');
  assert.strictEqual(library.readRecord('bad'), null);
  assert.strictEqual(library.readRecord('../index'), null);
  assert.throws(() => library.writeRecord({ id: '../x' }));
});

test('corrupt index is backed up and rebuilt from records, newest first', () => {
  library.writeRecord(rec('b2', '2026-02-01T00:00:00.000Z'));
  fs.writeFileSync(path.join(dir, 'index.json'), '[{"id":"a1"');
  const items = library.readIndex();
  assert.deepStrictEqual(items.map((i) => i.id), ['b2', 'a1']);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('index.json.corrupt-')));
  // A subsequent save keeps the old transcripts.
  library.writeIndex([{ id: 'c3' }, ...library.readIndex()]);
  assert.deepStrictEqual(library.readIndex().map((i) => i.id), ['c3', 'b2', 'a1']);
});

test('deleteRecord removes the file', () => {
  library.deleteRecord('b2');
  assert.strictEqual(library.readRecord('b2'), null);
});
