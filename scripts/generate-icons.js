// Generates the Atlas icon files (a gradient circle) from one definition, so they all stay identical.
// Run with:  node_modules/electron/dist/electron scripts/generate-icons.js   (no window is shown)
// The matching vector version is resources/logo/atlas/atlas-mark.svg: keep the two in sync.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'resources', 'logo', 'atlas');
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// macOS icon entries that hold PNG data: type code -> pixel size
const ICNS_ENTRIES = { ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };

const page = `<script>
  const { ipcRenderer } = require('electron');
  // Same gradient as the vector version: blue at the bottom left to green at the top right
  function drawMark(ctx, size, cx, cy, radius, black) {
    const gradient = ctx.createLinearGradient(cx - radius * 0.72, cy + radius * 0.72, cx + radius * 0.72, cy - radius * 0.72);
    gradient.addColorStop(0, '#147df1');
    gradient.addColorStop(0.5, '#51b4cf');
    gradient.addColorStop(0.95, '#7af2a6');
    ctx.fillStyle = black ? '#000' : gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  function toBase64(canvas, type, quality) {
    return canvas.toDataURL(type, quality).split(',')[1];
  }
  const files = {};
  for (const size of ${JSON.stringify(PNG_SIZES)}) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    // A small margin, so the circle is not cut off by the edge of the icon
    drawMark(c.getContext('2d'), size, size / 2, size / 2, size * 0.47, false);
    files['png/atlas-mark-' + size + '.png'] = toBase64(c, 'image/png');
  }
  {
    // macOS menu bar icons have to be a single colour ("template" images)
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    drawMark(c.getContext('2d'), 32, 16, 16, 13, true);
    files['png/atlasTemplate@2x.png'] = toBase64(c, 'image/png');
  }
  {
    // The picture in the About window, the help center and the README: the logo of the app
    // (components/AtlasLogo.tsx, common/logo-colours.ts) in its own colours, on the dark theme's background
    const c = document.createElement('canvas');
    c.width = c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1e23';
    ctx.fillRect(0, 0, 600, 600);
    drawMark(ctx, 600, 300, 215, 110, false);
    ctx.textAlign = 'center';
    ctx.font = 'italic 400 124px Georgia, Cambria, "Times New Roman", serif';
    const name = 'Atlas';
    const half = ctx.measureText(name).width / 2;
    const nameColours = ctx.createLinearGradient(300 - half, 470, 300 + half, 360);
    nameColours.addColorStop(0, '#f7ea3a');
    nameColours.addColorStop(0.5, '#7fc4a0');
    nameColours.addColorStop(1, '#009de0');
    ctx.fillStyle = nameColours;
    ctx.fillText(name, 300, 455);
    ctx.font = '400 28px Georgia, Cambria, "Times New Roman", serif';
    ctx.fontVariantCaps = 'small-caps';
    ctx.letterSpacing = '6px';
    ctx.fillStyle = 'rgba(245, 248, 250, 0.7)';
    // The spacing after the last letter is part of the width: shifted back by half of it to look centred
    ctx.fillText('of my mind', 303, 512);
    files['atlas-about-dark.jpg'] = toBase64(c, 'image/jpeg', 0.92);
  }
  ipcRenderer.send('files', files);
</script>`;

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  ipcMain.on('files', (_, files) => {
    const buffers = {};
    for (const [name, base64] of Object.entries(files)) {
      const target = path.join(outDir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      buffers[name] = Buffer.from(base64, 'base64');
      fs.writeFileSync(target, buffers[name]);
    }
    const png = (size) => buffers[`png/atlas-mark-${size}.png`];
    fs.writeFileSync(
      path.join(outDir, 'atlas.ico'),
      buildIco(ICO_SIZES.map((size) => ({ size, data: png(size) }))),
    );
    fs.writeFileSync(
      path.join(outDir, 'atlas.icns'),
      buildIcns(Object.entries(ICNS_ENTRIES).map(([type, size]) => ({ type, data: png(size) }))),
    );
    console.log(`Wrote ${Object.keys(files).length + 2} files to ${outDir}`);
    app.quit();
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
});
