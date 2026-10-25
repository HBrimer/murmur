'use strict';

// Offline speech-to-text orchestration:
//   input media --(ffmpeg)--> 16kHz mono wav --(whisper.cpp)--> transcript JSON
//
// If the engine isn't installed, transcribe() fails with a clear, actionable
// error (no placeholder text). Nothing here opens a network socket.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const engine = require('./engine');
const ffmpeg = require('./ffmpeg');

function probeEngine(preferred) {
  const s = engine.status(preferred);
  return {
    ready: s.ready,
    hasBinary: s.hasBinary,
    activeModel: s.activeModel,
    ffmpeg: ffmpeg.available(),
    hint: s.hint
  };
}

function runWhisper(wavPath, opts, onProgress, signal) {
  const model = engine.resolveModel(opts.model);
  const bin = engine.binaryPath();
  const outPrefix = path.join(os.tmpdir(), `murmur-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  if (!model) return Promise.reject(new Error('No speech model installed. Open Setup and download one.'));
  const threads = Math.max(1, Math.min(8, (os.cpus() || []).length - 1 || 1));
  const args = ['-m', model, '-f', wavPath, '-t', String(threads), '-oj', '-of', outPrefix, '-pp'];
  if (opts.language && opts.language !== 'auto') args.push('-l', opts.language);
  if (opts.translate) args.push('-tr');

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const onAbort = () => { try { child.kill(); } catch {} };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let errTail = '';
    const onOutput = (d) => {
      const txt = d.toString();
      errTail = (errTail + txt).slice(-4000);
      const all = [...txt.matchAll(/progress\s*=\s*(\d+)%/gi)];
      if (all.length) onProgress({ stage: 'transcribing', percent: Number(all[all.length - 1][1]) });
    };
    child.stderr.on('data', onOutput);
    child.stdout.on('data', onOutput);
    child.on('error', (err) => reject(new Error(
      err.code === 'ENOENT' || err.code === 'EACCES'
        ? `Could not start the transcription engine (${err.code}). Check the whisper-cli binary in Setup.`
        : err.message
    )));
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      const jsonPath = `${outPrefix}.json`;
      if (signal && signal.aborted) { try { fs.unlinkSync(jsonPath); } catch {} return reject(new Error('cancelled')); }
      if (code !== 0) {
        const lastLines = errTail.trim().split('\n').filter((l) => !/progress\s*=/.test(l)).slice(-3).join('\n');
        return reject(new Error(`Transcription engine failed (exit code ${code}).` + (lastLines ? `\n${lastLines}` : '')));
      }
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        try { fs.unlinkSync(jsonPath); } catch {}
        const segments = (raw.transcription || []).map((t) => ({
          from: t.timestamps ? t.timestamps.from : '',
          to: t.timestamps ? t.timestamps.to : '',
          text: (t.text || '').trim()
        }));
        resolve({
          engine: `whisper.cpp (${path.basename(model)})`,
          text: segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
          segments
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function transcribe(filePath, { onProgress = () => {}, signal, model, language, translate } = {}) {
  onProgress({ stage: 'starting', percent: 0 });
  const s = engine.status(model);

  if (!s.ready) {
    throw new Error(s.hasBinary
      ? 'No speech model installed. Open Setup and download one to start transcribing.'
      : 'The offline transcription engine is not installed. Open Setup to finish installing it.');
  }

  onProgress({ stage: 'preparing audio', percent: null });
  const conv = await Promise.resolve(ffmpeg.toWav(filePath, signal));
  try {
    if (signal && signal.aborted) throw new Error('cancelled');
    return await runWhisper(conv.wavPath, { model, language, translate }, onProgress, signal);
  } finally {
    conv.cleanup();
  }
}

module.exports = { transcribe, probeEngine };
