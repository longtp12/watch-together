let frames = [];

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = `tab_${tab.id}`;
  const data = await chrome.storage.session.get(key);
  frames = Object.values(data[key] || {}).sort((a, b) => b.videos.length - a.videos.length || a.frameId - b.frameId);
  render();
}

function render() {
  const out = document.getElementById('out');
  out.textContent = '';
  if (!frames.length) {
    out.textContent = 'Chưa có báo cáo nào. Tải lại trang phim rồi thử lại.';
    return;
  }
  for (const f of frames) {
    const div = document.createElement('div');
    div.className = 'frame' + (f.videos.length ? ' has-video' : '');
    const title = document.createElement('div');
    const hints = f.playerHints.length ? ` · trình phát: ${f.playerHints.join(', ')}` : '';
    title.textContent = `${f.isTopFrame ? 'Frame chính' : 'Iframe'} (frameId ${f.frameId}) · ${f.videos.length} video · ${f.iframes.length} iframe con${hints}`;
    title.style.fontWeight = '600';
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = f.url;
    div.append(title, url);
    if (f.videos.length || f.media.length || f.iframes.length) {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify({ videos: f.videos, iframes: f.iframes, media: f.media }, null, 2);
      div.appendChild(pre);
    }
    out.appendChild(div);
  }
}

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(frames, null, 2));
  document.getElementById('status').textContent = 'Đã copy.';
});
load();
