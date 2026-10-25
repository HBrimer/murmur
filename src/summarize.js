'use strict';

// Offline extractive summarizer (TextRank-style), zero dependencies.
//
// This runs entirely on-device: it scores sentences by how much vocabulary
// they share with the rest of the transcript, then returns the top few in
// their original order. Good enough to be genuinely useful, and it keeps the
// app's privacy promise intact — no model, no server, no API key.
//
// (When you want richer, abstractive summaries you can later route the text
// through a local LLM; the interface here stays the same.)

const STOP = new Set((
  'a an the and or but if then else of to in on at for from by with as is are was were be been being ' +
  'this that these those it its it\'s i you he she we they them us me my your our their his her ' +
  'do does did done will would can could should shall may might must not no nor so than too very ' +
  'just about over under again further once here there all any both each few more most other some such ' +
  'what which who whom whose when where why how have has had having get got also into out up down'
).split(/\s+/));

function splitSentences(text) {
  // Split only at a terminator followed by whitespace and a new sentence start,
  // so "whisper.cpp", "3.14", and "U.S." are left intact.
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
}

function summarize(text, { sentences = 5 } = {}) {
  const sents = splitSentences(text);
  if (sents.length <= sentences) return sents;

  const toks = sents.map(tokenize);

  // Document frequency, used to down-weight ubiquitous words.
  const df = new Map();
  toks.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const N = sents.length;
  const weight = (w) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;

  // Sentence similarity = shared weighted vocabulary, length-normalised.
  const sim = (i, j) => {
    if (i === j) return 0;
    const a = new Set(toks[i]);
    let shared = 0;
    for (const w of new Set(toks[j])) if (a.has(w)) shared += weight(w);
    const norm = Math.log(toks[i].length + 2) + Math.log(toks[j].length + 2);
    return norm ? shared / norm : 0;
  };

  // Power-iteration PageRank over the similarity graph.
  let rank = new Array(N).fill(1 / N);
  const d = 0.85;
  for (let iter = 0; iter < 40; iter++) {
    const next = new Array(N).fill((1 - d) / N);
    for (let i = 0; i < N; i++) {
      let outSum = 0;
      const w = [];
      for (let j = 0; j < N; j++) {
        const s = sim(i, j);
        w[j] = s;
        outSum += s;
      }
      if (outSum === 0) continue;
      for (let j = 0; j < N; j++) if (w[j] > 0) next[j] += d * rank[i] * (w[j] / outSum);
    }
    rank = next;
  }

  return rank
    .map((score, idx) => ({ score, idx }))
    .sort((a, b) => b.score - a.score)
    .slice(0, sentences)
    .sort((a, b) => a.idx - b.idx)
    .map((r) => sents[r.idx]);
}

module.exports = { summarize };
