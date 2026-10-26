// Runs in every frame. Every 2 s for the first minute, reports the frame's videos
// (including inside open shadow roots), child iframes and media requests.
(() => {
  const SCAN_EVERY_MS = 2000;
  const SCAN_FOR_MS = 60000;
  const MEDIA_URL = /\.(m3u8|mpd|mp4|webm|ts)(\?|$)|\/hls\//i;
  let lastReport = '';

  function allRoots(root, out = []) {
    out.push(root);
    root.querySelectorAll('*').forEach(el => el.shadowRoot && allRoots(el.shadowRoot, out));
    return out;
  }

  function parentChain(el) {
    const parts = [];
    for (let node = el, i = 0; node && node.nodeType === 1 && i < 5; node = node.parentElement, i++) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += '#' + node.id;
      else if (typeof node.className === 'string' && node.className.trim()) {
        part += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function describeVideo(v, inShadowRoot) {
    const r = v.getBoundingClientRect();
    const style = getComputedStyle(v);
    return {
      inShadowRoot,
      src: v.getAttribute('src'),
      currentSrc: v.currentSrc || null,
      duration: Number.isFinite(v.duration) ? Math.round(v.duration) : String(v.duration),
      paused: v.paused,
      readyState: v.readyState,
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      hidden: style.display === 'none' || style.visibility === 'hidden' || r.width === 0,
      path: parentChain(v),
    };
  }

  function scan() {
    if (!document.documentElement) return;
    const videos = [];
    allRoots(document).forEach((root, i) => root.querySelectorAll('video').forEach(v => videos.push(describeVideo(v, i > 0))));

    const report = {
      url: location.href,
      isTopFrame: window === window.top,
      videos,
      iframes: [...document.querySelectorAll('iframe')].map(f => ({
        src: f.getAttribute('src') || '(không có src)',
        size: `${f.clientWidth}x${f.clientHeight}`,
        sandbox: f.getAttribute('sandbox'),
      })),
      media: [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(u => MEDIA_URL.test(u)))].slice(0, 20),
      // Content scripts can't see page variables, so guess the player from its markup.
      playerHints: Object.entries({
        'JW Player': '.jwplayer, .jw-wrapper',
        'Video.js': '.video-js',
        Plyr: '.plyr',
        ArtPlayer: '.art-video-player',
        DPlayer: '.dplayer',
      })
        .filter(([, sel]) => document.querySelector(sel))
        .map(([name]) => name),
    };

    const key = JSON.stringify(report);
    if (key === lastReport) return;
    lastReport = key;
    chrome.runtime.sendMessage({ type: 'probe_report', report }).catch(() => {});
  }

  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > SCAN_FOR_MS) clearInterval(timer);
    scan();
  }, SCAN_EVERY_MS);
  document.addEventListener('DOMContentLoaded', scan);
  window.addEventListener('load', scan);
})();
