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

function appRoot() {
  return process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'models'))
    ? process.resourcesPath
    : path.join(__dirname, '..');
}

function dirs() {
  const root = appRoot();
  return { binDir: path.join(root, 'bin'), modelsDir: path.join(root, 'models') };
}

function binaryPath() {
  const exe = process.platform === 'win32' ? 'whisper.exe' : 'whisper';
  return path.join(dirs().binDir, exe);
}

function listModels() {
  const { modelsDir } = dirs();
  if (!fs.existsSync(modelsDir)) return [];
  return fs.readdirSync(modelsDir)
    .filter((f) => f.endsWith('.bin'))
    .map((f) => ({ name: f, path: path.join(modelsDir, f), size: fs.statSync(path.join(modelsDir, f)).size }));
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
        ? 'whisper.cpp binary missing. Place it in the bin folder (see Setup).'
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

  const get = (url, resolve, reject, redirects = 0) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        res.resume();
        return get(res.headers.location, resolve, reject, redirects + 1);
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
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve({ ok: true, path: dest, file: entry.file }); }));
      out.on('error', reject);
    }).on('error', reject);
  };

  return new Promise((resolve, reject) => get(HF_BASE + entry.file, resolve, reject));
}

module.exports = { status, listModels, resolveModel, binaryPath, dirs, catalog, downloadModel, CATALOG };
