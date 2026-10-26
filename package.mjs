// Builds a release and packs it into release/watch-together-v<version>.zip, ready to
// send to someone who just wants to install it (no git, npm or build needed).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildOptions } from './build.mjs';

if (!fs.existsSync('src/firebase-config.js')) {
  console.error('Chưa có src/firebase-config.js. Chép từ src/firebase-config.example.js và dán Firebase config vào.');
  process.exit(1);
}
if (fs.readFileSync('src/firebase-config.js', 'utf8').includes('DIEN_')) {
  console.error('src/firebase-config.js vẫn còn giá trị DIEN_..., hãy dán Firebase config trước khi đóng gói.');
  process.exit(1);
}
const config = fs.readFileSync('src/config.js', 'utf8');
if (/USE_EMULATOR\s*=\s*true/.test(config)) {
  console.error('src/config.js đang bật USE_EMULATOR, hãy đổi về false trước khi đóng gói.');
  process.exit(1);
}

fs.rmSync('extension/dist', { recursive: true, force: true });
await esbuild.build(buildOptions({ release: true }));

const { version } = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const folder = `watch-together-v${version}`;
const files = [
  ['extension/manifest.json', 'manifest.json'],
  ['extension/popup.html', 'popup.html'],
  ['extension/popup.css', 'popup.css'],
  ...fs.readdirSync('extension/dist').filter(f => f.endsWith('.js')).map(f => [`extension/dist/${f}`, `dist/${f}`]),
  ...fs.readdirSync('extension/icons').map(f => [`extension/icons/${f}`, `icons/${f}`]),
  ['docs/huong-dan-cai-dat.html', 'HUONG-DAN-CAI-DAT.html'],
];

fs.mkdirSync('release', { recursive: true });
const zipPath = `release/${folder}.zip`;
fs.writeFileSync(zipPath, makeZip(files.map(([from, to]) => ({ name: `${folder}/${to}`, data: fs.readFileSync(from) }))));
console.log(`\nĐã tạo ${zipPath} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB). Gửi file này kèm hướng dẫn bên trong.`);

// Minimal zip writer (deflate), so packaging needs no extra tools on Windows or macOS.
function makeZip(entries) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
