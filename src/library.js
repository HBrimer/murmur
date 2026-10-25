'use strict';

// Local transcript library: one <id>.json per record plus an index.json list.
//
// Stand-in written by HBrimer's Claude to the API nigga's Claude specified, so
// main can start. Replace it wholesale with their version when it lands.

const path = require('path');
const fs = require('fs');

let DIR = null;
const ID_RE = /^[\w-]+$/;

function init(dir) {
  DIR = dir;
  fs.mkdirSync(DIR, { recursive: true });
}

const indexFile = () => path.join(DIR, 'index.json');
const recordFile = (id) => path.join(DIR, `${id}.json`);

// Write to a temp file then rename, so a crash mid-write can't truncate the target.
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readRecord(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(recordFile(id), 'utf8')); } catch { return null; }
}

function writeRecord(record) {
  if (!record || typeof record.id !== 'string' || !ID_RE.test(record.id)) {
    throw new Error('Invalid record id');
  }
  writeAtomic(recordFile(record.id), record);
}

function deleteRecord(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return;
  try { fs.unlinkSync(recordFile(id)); } catch {}
}

function writeIndex(items) {
  writeAtomic(indexFile(), items);
}

// Rebuild the index from the record files, newest first.
function rebuildIndex() {
  const items = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const rec = readRecord(f.slice(0, -5));
    if (rec && rec.id) items.push({ id: rec.id, title: rec.title, createdAt: rec.createdAt, engine: rec.engine });
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  writeIndex(items);
  return items;
}

function readIndex() {
  let raw;
  try { raw = fs.readFileSync(indexFile(), 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  try {
    const items = JSON.parse(raw);
    if (Array.isArray(items)) return items;
  } catch {}
  // Corrupt or not a list: keep a copy for inspection, then rebuild from the records.
  try { fs.copyFileSync(indexFile(), `${indexFile()}.corrupt-${Date.now()}`); } catch {}
  return rebuildIndex();
}

module.exports = { init, readIndex, writeIndex, readRecord, writeRecord, deleteRecord, rebuildIndex };
