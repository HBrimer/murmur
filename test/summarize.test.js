'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { summarize } = require('../src/summarize');

test('returns all sentences when there are fewer than requested', () => {
  assert.deepStrictEqual(summarize('One here. Two here.', { sentences: 5 }), ['One here.', 'Two here.']);
});

test('returns nothing for empty input', () => {
  assert.deepStrictEqual(summarize('   '), []);
});

test('does not split on dots inside words or numbers', () => {
  const out = summarize('We use whisper.cpp in the U.S. office. Pi is 3.14 roughly.', { sentences: 5 });
  assert.deepStrictEqual(out, ['We use whisper.cpp in the U.S. office.', 'Pi is 3.14 roughly.']);
});

test('picks the requested number of sentences, in original order', () => {
  const sents = [
    'The budget meeting covered the marketing budget for next quarter.',
    'Lunch was pizza.',
    'Marketing wants a bigger budget for the quarter launch.',
    'Someone mentioned the weather.',
    'The final budget decision for marketing is due next week.',
    'Parking was hard.'
  ];
  const out = summarize(sents.join(' '), { sentences: 3 });
  assert.strictEqual(out.length, 3);
  for (const s of out) assert.match(s, /budget/);
  assert.deepStrictEqual(out, sents.filter((s) => out.includes(s)));
});

test('handles sentences made only of stop words', () => {
  assert.strictEqual(summarize('It is. So it was. And then. We did. You can.', { sentences: 2 }).length, 2);
});
