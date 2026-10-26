// End-to-end test for the YouTube web app: builds web/ with Vite against the Firebase emulators,
// swaps the YouTube IFrame API for test/web/fake-youtube-api.js and runs two browsers.
// Run: node test/web-e2e.mjs (emulators must be running, media from test/make-media.sh).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'web/dist');
const media = path.join(root, 'test/site/media');
const fakeApi = fs.readFileSync(path.join(root, 'test/web/fake-youtube-api.js'), 'utf8');
const PORT = 8090;
const ORIGIN = `http://localhost:${PORT}/`;
const results = [];

execFileSync('npx', ['vite', 'build', 'web', '--mode', 'emulator', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webm': 'video/webm' };
const server = http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, ORIGIN);
    const file = pathname.startsWith('/media/')
      ? path.join(media, path.basename(pathname))
      : path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '').replaceAll('..', ''));
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1] || 0);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    }
  })
  .listen(PORT);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'] });

async function open(context, label) {
  context ??= await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.route('https://www.youtube.com/iframe_api', route =>
    route.fulfill({ contentType: 'text/javascript', body: fakeApi }),
  );
  page.on('pageerror', err => console.log(`[${label}] pageerror`, err.message));
  const status = () =>
    page.evaluate(() => {
      const e = document.querySelector('video');
      return e ? { t: e.currentTime, paused: e.paused, src: e.currentSrc } : null;
    });
  const video = fn => page.evaluate(fn);
  return { context, page, status, video, label };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}
const fmt = (a, b) => `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`;
const text = (p, sel) => p.page.locator(sel).innerText();

try {
  const A = await open(null, 'A');
  await A.page.goto(ORIGIN);
  await A.page.fill('#name', 'An');
  await A.page.fill('#create-url', 'không phải link');
  await A.page.click('#create');
  await sleep(500);
  check('Link sai báo lỗi', /không hợp lệ/.test(await text(A, '#lobby-error')));

  await A.page.fill('#create-url', 'https://www.youtube.com/watch?v=aaaaaaaaaaa&t=10s');
  await A.page.click('#create');
  await A.page.waitForSelector('#room:not([hidden])', { timeout: 10000 });
  const code = (await text(A, '#room-code')).replace('Phòng ', '');
  check('Tạo phòng', /^[A-Z0-9]{6}$/.test(code), code);
  check('Link mời có mã phòng', new URL(A.page.url()).hash === `#${code}`, A.page.url());

  // B opens the invite link with the code in the hash.
  const B = await open(null, 'B');
  await B.page.goto(`${ORIGIN}#${code}`);
  check('Mở link mời điền sẵn mã', (await B.page.inputValue('#join-code')) === code);
  await B.page.fill('#name', 'Bình');
  await B.page.click('#join');
  await B.page.waitForSelector('#room:not([hidden])', { timeout: 10000 });
  await B.page.waitForSelector('video');
  await sleep(1500);
  check('Danh sách thành viên', (await text(A, '#members')).split('\n').length === 2, (await text(A, '#members')).replace('\n', ', '));

  const wrong = await open(null, 'X');
  await wrong.page.goto(`${ORIGIN}#ZZZZZZ`);
  await wrong.page.fill('#name', 'X');
  await wrong.page.click('#join');
  await sleep(1000);
  check('Mã phòng sai báo lỗi', /Không tìm thấy phòng/.test(await text(wrong, '#lobby-error')));
  await wrong.context.close();

  await A.video(() => document.querySelector('video').play());
  await sleep(2500);
  let a = await A.status(), b = await B.status();
  check('Play', !b.paused && Math.abs(a.t - b.t) < 1, fmt(a, b));

  await B.video(() => document.querySelector('video').pause());
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Pause (từ B)', a.paused && Math.abs(a.t - b.t) < 0.5, fmt(a, b));

  await A.video(() => { document.querySelector('video').currentTime = 120; });
  await sleep(2000);
  a = await A.status(); b = await B.status();
  check('Tua tới 2:00 khi đang pause', a.paused && b.paused && Math.abs(b.t - 120) < 1, fmt(a, b));

  await B.video(() => document.querySelector('video').play());
  await sleep(1500);
  await B.video(() => { const e = document.querySelector('video'); e.currentTime = 200; });
  await sleep(2000);
  a = await A.status(); b = await B.status();
  check('Tua khi đang phát (từ B)', !a.paused && a.t > 199 && Math.abs(a.t - b.t) < 1, fmt(a, b));

  // Rapid toggling must settle in the same state on both sides, without ping-pong.
  await A.video(async () => {
    const e = document.querySelector('video');
    for (let i = 0; i < 5; i++) {
      e.pause();
      await new Promise(r => setTimeout(r, 120));
      await e.play();
      await new Promise(r => setTimeout(r, 120));
    }
    e.pause();
  });
  await sleep(3000);
  const s1 = [await A.status(), await B.status()];
  await sleep(3000);
  const s2 = [await A.status(), await B.status()];
  const stable = s1.every((s, i) => s.paused === s2[i].paused && Math.abs(s.t - s2[i].t) < 0.1) && s2.every(s => s.paused);
  check('Bấm play/pause liên tục không bị lặp', stable && Math.abs(s2[0].t - s2[1].t) < 0.5, JSON.stringify(s2.map(s => [s.paused, +s.t.toFixed(1)])));

  // Second tab in A's browser: its own member, joins late while the room plays.
  await A.video(() => document.querySelector('video').play());
  await sleep(3000);
  const C = await open(A.context, 'C');
  await C.page.goto(`${ORIGIN}#${code}`);
  await C.page.fill('#name', 'Chi');
  await C.page.click('#join');
  await C.page.waitForSelector('video');
  await sleep(3000);
  a = await A.status();
  let c = await C.status();
  check('Người vào sau bắt kịp (tab thứ 2 cùng trình duyệt)', !c.paused && Math.abs(a.t - c.t) < 1, `A=${a.t.toFixed(2)} C=${c.t.toFixed(2)}`);
  check('Hai tab cùng trình duyệt là 2 người', (await text(A, '#members')).split('\n').length === 3, (await text(A, '#members')).replaceAll('\n', ', '));

  await C.page.click('#leave');
  await sleep(1500);
  check('Rời phòng', (await text(A, '#members')).split('\n').length === 2, (await text(A, '#members')).replaceAll('\n', ', '));

  // Drift: slow B down without any seek; the 5 s check should pull it back.
  const commandsFromB = async () => (await text(A, '#chat')).split('\n').filter(l => l.startsWith('Bình đã')).length;
  const commandsBefore = await commandsFromB();
  await B.video(() => { document.querySelector('video').playbackRate = 0.25; });
  await sleep(4000);
  await B.video(() => { document.querySelector('video').playbackRate = 1; });
  await sleep(6000);
  a = await A.status(); b = await B.status();
  check('Sửa drift tự động (lệch 3 s)', !b.paused && Math.abs(a.t - b.t) < 1.5, fmt(a, b));
  check('Hiện độ lệch', /phòng/.test(await text(B, '#drift')), await text(B, '#drift'));

  await B.video(() => { document.querySelector('video').playbackRate = 0.25; });
  await sleep(2500);
  await B.video(() => { document.querySelector('video').playbackRate = 1; });
  await B.page.click('#resync');
  await sleep(1000);
  a = await A.status(); b = await B.status();
  check('Resync', Math.abs(a.t - b.t) < 0.7, fmt(a, b));
  check('Drift và Resync không gửi lệnh cho cả phòng', (await commandsFromB()) === commandsBefore);

  // Chat.
  await A.page.fill('#chat-input', 'Xin chào <b>Bình</b>');
  await A.page.press('#chat-input', 'Enter');
  await sleep(1000);
  const chatB = await text(B, '#chat');
  check('Chat (không chèn HTML)', chatB.includes('An: Xin chào <b>Bình</b>'));
  check('Thông báo hệ thống', /An đã (play|pause)/.test(chatB) && /Bình đã tua tới/.test(chatB));

  // Change video for the whole room.
  await B.page.fill('#change-url', 'https://youtu.be/bbbbbbbbbbb');
  await B.page.press('#change-url', 'Enter');
  await sleep(2500);
  a = await A.status(); b = await B.status();
  check('Đổi video cho cả phòng', a.src.endsWith('/media/ad.webm') && b.src.endsWith('/media/ad.webm') && a.paused && a.t < 1, `${a.src} paused=${a.paused} t=${a.t.toFixed(2)}`);
  await A.video(() => document.querySelector('video').play());
  await sleep(2000);
  a = await A.status(); b = await B.status();
  check('Play video mới', !b.paused && Math.abs(a.t - b.t) < 1, fmt(a, b));

  await A.page.screenshot({ path: path.join(root, 'test/output/web-A.png') });

  await A.page.fill('#change-url', 'noembed0000');
  await A.page.press('#change-url', 'Enter');
  await sleep(2000);
  check('Video chặn nhúng báo lỗi', /không cho phép xem nhúng/.test(await text(B, '#notice')), await text(B, '#notice'));

  await A.context.close();
  await B.context.close();
} catch (err) {
  console.error(err);
  results.push({ name: 'crash', ok: false, detail: String(err) });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
