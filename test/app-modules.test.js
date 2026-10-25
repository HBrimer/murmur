'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// main.js can't be loaded outside Electron, so check that every local module it
// (or the preload) requires exists. A missing one means the app crashes at startup.
for (const entry of ['main.js', 'preload.js', 'transcribe.js']) {
  test(`every local require in src/${entry} resolves`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', entry), 'utf8');
    const locals = [...src.matchAll(/require\('(\.\/[^']+)'\)/g)].map((m) => m[1]);
    for (const rel of locals) {
      assert.doesNotThrow(() => require.resolve(path.join(__dirname, '..', 'src', rel)), `missing ${rel}`);
    }
  });
}
