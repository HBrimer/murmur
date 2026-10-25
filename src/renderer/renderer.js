'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const api = window.murmur;

const views = ['drop', 'record', 'batch', 'setup', 'settings', 'license', 'progress', 'result'];
function show(name) {
  views.forEach((v) => $('#' + v + 'View').classList.toggle('hidden', v !== name));
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}
$$('.nav-btn').forEach((b) => (b.onclick = () => {
  const v = b.dataset.view;
  show(v);
  if (v === 'setup') renderSetup();
  if (v === 'settings') renderSettings();
  if (v === 'license') renderLicense();
}));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- engine status ----------
async function refreshEngine() {
  const e = await api.probeEngine();
  const dot = $('#engineDot'), label = $('#engineLabel');
  dot.className = 'dot ' + (e.ready ? 'ok' : 'demo');
  label.textContent = e.ready ? 'Offline engine ready' : 'Setup needed';
  label.title = e.hint;
  return e;
}

// ---------- library ----------
let library = [], current = null;
async function refreshLibrary() { library = await api.listLibrary(); renderLibrary(); }
function renderLibrary() {
  const q = $('#search').value.trim().toLowerCase();
  const ul = $('#library'); ul.innerHTML = '';
  library.filter((it) => !q || it.title.toLowerCase().includes(q)).forEach((it) => {
    const li = document.createElement('li');
    if (current && current.id === it.id) li.classList.add('active');
    li.innerHTML = `<div class="li-title">${escapeHtml(it.title)}</div>` +
      `<div class="li-meta">${new Date(it.createdAt).toLocaleString()}</div>`;
    li.onclick = () => openRecord(it.id);
    ul.appendChild(li);
  });
}
async function openRecord(id) {
  const rec = await api.getRecord(id); if (!rec) return;
  current = rec;
  $('#rTitle').textContent = rec.title;
  $('#rMeta').textContent = `${new Date(rec.createdAt).toLocaleString()} · ${rec.engine}`;
  const sum = $('#summary'); sum.innerHTML = '';
  rec.summary.forEach((s) => { const li = document.createElement('li'); li.textContent = s; sum.appendChild(li); });
  const t = $('#transcript'); t.innerHTML = '';
  if (rec.segments && rec.segments.length) {
    rec.segments.forEach((s) => {
      const d = document.createElement('div'); d.className = 'seg';
      d.innerHTML = s.from ? `<span class="ts">${escapeHtml(s.from)}</span>${escapeHtml(s.text)}` : escapeHtml(s.text);
      t.appendChild(d);
    });
  } else t.textContent = rec.text;
  renderLibrary(); show('result');
}

// ---------- single job ----------
let detach = null;
function bindProgress() {
  if (detach) detach();
  detach = api.onProgress((p) => {
    $('#progTitle').textContent = `Transcribing — ${p.file || ''}`;
    if (typeof p.percent === 'number') $('#bar').style.width = p.percent + '%';
    else $('#bar').style.width = '35%';
    $('#progStage').textContent = p.stage + (p.percent != null ? ` · ${p.percent}%` : '');
  });
}
async function runFile(filePath, title) {
  if (!filePath) return;
  const eng = await api.probeEngine();
  if (!eng.ready) {
    alert(eng.hint + '\n\nOpening Setup so you can finish installing the engine.');
    document.querySelector('[data-view="setup"]').click();
    return;
  }
  show('progress'); $('#bar').style.width = '0%'; $('#progStage').textContent = 'starting';
  bindProgress();
  try {
    const res = await api.runJob(filePath, title);
    if (!res.ok) {
      if (!res.cancelled) alert('Transcription failed: ' + res.error);
      show('drop'); return;
    }
    await refreshLibrary(); await openRecord(res.record.id);
  } finally { if (detach) { detach(); detach = null; } }
}
$('#cancelBtn').onclick = () => api.cancelJob();

// ---------- NEW / drop ----------
$('#pickBtn').onclick = async () => { const fs = await api.pickAudio(); if (fs.length) runFile(fs[0]); };
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  const p = f && api.pathForFile(f);
  if (p) runFile(p);
});

// ---------- RECORD ----------
let mediaRecorder = null, chunks = [], recTimer = null, recStart = 0;
$('#recStart').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      const p = await api.saveRecording(Array.from(buf), 'webm');
      runFile(p, 'Recording ' + new Date().toLocaleString());
    };
    mediaRecorder.start();
    recStart = Date.now();
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('#recTimer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    $('#recStart').classList.add('recording', 'hidden'); $('#recStop').classList.remove('hidden');
    $('#recHint').textContent = 'Recording… click stop when done.';
  } catch (err) {
    $('#recHint').textContent = 'Microphone unavailable: ' + err.message;
  }
};
$('#recStop').onclick = () => {
  if (mediaRecorder) mediaRecorder.stop();
  clearInterval(recTimer);
  $('#recStart').classList.remove('recording', 'hidden'); $('#recStop').classList.add('hidden');
  $('#recTimer').textContent = '00:00';
};

// ---------- BATCH ----------
let queue = []; // {path,title,state}
function renderBatch() {
  const ul = $('#batchList'); ul.innerHTML = '';
  queue.forEach((item, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(item.title)}</span><span class="spacer"></span>` +
      `<span class="bstate">${item.state}</span>`;
    ul.appendChild(li); void i;
  });
}
$('#batchAddFiles').onclick = async () => {
  const files = await api.pickAudio();
  files.forEach((p) => queue.push({ path: p, title: p.split(/[\\/]/).pop(), state: 'queued' }));
  renderBatch();
};
$('#batchAddFolder').onclick = async () => {
  const files = await api.pickFolder();
  files.forEach((p) => queue.push({ path: p, title: p.split(/[\\/]/).pop(), state: 'queued' }));
  renderBatch();
  if (!files.length) $('#batchStatus').textContent = 'No supported media files found in that folder.';
};
$('#batchClear').onclick = () => { queue = []; renderBatch(); $('#batchStatus').textContent = ''; };
$('#batchRun').onclick = async () => {
  bindProgress();
  for (const item of queue) {
    if (item.state === '✓ done') continue;
    item.state = 'transcribing…'; renderBatch();
    $('#batchStatus').textContent = `Processing ${item.title}…`;
    const res = await api.runJob(item.path, item.title);
    item.state = res.ok ? '✓ done' : (res.cancelled ? 'cancelled' : 'failed: ' + String(res.error || '').split('\n')[0]);
    renderBatch();
    if (res.ok) await refreshLibrary();
  }
  if (detach) { detach(); detach = null; }
  $('#batchStatus').textContent = 'Queue complete.';
};

// ---------- SETUP ----------
async function renderSetup() {
  const e = await api.probeEngine();
  $('#binStatus').textContent = e.status.hasBinary
    ? '✓ whisper.cpp engine found.' : '✗ whisper.cpp engine not found yet.';
  const cat = await api.catalog();
  const ul = $('#modelList'); ul.innerHTML = '';
  cat.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div><div class="mname">${m.key}</div><div class="mnote">${m.note} · ~${m.mb} MB</div></div>` +
      `<span class="spacer"></span>` +
      (m.installed
        ? `<span class="badge-ok">✓ installed</span>`
        : `<div class="mini-bar" data-key="${m.key}"><div></div></div>` +
          `<button data-dl="${m.key}">Download</button>`);
    ul.appendChild(li);
  });
  $$('[data-dl]').forEach((btn) => (btn.onclick = () => downloadModel(btn.dataset.dl, btn)));
}
let detachDl = null;
async function downloadModel(key, btn) {
  btn.disabled = true; btn.textContent = 'Downloading…';
  const barWrap = document.querySelector(`.mini-bar[data-key="${key}"] > div`);
  if (detachDl) detachDl();
  detachDl = api.onDownloadProgress((p) => { if (p.key === key && p.percent != null && barWrap) barWrap.style.width = p.percent + '%'; });
  const res = await api.downloadModel(key);
  if (detachDl) { detachDl(); detachDl = null; }
  if (res.ok) { await refreshEngine(); renderSetup(); renderSettings(); }
  else { btn.disabled = false; btn.textContent = 'Retry'; alert('Download failed: ' + res.error); }
}
$('#openBin').onclick = () => api.openBinDir();
if ($('#openModels')) $('#openModels').onclick = () => api.openModelsDir();

// ---------- SETTINGS ----------
async function renderSettings() {
  const st = await api.getSettings();
  const cat = await api.catalog();
  const sel = $('#setModel'); sel.innerHTML = '<option value="">Auto (first installed)</option>';
  cat.filter((m) => m.installed).forEach((m) => {
    const o = document.createElement('option'); o.value = m.file; o.textContent = m.key; sel.appendChild(o);
  });
  sel.value = st.model || '';
  $('#setLang').value = st.language;
  $('#setTranslate').checked = !!st.translate;
  $('#setSentences').value = st.summarySentences;
}
$('#setModel').onchange = (e) => api.setSettings({ model: e.target.value });
$('#setLang').onchange = (e) => api.setSettings({ language: e.target.value });
$('#setTranslate').onchange = (e) => api.setSettings({ translate: e.target.checked });
$('#setSentences').onchange = (e) => api.setSettings({ summarySentences: Math.max(1, Math.min(15, +e.target.value || 5)) });

// ---------- LICENSE ----------
async function renderLicense() {
  const s = await api.getLicense();
  $('#licStatus').textContent = s.licensed
    ? `✓ Activated — ${s.tier}${s.name ? ' · ' + s.name : ''}`
    : `Trial mode${s.reason ? ' (' + s.reason + ')' : ''}. All features available; exports carry a small footer.`;
  updateTierBadge(s);
}
function updateTierBadge(s) {
  const b = $('#tierBadge');
  b.textContent = s.licensed ? s.tier : 'trial';
  b.classList.toggle('pro', !!s.licensed);
}
$('#licActivate').onclick = async () => {
  const r = await api.activateLicense($('#licKey').value);
  if (r.ok) { $('#licKey').value = ''; renderLicense(); }
  else alert('Could not activate: ' + r.reason);
};
$('#licRemove').onclick = async () => { await api.deactivateLicense(); renderLicense(); };

// ---------- misc ----------
$('#search').oninput = renderLibrary;
$('#revealBtn').onclick = () => api.revealStore();
$('#delBtn').onclick = async () => {
  if (!current) return;
  if (!confirm(`Delete "${current.title}"?`)) return;
  library = await api.deleteRecord(current.id); current = null; renderLibrary(); show('drop');
};
$$('[data-export]').forEach((btn) => (btn.onclick = () => current && api.exportRecord(current.id, btn.dataset.export)));

// ---------- init ----------
(async function init() {
  await refreshEngine();
  await refreshLibrary();
  updateTierBadge(await api.getLicense());
  show('drop');
})();
