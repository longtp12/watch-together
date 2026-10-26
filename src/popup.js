import { send } from './shared.js';

const $ = id => document.getElementById(id);
let current = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showError(text) {
  $('error').textContent = text || '';
  $('error').hidden = !text;
}

function render(state) {
  current = state;
  $('lobby').hidden = !!state.code;
  $('room').hidden = !state.code;
  if (!$('name').value) $('name').value = state.name || '';
  if (!state.code) return;

  $('room-code').textContent = state.code;
  $('sync').textContent = state.syncing ? 'Đồng bộ: BẬT' : 'Đồng bộ: TẮT';
  $('sync').className = state.syncing ? 'on' : '';

  const list = $('members');
  list.textContent = '';
  for (const m of state.members) {
    const li = document.createElement('li');
    li.textContent = `${m.name}${m.isMe ? ' (bạn)' : ''}${m.syncing ? '' : ' · đang tắt đồng bộ'}`;
    if (!m.syncing) li.className = 'off';
    list.appendChild(li);
  }
  if (state.notice) showError(state.notice);
}

// Runs an action, shows its error or the new state, and disables buttons meanwhile.
async function run(message) {
  showError('');
  document.querySelectorAll('button').forEach(b => (b.disabled = true));
  const result = await send(message);
  document.querySelectorAll('button').forEach(b => (b.disabled = false));
  if (!result) showError('Không liên lạc được với extension, thử mở lại popup.');
  else if (result.error) showError(result.error);
  else render(result);
}

$('create').addEventListener('click', async () => {
  const tab = await activeTab();
  run({ type: 'create_room', name: $('name').value, url: tab?.url || '' });
});

$('join').addEventListener('click', () => {
  run({ type: 'join_room', code: $('code').value, name: $('name').value });
});

$('code').addEventListener('keydown', e => e.key === 'Enter' && $('join').click());

$('copy').addEventListener('click', () => navigator.clipboard.writeText(current?.code || ''));

$('sync').addEventListener('click', async () => {
  const tab = await activeTab();
  run({ type: 'set_sync', on: !current?.syncing, tabId: tab?.id });
});

$('resync').addEventListener('click', async () => {
  const tab = await activeTab();
  run({ type: 'resync', tabId: tab?.id });
});

$('leave').addEventListener('click', () => run({ type: 'leave_room' }));

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'state') render(msg.state);
});

send({ type: 'get_state' }).then(state => {
  if (state && !state.error) render(state);
  else showError(state?.error || 'Extension chưa sẵn sàng. Kiểm tra cấu hình Firebase trong src/config.js.');
});
