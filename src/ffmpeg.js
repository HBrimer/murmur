'use strict';

// Media -> 16kHz mono WAV, because whisper.cpp only accepts that.
// We look for ffmpeg in this order:
//   1. bundled  bin/ffmpeg(.exe)   (shipped with the app via extraResources)
//   2. system PATH
// If neither exists and the input is already a .wav, we pass it through so the
// app still works in the minimal case.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

function appRoot() {
  // In a packaged build, extraResources land in process.resourcesPath.
  return process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'bin'))
    ? process.resourcesPath
    : path.join(__dirname, '..');
}

function locate() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = path.join(appRoot(), 'bin', exe);
  if (fs.existsSync(bundled)) return bundled;

  // system PATH?
  const probe = spawnSync(exe, ['-version'], { windowsHide: true });
  if (!probe.error) return exe;

  return null;
}

function available() {
  return locate() !== null;
}

// Returns { wavPath, cleanup, converted }
function toWav(inputPath) {
  const isWav = /\.wav$/i.test(inputPath);
  const ff = locate();

  if (!ff) {
    if (isWav) return { wavPath: inputPath, cleanup: () => {}, converted: false };
    throw new Error(
      'ffmpeg not found. Install ffmpeg (or bundle it in /bin) to transcribe non-WAV files.'
    );
  }

  const out = path.join(os.tmpdir(), `murmur-conv-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-vn', out];
    const child = spawn(ff, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(out)) {
        resolve({ wavPath: out, cleanup: () => { try { fs.unlinkSync(out); } catch {} }, converted: true });
      } else {
        reject(new Error('ffmpeg failed to convert audio:\n' + err.split('\n').slice(-6).join('\n')));
      }
    });
  });
}

module.exports = { toWav, available, locate };
