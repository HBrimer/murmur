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
  // In dev (`electron .`), process.defaultApp is true and bin/ is in the repo.
  return process.resourcesPath && !process.defaultApp
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

// Returns { wavPath, cleanup, converted }. Pass an AbortSignal to cancel.
function toWav(inputPath, signal) {
  const isWav = /\.wav$/i.test(inputPath);
  const ff = locate();

  if (!ff) {
    if (isWav) return { wavPath: inputPath, cleanup: () => {}, converted: false };
    throw new Error(
      'ffmpeg not found. Install ffmpeg (or bundle it in /bin) to transcribe non-WAV files.'
    );
  }

  const out = path.join(os.tmpdir(), `murmur-conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  return new Promise((resolve, reject) => {
    // pcm_s16le is the format whisper.cpp expects; -nostdin avoids hangs.
    const args = ['-nostdin', '-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out];
    const child = spawn(ff, args, { windowsHide: true });
    const onAbort = () => { try { child.kill(); } catch {} };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-8000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) {
        try { fs.unlinkSync(out); } catch {}
        return reject(new Error('cancelled'));
      }
      if (code === 0 && fs.existsSync(out)) {
        resolve({ wavPath: out, cleanup: () => { try { fs.unlinkSync(out); } catch {} }, converted: true });
      } else {
        try { fs.unlinkSync(out); } catch {}
        reject(new Error('Could not read this file as audio. ffmpeg said:\n' + err.trim().split('\n').slice(-4).join('\n')));
      }
    });
  });
}

module.exports = { toWav, available, locate };
