'use strict';

// Tiny persisted settings store. Lives in the OS user-data folder as JSON.
const path = require('path');
const fs = require('fs');

let FILE = null;
const DEFAULTS = {
  model: '',            // '' = auto-pick first model found in /models
  language: 'auto',     // 'auto' or ISO code like 'en'
  summarySentences: 5,
  translate: false,     // ask whisper to translate to English
  theme: 'dark',
  lastExportDir: ''
};

function init(userDataDir) {
  FILE = path.join(userDataDir, 'settings.json');
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  // Write then rename, so a crash mid-write can't leave a truncated file that
  // load() would silently replace with defaults.
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
  return next;
}

module.exports = { init, load, save, DEFAULTS };
