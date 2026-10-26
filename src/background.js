// Service worker: holds the Firebase connection, keeps the room state, and passes
// messages between Firebase, the popup, the floating panel and the video frame.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  signInAnonymously,
  connectAuthEmulator,
} from 'firebase/auth/web-extension';
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  get,
  set,
  update,
  remove,
  push,
  query,
  limitToLast,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
} from 'firebase/database';
import { FIREBASE_CONFIG, USE_EMULATOR, EMULATOR_HOST, AD_MAX_SECONDS, CHAT_HISTORY } from './config.js';
import { SITE_PATTERNS, formatTime } from './shared.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
const db = getDatabase(app);
if (USE_EMULATOR) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, EMULATOR_HOST, 9000);
}

const state = {
  uid: null,
  name: '',
  code: null,
  url: null,
  syncing: false,
  watchTabId: null,
  videoFrameId: null,
  members: {},
  playback: null,
  offset: 0,
  drift: null,
  notice: null,
  chat: [],
};
let roomListeners = [];

const ready = init();

async function init() {
  const saved = await chrome.storage.session.get(['code', 'watchTabId']);
  const { name = '' } = await chrome.storage.local.get('name');
  state.name = name;

  await auth.authStateReady();
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  state.uid = user.uid;

  onValue(ref(db, '.info/serverTimeOffset'), snap => {
    state.offset = snap.val() || 0;
  });

  // After a dropped connection onDisconnect has removed us from the room, so add us back.
  onValue(ref(db, '.info/connected'), snap => {
    if (snap.val() === true && state.code) writeMember().catch(() => {});
  });

  // The service worker was restarted while in a room: rejoin it. Sync stays off,
  // since the video frame no longer knows which video it was attached to.
  if (saved.code) {
    try {
      await joinRoom(saved.code, state.name);
    } catch {
      await chrome.storage.session.remove('code');
    }
  }
}

chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => ready);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ready
    .then(() => handle(msg, sender))
    .then(result => sendResponse(result ?? { ok: true }))
    .catch(err => sendResponse({ error: err.message || String(err) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = msg.tabId ?? sender.tab?.id;
  switch (msg.type) {
    case 'get_state':
      return publicState();
    case 'overlay_hello':
      return { state: publicState(), chat: state.chat };
    case 'create_room':
      await createRoom(msg.name, msg.url);
      return publicState();
    case 'join_room':
      await joinRoom(msg.code, msg.name);
      return publicState();
    case 'leave_room':
      await leaveRoom();
      return publicState();
    case 'set_sync':
      if (msg.on) await enableSync(tabId);
      else await disableSync();
      return publicState();
    case 'resync':
      await resync(tabId);
      return publicState();
    case 'chat_send':
      await sendChat(msg.text);
      return null;
    case 'local_event':
      return onLocalEvent(msg, sender);
    case 'drift':
      if (fromVideoFrame(sender)) {
        state.drift = msg.seconds;
        broadcast({ type: 'drift', seconds: msg.seconds });
      }
      return null;
    case 'ad_detected':
      if (fromVideoFrame(sender)) {
        await disableSync('Đang có quảng cáo, đã tắt đồng bộ. Xem xong thì bấm Bật lại.');
      }
      return null;
    case 'video_lost':
      if (fromVideoFrame(sender)) {
        await disableSync('Trình phát vừa thay video, đã tắt đồng bộ. Bấm Bật lại để dò video.');
      }
      return null;
    default:
      return null;
  }
}

// ---------- Room ----------

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function createRoom(name, url) {
  let code;
  for (let i = 0; i < 5; i++) {
    code = generateCode();
    if (!(await get(ref(db, `rooms/${code}/url`))).exists()) break;
  }
  await set(ref(db, `rooms/${code}`), {
    url: url || '',
    createdAt: serverTimestamp(),
    playback: { paused: true, time: 0, updatedAt: serverTimestamp(), by: state.uid },
  });
  await joinRoom(code, name);
}

async function joinRoom(code, name) {
  code = String(code || '').trim().toUpperCase();
  name = String(name || '').trim().slice(0, 30);
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Mã phòng gồm 6 ký tự.');
  if (!name) throw new Error('Hãy nhập tên của bạn.');

  const snap = await get(ref(db, `rooms/${code}/url`));
  if (!snap.exists()) throw new Error(`Không tìm thấy phòng ${code}.`);

  if (state.code && state.code !== code) await leaveRoom();

  state.name = name;
  state.code = code;
  state.url = snap.val();
  state.syncing = false;
  state.chat = [];
  state.notice = null;
  await chrome.storage.local.set({ name });
  await chrome.storage.session.set({ code });
  await writeMember();
  subscribe(code);
  broadcastState();
}

async function writeMember() {
  const memberRef = ref(db, `rooms/${state.code}/members/${state.uid}`);
  await onDisconnect(memberRef).remove();
  await set(memberRef, { name: state.name, joinedAt: serverTimestamp(), syncing: state.syncing });
}

function subscribe(code) {
  unsubscribe();
  const room = `rooms/${code}`;

  roomListeners.push(
    onValue(ref(db, `${room}/playback`), snap => {
      state.playback = snap.val();
      if (state.syncing && state.playback && state.playback.by !== state.uid) {
        sendToVideo({ type: 'apply', playback: state.playback, offset: state.offset });
      }
    }),
    onValue(ref(db, `${room}/members`), snap => {
      state.members = snap.val() || {};
      broadcastState();
    }),
    onValue(ref(db, `${room}/url`), snap => {
      state.url = snap.val();
      broadcastState();
    }),
    onChildAdded(query(ref(db, `${room}/chat`), limitToLast(CHAT_HISTORY)), snap => {
      const message = { id: snap.key, ...snap.val() };
      state.chat = [...state.chat, message].slice(-CHAT_HISTORY);
      broadcast({ type: 'chat', message });
    }),
  );
}

function unsubscribe() {
  roomListeners.forEach(stop => stop());
  roomListeners = [];
}

async function leaveRoom() {
  if (!state.code) return;
  await disableSync();
  const memberRef = ref(db, `rooms/${state.code}/members/${state.uid}`);
  unsubscribe();
  await onDisconnect(memberRef).cancel();
  await remove(memberRef);
  Object.assign(state, { code: null, url: null, members: {}, playback: null, chat: [], drift: null, notice: null });
  await chrome.storage.session.remove('code');
  broadcastState();
}

async function sendChat(text) {
  text = String(text || '').trim().slice(0, 500);
  if (!state.code || !text) return;
  await push(ref(db, `rooms/${state.code}/chat`), {
    uid: state.uid,
    name: state.name,
    text,
    at: serverTimestamp(),
  });
}

function pushSystemMessage(text) {
  push(ref(db, `rooms/${state.code}/chat`), {
    uid: state.uid,
    name: state.name,
    text,
    system: true,
    at: serverTimestamp(),
  }).catch(() => {});
}

// ---------- Sync ----------

// Ask every frame of the tab for its best video and attach to the best one overall.
async function findVideo(tabId) {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
  const found = await Promise.all(
    frames.map(async ({ frameId }) => {
      try {
        const info = await chrome.tabs.sendMessage(tabId, { type: 'probe' }, { frameId });
        return info ? { ...info, frameId } : null;
      } catch {
        return null;
      }
    }),
  );
  const candidates = found
    .filter(Boolean)
    .sort((a, b) => b.visible - a.visible || b.duration - a.duration || b.area - a.area);

  if (!candidates.length) throw new Error('Chưa thấy video. Hãy bấm play trên trình phát rồi thử lại.');
  const best = candidates[0];
  if (best.duration > 0 && best.duration < AD_MAX_SECONDS) {
    throw new Error('Video đang phát có vẻ là quảng cáo. Xem xong quảng cáo rồi bấm Bật lại.');
  }

  await Promise.all(
    frames.map(({ frameId }) =>
      chrome.tabs
        .sendMessage(tabId, { type: frameId === best.frameId ? 'attach' : 'detach' }, { frameId })
        .catch(() => {}),
    ),
  );
  return best.frameId;
}

async function enableSync(tabId) {
  if (!state.code) throw new Error('Bạn chưa ở trong phòng nào.');
  if (tabId == null) throw new Error('Không biết tab nào đang xem phim.');
  if (state.syncing && state.watchTabId !== tabId) await disableSync();

  state.videoFrameId = await findVideo(tabId);
  state.watchTabId = tabId;
  state.syncing = true;
  state.notice = null;
  await chrome.storage.session.set({ watchTabId: tabId });
  await update(ref(db, `rooms/${state.code}/members/${state.uid}`), { syncing: true });
  sendToVideo({ type: 'apply', playback: state.playback, offset: state.offset, force: true });
  broadcastState();
}

async function disableSync(notice = null) {
  if (state.watchTabId != null && state.videoFrameId != null) {
    sendToVideo({ type: 'detach' });
  }
  const wasSyncing = state.syncing;
  state.syncing = false;
  state.videoFrameId = null;
  state.drift = null;
  state.notice = notice;
  if (wasSyncing && state.code) {
    await update(ref(db, `rooms/${state.code}/members/${state.uid}`), { syncing: false }).catch(() => {});
  }
  broadcastState();
}

// Resync looks for the video again (the player may have swapped it after an ad)
// and jumps to the room position. It never writes to Firebase.
async function resync(tabId) {
  if (!state.code) throw new Error('Bạn chưa ở trong phòng nào.');
  await enableSync(tabId ?? state.watchTabId);
}

function fromVideoFrame(sender) {
  return state.syncing && sender.tab?.id === state.watchTabId && sender.frameId === state.videoFrameId;
}

async function onLocalEvent(msg, sender) {
  if (!fromVideoFrame(sender) || !state.code) return null;
  const playback = { paused: !!msg.paused, time: Number(msg.time) || 0, updatedAt: serverTimestamp(), by: state.uid };
  await set(ref(db, `rooms/${state.code}/playback`), playback);

  const at = formatTime(playback.time);
  const text =
    msg.action === 'seek' ? `${state.name} đã tua tới ${at}` : `${state.name} đã ${playback.paused ? 'pause' : 'play'} ở ${at}`;
  pushSystemMessage(text);
  return null;
}

function sendToVideo(message) {
  if (state.watchTabId == null || state.videoFrameId == null) return;
  chrome.tabs.sendMessage(state.watchTabId, message, { frameId: state.videoFrameId }).catch(() => {});
}

// ---------- Tabs ----------

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.watchTabId) disableSync();
});

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (tabId !== state.watchTabId || !state.syncing) return;
  if (frameId === 0) disableSync('Trang vừa chuyển, đã tắt đồng bộ.');
  else if (frameId === state.videoFrameId) disableSync('Trình phát vừa tải lại, bấm Bật để dò video lại.');
});

// ---------- Broadcasting ----------

function publicState() {
  return {
    uid: state.uid,
    name: state.name,
    code: state.code,
    url: state.url,
    syncing: state.syncing,
    watchTabId: state.watchTabId,
    drift: state.drift,
    notice: state.notice,
    members: Object.entries(state.members).map(([uid, m]) => ({
      uid,
      name: m.name,
      syncing: !!m.syncing,
      isMe: uid === state.uid,
    })),
  };
}

function broadcastState() {
  broadcast({ type: 'state', state: publicState() });
}

// Sends to the popup (if open) and to the floating panel in every movie tab.
async function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  const tabs = await chrome.tabs.query({ url: SITE_PATTERNS });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {});
  }
}
