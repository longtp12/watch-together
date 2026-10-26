// Floating panel on the movie page (top frame only): sync on/off, Resync,
// how far behind the room you are, members and chat. Hidden until you join a room.
import { send } from './shared.js';

if (window === window.top) {
  const host = document.createElement('div');
  host.id = 'watch-together-panel';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 300px;
        font: 13px/1.4 system-ui, sans-serif; color: #f2f2f2; background: rgba(20,20,24,.94);
        border: 1px solid #3a3a44; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.45); overflow: hidden; }
      .panel[hidden] { display: none; }
      header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #26262e; cursor: default; }
      header b { flex: 1; letter-spacing: .5px; }
      .icon { background: none; border: 0; color: #bbb; cursor: pointer; font-size: 14px; padding: 2px 4px; }
      .body { padding: 10px; display: grid; gap: 8px; }
      .collapsed .body { display: none; }
      .row { display: flex; gap: 6px; align-items: center; }
      button.main { flex: 1; border: 0; border-radius: 8px; padding: 7px 8px; font: 600 13px system-ui, sans-serif; cursor: pointer; }
      .sync-off { background: #3a3a44; color: #fff; }
      .sync-on { background: #1f9d55; color: #fff; }
      .resync { background: #2563eb; color: #fff; }
      .drift { color: #aaa; font-size: 12px; }
      .notice { background: #4a3a10; color: #ffd166; border-radius: 8px; padding: 6px 8px; font-size: 12px; }
      .notice[hidden] { display: none; }
      .notice a { color: #ffd166; }
      .members { color: #ccc; font-size: 12px; }
      .chat { height: 160px; overflow-y: auto; background: #111116; border-radius: 8px; padding: 6px 8px; }
      .msg { margin: 2px 0; word-wrap: break-word; }
      .msg .who { font-weight: 600; color: #8ab4f8; }
      .msg.system { color: #999; font-style: italic; font-size: 12px; }
      form { display: flex; gap: 6px; }
      input { flex: 1; min-width: 0; border: 1px solid #3a3a44; border-radius: 8px; background: #111116;
        color: #fff; padding: 6px 8px; font: 13px system-ui, sans-serif; }
      form button { border: 0; border-radius: 8px; background: #3a3a44; color: #fff; padding: 0 10px; cursor: pointer; }
    </style>
    <div class="panel" hidden>
      <header>
        <b class="code"></b>
        <button class="icon copy" title="Copy mã phòng">⧉</button>
        <button class="icon toggle" title="Thu gọn">–</button>
      </header>
      <div class="body">
        <div class="row">
          <button class="main sync sync-off">Đồng bộ: TẮT</button>
          <button class="main resync">Resync</button>
        </div>
        <div class="drift"></div>
        <div class="notice" hidden></div>
        <div class="members"></div>
        <div class="chat"></div>
        <form>
          <input maxlength="500" placeholder="Nhắn gì đó…">
          <button>Gửi</button>
        </form>
      </div>
    </div>`;

  const $ = sel => shadow.querySelector(sel);
  const panel = $('.panel');
  const syncButton = $('.sync');
  const notice = $('.notice');
  const chat = $('.chat');
  let current = null;
  const seen = new Set();

  const mount = () => (document.body || document.documentElement).appendChild(host);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  $('.toggle').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    $('.toggle').textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });

  $('.copy').addEventListener('click', () => {
    if (current?.code) navigator.clipboard.writeText(current.code).catch(() => {});
  });

  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    const result = await send({ type: 'set_sync', on: !current?.syncing });
    syncButton.disabled = false;
    if (result?.error) showNotice(result.error);
    else if (result) renderState(result);
  });

  $('.resync').addEventListener('click', async () => {
    const result = await send({ type: 'resync' });
    if (result?.error) showNotice(result.error);
    else if (result) renderState(result);
  });

  $('form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('input');
    const text = input.value.trim();
    if (text) send({ type: 'chat_send', text });
    input.value = '';
  });

  // Keep the page's keyboard shortcuts (space = play/pause, arrows = seek) out of the chat box.
  $('input').addEventListener('keydown', event => event.stopPropagation());

  function renderState(state) {
    if (state.code !== current?.code) {
      chat.textContent = '';
      seen.clear();
    }
    current = state;
    panel.hidden = !state.code;
    if (!state.code) return;

    $('.code').textContent = `Phòng ${state.code}`;
    syncButton.textContent = state.syncing ? 'Đồng bộ: BẬT' : 'Đồng bộ: TẮT';
    syncButton.className = `main sync ${state.syncing ? 'sync-on' : 'sync-off'}`;
    renderDrift(state.syncing ? state.drift : null);

    $('.members').textContent = state.members
      .map(m => `${m.name}${m.isMe ? ' (bạn)' : ''}${m.syncing ? '' : ' · đang tắt đồng bộ'}`)
      .join(', ');

    if (state.notice) showNotice(state.notice);
    else if (state.url && !sameEpisode(state.url)) showWrongEpisode(state.url);
    else notice.hidden = true;
  }

  function renderDrift(seconds) {
    if (seconds == null) {
      $('.drift').textContent = current?.syncing ? 'Đang đồng bộ…' : 'Đồng bộ đang tắt. Bấm Bật khi phim (không phải quảng cáo) đang chạy.';
      return;
    }
    const abs = Math.abs(seconds);
    $('.drift').textContent =
      abs < 0.5 ? 'Khớp với phòng' : `${seconds > 0 ? 'Nhanh' : 'Chậm'} hơn phòng ${abs.toFixed(1)} giây`;
  }

  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = false;
  }

  function showWrongEpisode(url) {
    notice.textContent = 'Phòng đang xem tập khác. ';
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Mở đúng tập';
    notice.appendChild(link);
    notice.hidden = false;
  }

  function sameEpisode(url) {
    try {
      return new URL(url).pathname === location.pathname;
    } catch {
      return true;
    }
  }

  function addMessage(message) {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    const div = document.createElement('div');
    div.className = message.system ? 'msg system' : 'msg';
    if (message.system) {
      div.textContent = message.text;
    } else {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${message.name}: `;
      div.append(who, message.text);
    }
    if (typeof message.at === 'number') {
      div.title = new Date(message.at).toLocaleTimeString();
    }
    const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 8;
    chat.appendChild(div);
    if (atBottom) chat.scrollTop = chat.scrollHeight;
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'state') renderState(msg.state);
    else if (msg.type === 'chat') addMessage(msg.message);
    else if (msg.type === 'drift') renderDrift(msg.seconds);
  });

  send({ type: 'overlay_hello' }).then(result => {
    if (!result || result.error) return;
    renderState(result.state);
    result.chat.forEach(addMessage);
  });
}

