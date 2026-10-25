'use strict';

// Transcript library on disk: one <id>.json per record plus an index.json
// listing { id, title, createdAt, engine } newest first.
const path = require('path');
const fs = require('fs');

let DIR = null;
let INDEX_FILE = null;

function init(dataDir) {
  DIR = dataDir;
  INDEX_FILE = path.join(dataDir, 'index.json');
  fs.mkdirSync(DIR, { recursive: true });
}

// Write then rename, so a crash mid-write can't leave a truncated file.
function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// Ids come from the renderer; keep them to a plain file name inside DIR.
const recordFile = (id) =>
  typeof id === 'string' && /^[\w-]+$/.test(id) ? path.join(DIR, `${id}.json`) : null;

function readRecord(id) {
  const f = recordFile(id);
  if (!f) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null; // missing or corrupt
  }
}

function writeRecord(record) {
  const f = recordFile(record && record.id);
  if (!f) throw new Error('invalid record id');
  writeAtomic(f, record);
}

function deleteRecord(id) {
  const f = recordFile(id);
  if (f && fs.existsSync(f)) fs.unlinkSync(f);
}

function rebuildIndex() {
  const items = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    const rec = readRecord(name.slice(0, -5));
    if (!rec || !rec.id) continue;
    items.push({ id: rec.id, title: rec.title, createdAt: rec.createdAt, engine: rec.engine });
  }
  items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return items;
}

function readIndex() {
  let raw;
  try {
    raw = fs.readFileSync(INDEX_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  try {
    const items = JSON.parse(raw);
    if (Array.isArray(items)) return items;
  } catch { /* fall through */ }
  // Keep the damaged file and rebuild from the records, instead of letting the
  // next writeIndex() erase every past transcript.
  fs.copyFileSync(INDEX_FILE, `${INDEX_FILE}.corrupt-${Date.now()}`);
  const items = rebuildIndex();
  writeIndex(items);
  return items;
}

function writeIndex(items) {
  writeAtomic(INDEX_FILE, items);
}

module.exports = { init, readIndex, writeIndex, readRecord, writeRecord, deleteRecord, rebuildIndex };
