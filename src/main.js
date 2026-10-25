'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { transcribe, probeEngine } = require('./transcribe');
const { summarize } = require('./summarize');
const settings = require('./settings');
const license = require('./license');
const engine = require('./engine');
const library = require('./library');

const DATA_DIR = path.join(app.getPath('userData'), 'library');

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  library.init(DATA_DIR);
  settings.init(app.getPath('userData'));
  license.init(app.getPath('userData'));
  engine.setUserModelsDir(path.join(app.getPath('userData'), 'models'));
}

let win;
let currentJob = null; // AbortController for the active transcription

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 940, minHeight: 620,
    backgroundColor: '#0f1115', title: 'Murmur',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.removeMenu();

  // A file dropped outside the drop zone would otherwise replace the UI with that
  // file. Keep the window on the app page and never open new windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Allow only the microphone (for live recording); deny everything else.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ensureStore();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// ---------- engine / settings / license ----------
ipcMain.handle('engine:probe', async () => {
  const st = settings.load();
  return { ...probeEngine(st.model), status: engine.status(st.model), catalog: engine.catalog() };
});
ipcMain.handle('engine:catalog', async () => engine.catalog());
ipcMain.handle('engine:download', async (_e, key) => {
  try {
    const r = await engine.downloadModel(key, (p) => send('engine:download-progress', { key, ...p }));
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('engine:openModelsDir', async () => { const d = engine.dirs(); fs.mkdirSync(d.modelsDir, { recursive: true }); shell.openPath(d.modelsDir); return d.modelsDir; });
ipcMain.handle('engine:openBinDir', async () => { const d = engine.dirs(); fs.mkdirSync(d.binDir, { recursive: true }); shell.openPath(d.binDir); return d.binDir; });

ipcMain.handle('settings:get', async () => settings.load());
ipcMain.handle('settings:set', async (_e, patch) => settings.save(patch));

ipcMain.handle('license:get', async () => license.status());
ipcMain.handle('license:activate', async (_e, key) => license.activate(key));
ipcMain.handle('license:deactivate', async () => license.deactivate());

// ---------- library ----------
ipcMain.handle('library:list', async () => library.readIndex());
ipcMain.handle('library:get', async (_e, id) => library.readRecord(id));
ipcMain.handle('library:delete', async (_e, id) => {
  library.deleteRecord(id);
  const items = library.readIndex().filter((it) => it.id !== id);
  library.writeIndex(items);
  return items;
});

// ---------- file pickers ----------
const MEDIA = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac', 'wma', 'mp4', 'mov', 'mkv', 'webm', 'avi'];
ipcMain.handle('audio:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose audio or video', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: MEDIA }, { name: 'All files', extensions: ['*'] }]
  });
  return res.canceled ? [] : res.filePaths;
});
ipcMain.handle('audio:pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Choose a folder', properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return [];
  const dir = res.filePaths[0];
  return fs.readdirSync(dir)
    .filter((f) => MEDIA.includes(path.extname(f).slice(1).toLowerCase()))
    .map((f) => path.join(dir, f));
});

// Mic recordings are temp files: delete them once transcribed, and sweep any
// left over from failed/abandoned jobs (older than a day) at startup.
const REC_PREFIX = 'murmur-rec-';
function isTempRecording(p) {
  return path.dirname(path.resolve(p)) === path.resolve(os.tmpdir()) && path.basename(p).startsWith(REC_PREFIX);
}
function removeTempRecording(p) {
  if (isTempRecording(p)) { try { fs.unlinkSync(p); } catch {} }
}
function sweepTempRecordings() {
  try {
    const cutoff = Date.now() - 86400000;
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(REC_PREFIX)) continue;
      const full = path.join(os.tmpdir(), f);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}
sweepTempRecordings();

// Mic recording: renderer sends raw bytes; we persist to a temp file to process.
ipcMain.handle('audio:saveRecording', async (_e, { bytes, ext }) => {
  const tmp = path.join(os.tmpdir(), `${REC_PREFIX}${Date.now()}.${ext || 'webm'}`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  return tmp;
});

// ---------- transcription job ----------
ipcMain.handle('job:cancel', async () => { if (currentJob) currentJob.abort(); return true; });

ipcMain.handle('job:run', async (_e, { filePath, title }) => {
  if (currentJob) return { ok: false, error: 'Another transcription is already running.' };
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found: ' + (filePath || '(none)') };
  const started = Date.now();
  const st = settings.load();
  currentJob = new AbortController();
  try {
    const transcript = await transcribe(filePath, {
      onProgress: (p) => send('job:progress', { file: title || path.basename(filePath), ...p }),
      signal: currentJob.signal,
      model: st.model, language: st.language, translate: st.translate
    });
    if (!transcript.text) throw new Error('No speech was detected in this file.');
    const summary = summarize(transcript.text, { sentences: st.summarySentences });
    const id = `${started}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id, title: title || path.basename(filePath), sourcePath: filePath,
      createdAt: new Date(started).toISOString(), durationMs: Date.now() - started,
      engine: transcript.engine, text: transcript.text, segments: transcript.segments || [], summary
    };
    library.writeRecord(record);
    const items = library.readIndex();
    items.unshift({ id, title: record.title, createdAt: record.createdAt, engine: record.engine });
    library.writeIndex(items);
    removeTempRecording(filePath);
    return { ok: true, record };
  } catch (err) {
    return { ok: false, error: err.message, cancelled: err.message === 'cancelled' };
  } finally {
    currentJob = null;
  }
});

// ---------- export ----------
ipcMain.handle('export:save', async (_e, { id, format }) => {
  const rec = library.readRecord(id);
  if (!rec) return null;
  const lic = license.status();
  const footer = lic.licensed ? '' : '\n\n—\nTranscribed with Murmur (trial).';

  let body, ext;
  if (format === 'md') {
    ext = 'md';
    body = `# ${rec.title}\n\n_${rec.createdAt}_\n\n## Summary\n\n` +
      rec.summary.map((s) => `- ${s}`).join('\n') + `\n\n## Transcript\n\n${rec.text}\n${footer}`;
  } else if (format === 'srt') {
    ext = 'srt';
    body = (rec.segments || []).map((s, i) => `${i + 1}\n${s.from} --> ${s.to}\n${s.text}\n`).join('\n');
  } else {
    ext = 'txt';
    body = rec.text + footer;
  }

  const st = settings.load();
  const res = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(st.lastExportDir || app.getPath('documents'), `${rec.title.replace(/\.[^.]+$/, '')}.${ext}`)
  });
  if (res.canceled || !res.filePath) return null;
  try {
    fs.writeFileSync(res.filePath, body, 'utf8');
  } catch (err) {
    // The renderer doesn't await this call, so report the failure here.
    dialog.showErrorBox('Export failed', `Could not save ${res.filePath}:\n${err.message}`);
    return null;
  }
  settings.save({ lastExportDir: path.dirname(res.filePath) });
  shell.showItemInFolder(res.filePath);
  return res.filePath;
});

ipcMain.handle('store:reveal', async () => { shell.openPath(DATA_DIR); return DATA_DIR; });
