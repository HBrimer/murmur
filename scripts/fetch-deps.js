'use strict';

// Downloads the engine files Murmur ships with, so an installed app transcribes
// with no Setup step:
//
//   bin/whisper-cli.exe + whisper/ggml DLLs   (whisper.cpp, MIT)
//   bin/ffmpeg.exe + av*/sw* DLLs             (FFmpeg LGPL shared build)
//   bin/licenses/*                            (their license texts)
//   models/ggml-base.en.bin                   (default model, see engine.DEFAULT_MODEL)
//
//   node scripts/fetch-deps.js          # runs automatically before `npm run dist`
//   node scripts/fetch-deps.js --force  # re-extract even if already up to date
//
// Every download is pinned and checked against its SHA-256 before use.
// Archives are cached in .deps-cache/ (gitignored) so rebuilds don't re-download.
// Windows x64 only for now; other platforms print a note and exit.

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const MODELS = path.join(ROOT, 'models');
const CACHE = path.join(ROOT, '.deps-cache');

const DEPS = [
  {
    name: 'whisper.cpp b5454 (CPU, x64)',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    // Only the CLI and the libraries it loads; the zip also has servers, benches, etc.
    take: (f) => /(^|\/)whisper-cli\.exe$/i.test(f) || /\.dll$/i.test(f),
    license: /(^|\/)LICENSE(\.txt)?$/i,
    licenseName: 'whisper.cpp-LICENSE.txt'
  },
  {
    name: 'FFmpeg n9.0 LGPL shared (x64)',
    // BtbN deletes old autobuilds after a while. If this 404s, pick a newer
    // autobuild-* release with an ffmpeg-n9.0*-win64-lgpl-shared-9.0.zip and update url + sha256.
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-24-13-02/ffmpeg-n9.0.2-35-g9a9b70bb8c-win64-lgpl-shared-9.0.zip',
    sha256: 'fb771d872989dba5d96621a840194362202426e882814a0d5e7eddd8387908d3',
    take: (f) => /\/bin\/(ffmpeg\.exe|[^/]+\.dll)$/i.test(f),
    license: /^[^/]+\/LICENSE\.txt$/i,
    licenseName: 'ffmpeg-LICENSE.txt'
  },
  {
    name: 'Model ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    model: 'ggml-base.en.bin'
  }
];

// Bump when DEPS changes so existing bin/ folders get refreshed.
const STAMP = path.join(BIN, '.deps-version');
const VERSION = DEPS.map((d) => d.sha256.slice(0, 12)).join('-');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'murmur-fetch-deps' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0, lastPct = -10;
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        got += c.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  ${pct}%`); }
      });
      res.on('error', (e) => { out.destroy(); reject(e); });
      res.pipe(out);
      out.on('error', reject);
      out.on('finish', () => {
        process.stdout.write('\n');
        if (total && got !== total) return reject(new Error(`Download cut short: ${got}/${total} bytes`));
        fs.renameSync(tmp, dest);
        resolve();
      });
    }).on('error', reject);
  });
}

async function fetchVerified(dep) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, path.basename(new URL(dep.url).pathname));
  if (fs.existsSync(file) && sha256(file) === dep.sha256) {
    console.log(`${dep.name}: cached`);
    return file;
  }
  console.log(`${dep.name}: downloading`);
  await download(dep.url, file);
  const got = sha256(file);
  if (got !== dep.sha256) {
    fs.unlinkSync(file);
    throw new Error(`${dep.name}: SHA-256 mismatch (got ${got}). Refusing to use it.`);
  }
  return file;
}

// Extract a zip to a fresh temp folder with Windows' built-in tar (bsdtar),
// then copy only the files we ship, flattened into bin/.
function extractInto(zip, dep) {
  const tmp = fs.mkdtempSync(path.join(CACHE, 'x-'));
  try {
    // Full path: a GNU tar earlier on PATH (Git Bash) reads "C:" as a remote host.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', tmp], { stdio: 'inherit' });
    const files = [];
    (function walk(dir, rel) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else files.push(r);
      }
    })(tmp, '');
    const picked = files.filter(dep.take);
    if (!picked.length) throw new Error(`${dep.name}: nothing to extract (archive layout changed?)`);
    for (const f of picked) fs.copyFileSync(path.join(tmp, f), path.join(BIN, path.basename(f)));
    const lic = files.find((f) => dep.license.test(f));
    if (lic) fs.copyFileSync(path.join(tmp, lic), path.join(BIN, 'licenses', dep.licenseName));
    console.log(`  -> ${picked.length} files into bin/`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.log('fetch-deps: only Windows x64 is pinned so far; skipping. Put engine files in bin/ by hand.');
    return;
  }
  const force = process.argv.includes('--force');
  const modelsReady = DEPS.filter((d) => d.model).every((d) => fs.existsSync(path.join(MODELS, d.model)));
  if (!force && modelsReady && fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === VERSION) {
    console.log('fetch-deps: engine files are up to date.');
    return;
  }
  fs.mkdirSync(path.join(BIN, 'licenses'), { recursive: true });
  fs.mkdirSync(MODELS, { recursive: true });

  for (const dep of DEPS) {
    const file = await fetchVerified(dep);
    if (dep.model) fs.copyFileSync(file, path.join(MODELS, dep.model));
    else extractInto(file, dep);
  }
  fs.writeFileSync(STAMP, VERSION + '\n');
  console.log('fetch-deps: done. bin/ and models/ are ready to bundle.');
}

main().catch((e) => {
  console.error('fetch-deps failed:', e.message);
  process.exit(1);
});
