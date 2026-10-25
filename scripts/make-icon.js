'use strict';

// Renders build/icon.svg into the icon files electron-builder picks up:
//   build/icon.png  (1024x1024, also used for the window icon)
//   build/icon.ico  (16-256 px, Windows exe + installer)
//
//   node scripts/make-icon.js
//
// Uses headless Microsoft Edge (always present on Windows) to rasterize the SVG
// on a canvas at each size, so there are no image dependencies. Re-run after
// editing icon.svg and commit the outputs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 1024];

function findEdge() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe')
  ].filter(Boolean);
  const edge = candidates.find((p) => fs.existsSync(p));
  if (!edge) throw new Error('Microsoft Edge not found; this script needs it to render the SVG.');
  return edge;
}

function render() {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const page = `<!doctype html><body><script>
    const img = new Image();
    img.onload = () => {
      const out = {};
      for (const n of ${JSON.stringify(SIZES)}) {
        const c = document.createElement('canvas'); c.width = c.height = n;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, n, n);
        out[n] = c.toDataURL('image/png').split(',')[1];
      }
      const pre = document.createElement('pre'); pre.id = 'out';
      pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    };
    img.src = ${JSON.stringify(src)};
  </script></body>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmur-icon-'));
  try {
    const html = path.join(dir, 'render.html');
    fs.writeFileSync(html, page);
    const dom = execFileSync(findEdge(), [
      '--headless=new', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom',
      'file:///' + html.replace(/\\/g, '/')
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = dom.match(/<pre id="out">([^<]+)<\/pre>/);
    if (!m) throw new Error('Edge did not render the icon.');
    const out = JSON.parse(m[1].replace(/&quot;/g, '"'));
    return Object.fromEntries(Object.entries(out).map(([n, b64]) => [n, Buffer.from(b64, 'base64')]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ICO container with PNG-compressed entries (supported since Windows Vista).
function ico(pngs) {
  const sizes = SIZES.filter((n) => n <= 256);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((n, i) => {
    const e = 6 + 16 * i, data = pngs[n];
    header.writeUInt8(n === 256 ? 0 : n, e);     // 0 means 256
    header.writeUInt8(n === 256 ? 0 : n, e + 1);
    header.writeUInt16LE(1, e + 4);              // color planes
    header.writeUInt16LE(32, e + 6);             // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...sizes.map((n) => pngs[n])]);
}

const pngs = render();
fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs[1024]);
fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(pngs));
console.log('Wrote build/icon.png and build/icon.ico');
