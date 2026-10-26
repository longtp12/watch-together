// Pages where the floating panel (overlay.js) runs. video.js runs in every frame,
// because the player usually sits in an iframe on another domain.
export const SITE_PATTERNS = [
  '*://animevietsub.sale/*',
  '*://*.animevietsub.sale/*',
];

// Where the room is right now, in seconds. offset = server clock - local clock (ms).
export function roomPosition(playback, offset, now = Date.now()) {
  if (!playback) return 0;
  if (playback.paused || typeof playback.updatedAt !== 'number') return playback.time;
  return playback.time + Math.max(0, now + offset - playback.updatedAt) / 1000;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}
