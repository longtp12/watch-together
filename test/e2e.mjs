// End-to-end test: two Chromium profiles with the extension, the Firebase emulators,
// and the fake movie site. Run: xvfb-run node test/e2e.mjs (emulators must be running).
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// WT_EXTENSION=<folder> tests an already-built extension (e.g. an unzipped release built against the emulators).
const out = process.env.WT_EXTENSION ? path.resolve(process.env.WT_EXTENSION) : path.join(root, 'test/output/extension');
const PORT = 8080;
const results = [];

// Build the extension against the emulators.
const DEMO_CONFIG = `FIREBASE_CONFIG = {
  apiKey: 'demo-key', projectId: 'demo-watch-together',
  databaseURL: 'http://127.0.0.1:9000?ns=demo-watch-together-default-rtdb' };`;
const emulatorConfig = {
  name: 'emulator-config',
  setup(build) {
    build.onLoad({ filter: /src[\\/](firebase-)?config\.js$/ }, async args => ({
      contents: fs
        .readFileSync(args.path, 'utf8')
        .replace(/FIREBASE_CONFIG = \{[\s\S]*?\};/, DEMO_CONFIG)
        .replace('USE_EMULATOR = false', 'USE_EMULATOR = true'),
      loader: 'js',
    }));
  },
};

if (!process.env.WT_EXTENSION) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['manifest.json', 'popup.html', 'popup.css']) fs.copyFileSync(path.join(root, 'extension', f), path.join(out, f));
  fs.cpSync(path.join(root, 'extension/icons'), path.join(out, 'icons'), { recursive: true });
  await esbuild.build({
    entryPoints: ['background', 'video', 'overlay', 'popup'].map(n => path.join(root, `src/${n}.js`)),
    bundle: true,
    outdir: path.join(out, 'dist'),
    format: 'iife',
    target: 'chrome116',
    plugins: [emulatorConfig],
    logLevel: 'warning',
  });
}

const site = spawn('node', [path.join(root, 'test/site/server.mjs'), String(PORT)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 500));

async function launch(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wt-${label}-`));
  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    viewport: { width: 1000, height: 700 },
    args: [
      `--disable-extensions-except=${out}`,
      `--load-extension=${out}`,
      '--host-resolver-rules=MAP animevietsub.sale 127.0.0.1, MAP player.test 127.0.0.1',
      '--no-proxy-server',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  const movie = await context.newPage();
  await movie.goto(`http://animevietsub.sale:${PORT}/phim/test/tap-01.html`);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/popup.html`);
  const tabId = await ext.evaluate(async () => (await chrome.tabs.query({ url: '*://animevietsub.sale/*' }))[0].id);
  const call = msg => ext.evaluate(m => chrome.runtime.sendMessage(m), { tabId, ...msg });
  await movie.bringToFront();
  const video = () => movie.frames().find(f => f.url().includes('player.test'));
  const v = fn => video().evaluate(fn);
  const status = () => v(() => { const e = document.querySelector('video'); return { t: e.currentTime, paused: e.paused, rate: e.playbackRate }; });
  return { context, movie, ext, call, v, status, label, tabId };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}

try {
  const A = await launch('A');
  const B = await launch('B');
  await sleep(1500);

  const created = await A.call({ type: 'create_room', name: 'An', url: `http://animevietsub.sale:${PORT}/phim/test/tap-01.html` });
  check('Tạo phòng', /^[A-Z0-9]{6}$/.test(created.code ?? ''), JSON.stringify(created.error ?? created.code));
  const joined = await B.call({ type: 'join_room', code: created.code.toLowerCase(), name: 'Bình' });
  check('Vào phòng bằng mã (chữ thường)', joined.code === created.code, joined.error ?? '');
  await sleep(1000);
  const stateA = await A.call({ type: 'get_state' });
  check('Danh sách thành viên', stateA.members.length === 2, stateA.members.map(m => m.name).join(', '));

  const bad = await B.call({ type: 'join_room', code: 'ZZZZZZ', name: 'Bình' });
  check('Mã sai báo lỗi', !!bad.error, bad.error);
  const stillIn = await B.call({ type: 'get_state' });
  check('Mã sai không làm rời phòng hiện tại', stillIn.code === created.code);

  // Local actions are ignored while sync is off.
  await A.v(() => document.querySelector('video').play());
  await sleep(1500);
  check('Tắt đồng bộ: B không bị điều khiển', (await B.status()).paused === true);
  await A.v(() => document.querySelector('video').pause());

  const onA = await A.call({ type: 'set_sync', on: true });
  const onB = await B.call({ type: 'set_sync', on: true });
  check('Bật đồng bộ (dò thấy video trong iframe)', onA.syncing && onB.syncing, onA.error ?? onB.error ?? '');
  await sleep(1500);
  let a = await A.status(), b = await B.status();
  check('Bật đồng bộ: B nhảy về vị trí phòng', Math.abs(a.t - b.t) < 1 && b.paused, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  await A.v(() => document.querySelector('video').play());
  await sleep(2000);
  a = await A.status(); b = await B.status();
  check('Play', !b.paused && Math.abs(a.t - b.t) < 1, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  await B.v(() => document.querySelector('video').pause());
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Pause (từ B)', a.paused && Math.abs(a.t - b.t) < 0.5, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  await A.v(() => { document.querySelector('video').currentTime = 120; });
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Tua tới 2:00', Math.abs(b.t - 120) < 1 && Math.abs(a.t - b.t) < 0.5, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  // Rapid toggling must settle in the same state on both sides, without ping-pong.
  await A.v(async () => {
    const e = document.querySelector('video');
    for (let i = 0; i < 5; i++) {
      await e.play();
      await new Promise(r => setTimeout(r, 120));
      e.pause();
      await new Promise(r => setTimeout(r, 120));
    }
    await e.play();
  });
  await sleep(3000);
  const s1 = [await A.status(), await B.status()];
  await sleep(3000);
  const s2 = [await A.status(), await B.status()];
  const stable = s1.every((s, i) => s.paused === s2[i].paused) && !s2[0].paused && !s2[1].paused;
  check('Bấm play/pause liên tục không bị lặp', stable && Math.abs(s2[0].t - s2[1].t) < 1, JSON.stringify(s2.map(s => [s.paused, +s.t.toFixed(1)])));

  // Drift: push B 4 s behind without telling anyone; drift check should pull it back.
  await B.call({ type: 'set_sync', on: false });
  await B.v(() => { document.querySelector('video').currentTime -= 4; });
  await B.call({ type: 'set_sync', on: true });
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Bật lại đồng bộ kéo B về đúng chỗ', Math.abs(a.t - b.t) < 1, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  // Sync off on B, A pauses, B keeps playing; then Resync.
  await B.call({ type: 'set_sync', on: false });
  await A.v(() => document.querySelector('video').pause());
  await sleep(2000);
  b = await B.status();
  check('B tắt đồng bộ: A pause không ảnh hưởng B', !b.paused, `B paused=${b.paused}`);
  const membersSeenByA = (await A.call({ type: 'get_state' })).members;
  check('A thấy B đang tắt đồng bộ', membersSeenByA.some(m => m.name === 'Bình' && !m.syncing));
  const re = await B.call({ type: 'resync' });
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Resync', !re.error && b.paused && Math.abs(a.t - b.t) < 0.5, `${re.error ?? ''} A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  // Late joiner: B leaves, A plays on, B rejoins.
  await B.call({ type: 'leave_room' });
  await A.v(() => document.querySelector('video').play());
  await sleep(4000);
  await B.call({ type: 'join_room', code: created.code, name: 'Bình' });
  await B.call({ type: 'set_sync', on: true });
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Người vào sau bắt kịp', !b.paused && Math.abs(a.t - b.t) < 1, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  // Drift correction over time: slow B down secretly.
  await B.v(() => { const e = document.querySelector('video'); e.currentTime -= 3; });
  await sleep(7000);
  a = await A.status(); b = await B.status();
  check('Sửa drift tự động (lệch 3 s)', Math.abs(a.t - b.t) < 1, `A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  // Chat.
  await A.call({ type: 'chat_send', text: 'Xin chào <b>Bình</b>' });
  await sleep(1000);
  const hello = await B.call({ type: 'overlay_hello' });
  check('Chat', hello.chat.some(m => m.text === 'Xin chào <b>Bình</b>' && m.name === 'An'));
  check('Thông báo hệ thống (ai đã pause/play)', hello.chat.some(m => m.system && /An đã (play|pause|tua)/.test(m.text)), hello.chat.filter(m => m.system).slice(-2).map(m => m.text).join(' | '));

  await A.movie.screenshot({ path: path.join(root, 'test/output/overlay-A.png') });

  // Ad: tập 02 plays a 30 s ad first in the same video element.
  await B.call({ type: 'set_sync', on: false });
  await B.movie.goto(`http://animevietsub.sale:${PORT}/phim/test/tap-02.html`);
  await sleep(2000);
  await B.v(() => document.querySelector('video').play());
  await sleep(1000);
  const adTry = await B.call({ type: 'set_sync', on: true });
  check('Bật khi đang quảng cáo bị từ chối', !!adTry.error && !adTry.syncing, adTry.error);
  await B.movie.screenshot({ path: path.join(root, 'test/output/overlay-B-wrong-episode.png') });

  await B.v(() => { const e = document.querySelector('video'); e.currentTime = 29.5; });
  await sleep(3000);
  const afterAd = await B.call({ type: 'set_sync', on: true });
  await sleep(1500);
  a = await A.status(); b = await B.status();
  check('Hết quảng cáo, Bật lại được và khớp phòng', afterAd.syncing && Math.abs(a.t - b.t) < 1, `${afterAd.error ?? ''} A=${a.t.toFixed(2)} B=${b.t.toFixed(2)}`);

  await A.context.close();
  await B.context.close();
} catch (err) {
  console.error(err);
  results.push({ name: 'crash', ok: false, detail: String(err) });
} finally {
  site.kill();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
