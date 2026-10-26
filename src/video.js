// Runs in every frame. Does nothing until background.js asks it to probe for a
// video or attach to one; then it reports local play/pause/seek and applies the room's.
import { roomPosition, send } from './shared.js';
import { DRIFT_CHECK_MS, DRIFT_SEEK_SECONDS, DRIFT_RATE_SECONDS, AD_MAX_SECONDS } from './config.js';

let video = null;
let attachedSrc = null;
let playback = null;
let offset = 0;
let expected = null; // the state we just applied, so its own events are not sent back
let pendingSend = null;
let pendingAction = null;
let driftTimer = null;
let playButton = null;

const LOCAL_EVENTS = ['play', 'pause', 'seeked'];

function allVideos(root = document, out = []) {
  root.querySelectorAll('video').forEach(v => out.push(v));
  root.querySelectorAll('*').forEach(el => el.shadowRoot && allVideos(el.shadowRoot, out));
  return out;
}

function describe(v) {
  const rect = v.getBoundingClientRect();
  const style = getComputedStyle(v);
  const area = Math.round(rect.width * rect.height);
  return {
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    visible: area > 0 && style.display !== 'none' && style.visibility !== 'hidden',
    area,
    paused: v.paused,
    src: v.currentSrc || v.src || '',
  };
}

function bestVideo() {
  return allVideos()
    .map(v => ({ v, info: describe(v) }))
    .sort((a, b) => b.info.visible - a.info.visible || b.info.duration - a.info.duration || b.info.area - a.info.area)[0];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'probe': {
      const best = bestVideo();
      sendResponse(best ? best.info : null);
      return;
    }
    case 'attach': {
      const best = bestVideo();
      if (best) attach(best.v);
      sendResponse({ ok: !!best });
      return;
    }
    case 'detach':
      detach();
      sendResponse({ ok: true });
      return;
    case 'apply':
      playback = msg.playback;
      offset = msg.offset || 0;
      apply(msg.force);
      sendResponse({ ok: true });
      return;
  }
});

function attach(v) {
  if (video !== v) detach();
  video = v;
  attachedSrc = v.currentSrc || v.src;
  LOCAL_EVENTS.forEach(type => v.addEventListener(type, onLocalEvent));
  v.addEventListener('loadedmetadata', onSourceChange);
  clearInterval(driftTimer);
  driftTimer = setInterval(checkDrift, DRIFT_CHECK_MS);
}

function detach() {
  if (video) {
    LOCAL_EVENTS.forEach(type => video.removeEventListener(type, onLocalEvent));
    video.removeEventListener('loadedmetadata', onSourceChange);
    video.playbackRate = 1;
  }
  clearInterval(driftTimer);
  clearTimeout(pendingSend);
  pendingSend = null;
  hidePlayButton();
  video = null;
  playback = null;
  expected = null;
}

// ---------- Room → video ----------

function apply(force) {
  if (!video || !playback) return;
  const target = roomPosition(playback, offset);
  expected = { paused: playback.paused, time: target, until: Date.now() + 2000 };

  // A paused room should match closely; a playing one gets a little slack to avoid stutter.
  const tolerance = playback.paused ? 0.2 : 0.5;
  if (force || Math.abs(video.currentTime - target) > tolerance) seekTo(target);
  video.playbackRate = 1;

  if (playback.paused) {
    if (!video.paused) video.pause();
    hidePlayButton();
  } else if (video.paused) {
    video.play().then(hidePlayButton, showPlayButton);
  }
}

function seekTo(seconds) {
  const max = Number.isFinite(video.duration) ? video.duration - 0.5 : seconds;
  video.currentTime = Math.max(0, Math.min(seconds, max));
}

function isEcho(type) {
  if (!expected) return false;
  if (Date.now() > expected.until) {
    expected = null;
    return false;
  }
  if (type === 'play') return !expected.paused;
  if (type === 'pause') return expected.paused;
  return Math.abs(video.currentTime - expected.time) < 1.5;
}

// ---------- Video → room ----------

// Players often fire pause, seeked, play in a row for one click, so wait briefly
// and send the final state once.
function onLocalEvent(event) {
  if (isEcho(event.type)) return;
  expected = null;
  if (event.type === 'seeked' || pendingAction !== 'seek') {
    pendingAction = event.type === 'seeked' ? 'seek' : event.type;
  }
  clearTimeout(pendingSend);
  pendingSend = setTimeout(() => {
    if (!video) return;
    send({ type: 'local_event', action: pendingAction, paused: video.paused, time: video.currentTime });
    playback = { paused: video.paused, time: video.currentTime, updatedAt: Date.now() + offset };
    pendingAction = null;
    pendingSend = null;
  }, 200);
}

function onSourceChange() {
  const src = video.currentSrc || video.src;
  if (src !== attachedSrc && video.duration < AD_MAX_SECONDS) send({ type: 'ad_detected' });
}

// ---------- Drift ----------

function checkDrift() {
  if (!video) return;
  if (!video.isConnected) {
    send({ type: 'video_lost' });
    return;
  }
  if (!playback || pendingSend || video.seeking || video.readyState < 3) return;

  const target = roomPosition(playback, offset);
  const diff = video.currentTime - target;
  send({ type: 'drift', seconds: diff });

  if (playback.paused !== video.paused) {
    if (!playButton) apply(false);
    return;
  }
  if (Math.abs(diff) > DRIFT_SEEK_SECONDS) {
    expected = { paused: playback.paused, time: target, until: Date.now() + 2000 };
    seekTo(target);
    video.playbackRate = 1;
  } else if (!playback.paused && Math.abs(diff) > DRIFT_RATE_SECONDS) {
    video.playbackRate = diff > 0 ? 0.95 : 1.05;
  } else {
    video.playbackRate = 1;
  }
}

// ---------- Autoplay blocked ----------

// Chrome refuses play() until the user has clicked in this frame, so ask for one click.
function showPlayButton() {
  if (playButton || !video) return;
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      button { position: fixed; inset: 0; margin: auto; width: 240px; height: 64px; z-index: 2147483647;
        border: 0; border-radius: 12px; background: #7c3aed; color: #fff; font: 600 16px system-ui, sans-serif;
        cursor: pointer; box-shadow: 0 4px 24px rgba(0,0,0,.5); }
    </style>
    <button>▶ Bấm để đồng bộ</button>`;
  shadow.querySelector('button').addEventListener('click', () => {
    hidePlayButton();
    apply(true);
  });
  (document.body || document.documentElement).appendChild(host);
  playButton = host;
}

function hidePlayButton() {
  playButton?.remove();
  playButton = null;
}
