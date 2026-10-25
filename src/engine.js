'use strict';

// Engine manager: finds the whisper.cpp binary and GGML models, and can
// OPTIONALLY download a model on explicit user request.
//
// IMPORTANT PRIVACY NOTE: model download is the ONLY code path in Murmur that
// touches the network, it only runs when the user clicks "Download" in Setup,
// and it only contacts Hugging Face to fetch a model file. Audio is never sent
// anywhere. Keep that boundary when extending this file.

const path = require('path');
const fs = require('fs');
const https = require('https');

// Packaged build: extraResources live in process.resourcesPath. In dev
// (`electron .`), process.defaultApp is true and assets live in the repo root.
function appRoot() {
  return process.resourcesPath && !process.defaultApp
    ? process.resourcesPath
    : path.join(__dirname, '..');
}

// Downloaded models go to a user-writable folder (set by main from userData),
// because the install/resources folder may be read-only. Bundled models in the
// app's own models/ folder are still picked up.
let userModelsDir = null;
function setUserModelsDir(dir) { userModelsDir = dir; }

function dirs() {
  const root = appRoot();
  return {
    binDir: path.join(root, 'bin'),
    bundledModelsDir: path.join(root, 'models'),
    modelsDir: userModelsDir || path.join(root, 'models')
  };
}

// whisper.cpp renamed its CLI over time: whisper-cli (current), main (old),
// plus our own historical name "whisper". Use the first one present.
const BINARY_NAMES = ['whisper-cli', 'whisper', 'main'];

function binaryPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const { binDir } = dirs();
  const found = BINARY_NAMES.map((n) => path.join(binDir, n + ext)).find((p) => fs.existsSync(p));
  return found || path.join(binDir, BINARY_NAMES[0] + ext);
}

function listModels() {
  const { modelsDir, bundledModelsDir } = dirs();
  const seen = new Set();
  const out = [];
  for (const dir of [modelsDir, bundledModelsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.bin') || seen.has(f)) continue;
      const p = path.join(dir, f);
      const size = fs.statSync(p).size;
      if (size < 1024 * 1024) continue; // skip truncated/broken files
      seen.add(f);
      out.push({ name: f, path: p, size });
    }
  }
  return out;
}

function resolveModel(preferred) {
  const models = listModels();
  if (!models.length) return null;
  if (preferred) {
    const hit = models.find((m) => m.name === preferred);
    if (hit) return hit.path;
  }
  return models[0].path;
}

function status(preferred) {
  const hasBin = fs.existsSync(binaryPath());
  const model = resolveModel(preferred);
  return {
    ready: hasBin && !!model,
    hasBinary: hasBin,
    binaryPath: binaryPath(),
    models: listModels(),
    activeModel: model,
    hint: hasBin && model
      ? 'Local whisper.cpp engine detected. Transcription runs fully offline.'
      : !hasBin
        ? 'whisper.cpp binary missing. Place whisper-cli in the bin folder (see Setup).'
        : 'No model found. Download one in Setup or drop a .bin into the models folder.'
  };
}

// Curated set of GGML models from the official whisper.cpp HF repo.
const CATALOG = {
  'tiny.en':   { file: 'ggml-tiny.en.bin',   mb: 75,   note: 'fastest, lowest accuracy' },
  'base.en':   { file: 'ggml-base.en.bin',   mb: 142,  note: 'good default (English)' },
  'small.en':  { file: 'ggml-small.en.bin',  mb: 466,  note: 'better accuracy' },
  'medium.en': { file: 'ggml-medium.en.bin', mb: 1500, note: 'high accuracy, slower' },
  'large-v3':  { file: 'ggml-large-v3.bin',  mb: 3100, note: 'best, multilingual, slow' }
};
const DEFAULT_MODEL = 'base.en'; // HBrimer to confirm: size vs accuracy trade-off
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

function catalog() {
  const installed = new Set(listModels().map((m) => m.name));
  return Object.entries(CATALOG).map(([key, v]) => ({ key, ...v, installed: installed.has(v.file) }));
}

// Download a model with progress + redirect handling. onProgress({percent,receivedMb,totalMb})
function downloadModel(key, onProgress = () => {}) {
  const entry = CATALOG[key];
  if (!entry) return Promise.reject(new Error('Unknown model: ' + key));
  const { modelsDir } = dirs();
  fs.mkdirSync(modelsDir, { recursive: true });
  const dest = path.join(modelsDir, entry.file);
  const tmp = dest + '.part';

  const get = (url, resolve, rejectRaw, redirects = 0) => {
    const reject = (err) => { try { fs.unlinkSync(tmp); } catch {} rejectRaw(err); };
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        res.resume();
        // Location may be relative; resolve against the current URL.
        return get(new URL(res.headers.location, url).toString(), resolve, rejectRaw, redirects + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('Download failed: HTTP ' + res.statusCode));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        received += c.length;
        onProgress({
          percent: total ? Math.round((received / total) * 100) : null,
          receivedMb: +(received / 1048576).toFixed(1),
          totalMb: total ? +(total / 1048576).toFixed(1) : null
        });
      });
      res.on('error', (err) => { out.destroy(); reject(err); });
      res.on('aborted', () => { out.destroy(); reject(new Error('Download interrupted. Check your connection and retry.')); });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        if (total && received !== total) return reject(new Error('Download incomplete. Please retry.'));
        try { fs.renameSync(tmp, dest); } catch (err) { return reject(err); }
        resolve({ ok: true, path: dest, file: entry.file });
      }));
      out.on('error', reject);
    }).on('error', (err) => reject(new Error('Download failed: ' + err.message)));
  };

  return new Promise((resolve, reject) => get(HF_BASE + entry.file, resolve, reject));
}

module.exports = {
  status, listModels, resolveModel, binaryPath, dirs, catalog, downloadModel,
  setUserModelsDir, CATALOG, DEFAULT_MODEL
};
