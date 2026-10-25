'use strict';

// Offline speech-to-text orchestration:
//   input media --(ffmpeg)--> 16kHz mono wav --(whisper.cpp)--> transcript JSON
//
// Falls back to a clearly-labelled DEMO transcript when no engine is installed,
// so the whole app stays runnable. Nothing here opens a network socket.

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
    hint: s.ready
      ? s.hint
      : 'Running in DEMO mode. Add the whisper.cpp engine in Setup to enable real offline transcription.'
  };
}

function runWhisper(wavPath, opts, onProgress, signal) {
  const model = engine.resolveModel(opts.model);
  const bin = engine.binaryPath();
  const outPrefix = path.join(os.tmpdir(), `murmur-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  const args = ['-m', model, '-f', wavPath, '-oj', '-of', outPrefix, '-pp'];
  if (opts.language && opts.language !== 'auto') args.push('-l', opts.language);
  if (opts.translate) args.push('-tr');

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const onAbort = () => { try { child.kill(); } catch {} };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stderr.on('data', (d) => {
      const m = /progress\s*=\s*(\d+)%/i.exec(d.toString());
      if (m) onProgress({ stage: 'transcribing', percent: Number(m[1]) });
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(`whisper exited with code ${code}`));
      try {
        const jsonPath = `${outPrefix}.json`;
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

function demoTranscript(onProgress, signal) {
  return new Promise((resolve, reject) => {
    const lines = [
      "Thanks everyone for joining. This is a Murmur demo transcript generated locally.",
      "Because no whisper.cpp engine is installed yet, we're showing placeholder text.",
      "The point of this mode is that every other part of the app is real and working.",
      "Summaries, search, batch processing, the local library, and export all run on this.",
      "Open Setup, download a model, and this same screen transcribes your actual audio.",
      "Nothing you process here is ever uploaded. The whole pipeline stays on your own disk.",
      "That privacy guarantee is the core of what makes this worth paying for."
    ];
    let i = 0;
    const segments = [];
    const stamp = (s) => `00:00:${String(s).padStart(2, '0')},000`;
    const tick = () => {
      if (signal && signal.aborted) return reject(new Error('cancelled'));
      if (i < lines.length) {
        const sec = i * 6;
        segments.push({ from: stamp(sec), to: stamp(sec + 6), text: lines[i] });
        onProgress({ stage: 'transcribing', percent: Math.round(((i + 1) / lines.length) * 100) });
        i++;
        setTimeout(tick, 180);
      } else {
        resolve({ engine: 'demo (no engine installed)', text: lines.join(' '), segments });
      }
    };
    tick();
  });
}

async function transcribe(filePath, { onProgress = () => {}, signal, model, language, translate } = {}) {
  onProgress({ stage: 'starting', percent: 0 });
  const s = engine.status(model);

  if (!s.ready) return demoTranscript(onProgress, signal);

  onProgress({ stage: 'preparing audio', percent: null });
  const conv = await Promise.resolve(ffmpeg.toWav(filePath));
  try {
    if (signal && signal.aborted) throw new Error('cancelled');
    return await runWhisper(conv.wavPath, { model, language, translate }, onProgress, signal);
  } finally {
    conv.cleanup();
  }
}

module.exports = { transcribe, probeEngine };
