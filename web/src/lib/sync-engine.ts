// Keeps one YouTube player in step with the room. Lives outside React state on purpose:
// it reacts within a few hundred milliseconds and keeps timestamps, and React re-renders
// must never call the player. React reads the small SyncView through subscribe/getView.
import { DRIFT_CHECK_MS, DRIFT_SEEK_SECONDS } from '../../../src/config.js';
import { roomPosition } from '../../../src/shared.js';
import { YouTubePlayer, STATE } from './youtube';
import type { Playback, PlaybackAction } from '../types';

export interface SyncView {
  drift: number | null; // seconds ahead (+) or behind (-) the room
  needsGesture: boolean; // the browser blocked autoplay, show "click to play"
  notice: string | null;
}

interface Options {
  uid: string;
  getOffset: () => number; // server clock - local clock, ms
  send: (paused: boolean, time: number, action: PlaybackAction) => Promise<void>;
}

// The state we just applied, so the player's own events about it are not sent back.
interface Expected {
  paused: boolean;
  time: number;
  at: number;
  until: number;
  fromCued: boolean;
}

interface Sample {
  time: number;
  at: number;
  playing: boolean;
  rate: number;
}

export class SyncEngine {
  videoId: string | null = null;
  private player: YouTubePlayer;
  private playback: Playback | null = null;
  private expected: Expected | null = null;
  private pendingSend: number | null = null;
  private pendingAction: PlaybackAction | null = null;
  private lastSample: Sample | null = null;
  private autoplayTimer: number | null = null;
  private firstPlayback = true;
  private timers: number[];
  private view: SyncView = { drift: null, needsGesture: false, notice: null };
  private listeners = new Set<() => void>();

  constructor(
    host: HTMLElement,
    private options: Options,
  ) {
    this.player = new YouTubePlayer(host, {
      onStateChange: state => this.onStateChange(state),
      onError: message => this.showNotice(message),
    });
    this.timers = [window.setInterval(() => this.poll(), 500), window.setInterval(() => this.checkDrift(), DRIFT_CHECK_MS)];
  }

  // ---------- For React ----------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private setView(change: Partial<SyncView>) {
    if (Object.entries(change).every(([key, value]) => this.view[key as keyof SyncView] === value)) return;
    this.view = { ...this.view, ...change };
    this.listeners.forEach(listener => listener());
  }

  showNotice(text: string | null) {
    this.setView({ notice: text });
  }

  destroy() {
    this.timers.forEach(clearInterval);
    if (this.pendingSend) clearTimeout(this.pendingSend);
    if (this.autoplayTimer) clearTimeout(this.autoplayTimer);
    this.player.destroy();
    this.listeners.clear();
  }

  // ---------- Room → player ----------

  setPlayback(playback: Playback | null) {
    this.playback = playback;
    if (!playback) return;
    // Our own writes are already on screen, except the first one we see after joining.
    if (playback.by !== this.options.uid || this.firstPlayback) {
      this.firstPlayback = false;
      this.apply(true);
    }
  }

  async setVideo(videoId: string) {
    if (videoId === this.videoId) return;
    this.videoId = videoId;
    this.showNotice(null);
    try {
      await this.player.load(videoId);
    } catch (err) {
      this.showNotice((err as Error).message);
      return;
    }
    this.lastSample = null;
    this.apply(true);
  }

  // We just changed the video for everyone: start it paused at 0:00 without waiting for Firebase.
  startNewVideo() {
    this.playback = { paused: true, time: 0, updatedAt: Date.now() + this.options.getOffset(), by: this.options.uid };
  }

  // Jump back to where the room is. Reads only, never writes.
  resync() {
    this.showNotice(null);
    this.hideGesture();
    this.apply(true);
  }

  playFromGesture() {
    this.hideGesture();
    this.apply(true);
  }

  private apply(force: boolean) {
    const { player, playback } = this;
    if (!player.ready || !playback) return;
    const target = roomPosition(playback, this.options.getOffset());
    const now = Date.now();
    // Seeking a cued video makes YouTube start it, so a paused room has to pause it again afterwards.
    const cued = player.state === STATE.CUED || player.state === STATE.UNSTARTED;
    this.expected = { paused: playback.paused, time: target, at: now, until: now + 2000, fromCued: cued };
    this.lastSample = null;

    // A paused room on a video that has not started yet: keep YouTube's thumbnail instead of
    // seeking, which would start the video.
    if (cued && playback.paused) {
      this.expected = null;
      this.hideGesture();
      if (target > 0.5) player.cueAt(target);
      return;
    }

    // Past the end of the video (it finished for everyone): leave it alone.
    if (!playback.paused && player.duration > 1 && target >= player.duration - 1) return;

    const tolerance = playback.paused ? 0.3 : 0.7;
    if (force || Math.abs(player.time - target) > tolerance) player.seek(target);

    if (playback.paused) {
      this.hideGesture();
      if (!player.paused || player.state === STATE.CUED) player.pause();
    } else if (player.paused) {
      player.play();
      this.watchAutoplay();
    }
  }

  private expecting() {
    if (this.expected && Date.now() > this.expected.until) this.expected = null;
    return this.expected;
  }

  private expectedPosition(expected: Expected, now: number) {
    return expected.time + (expected.paused ? 0 : (now - expected.at) / 1000);
  }

  // Chrome may refuse to start the video until the user clicks on this page.
  private watchAutoplay() {
    if (this.autoplayTimer) clearTimeout(this.autoplayTimer);
    this.autoplayTimer = window.setTimeout(() => {
      const { player, playback } = this;
      if (playback && !playback.paused && player.paused && player.state !== STATE.BUFFERING) {
        this.setView({ needsGesture: true });
      }
    }, 2500);
  }

  private hideGesture() {
    if (this.autoplayTimer) clearTimeout(this.autoplayTimer);
    this.setView({ needsGesture: false });
  }

  // ---------- Player → room ----------

  private onStateChange(state: number) {
    if (state === STATE.PLAYING) this.hideGesture();
    if (state !== STATE.PLAYING && state !== STATE.PAUSED) return;
    const paused = state === STATE.PAUSED;
    const expected = this.expecting();
    if (expected) {
      if (expected.paused === paused) return;
      if (expected.fromCued && expected.paused && !paused) {
        expected.fromCued = false;
        this.player.pause();
        return;
      }
    }
    this.queueSend(paused ? 'pause' : 'play');
  }

  // The API has no seek event, so compare each sample with where the video should be by now.
  private poll() {
    const { player } = this;
    if (!player.ready) return;
    const now = Date.now();
    const state = player.state;
    const time = player.time;
    const last = this.lastSample;
    if (last && state !== STATE.CUED && state !== STATE.UNSTARTED) {
      const elapsed = (now - last.at) / 1000;
      const predicted = last.time + (last.playing ? elapsed * last.rate : 0);
      const expected = this.expecting();
      const ourSeek = expected && Math.abs(time - this.expectedPosition(expected, now)) < DRIFT_SEEK_SECONDS;
      if (Math.abs(time - predicted) > DRIFT_SEEK_SECONDS && !ourSeek) this.queueSend('seek');
    }
    this.lastSample = { time, at: now, playing: state === STATE.PLAYING, rate: player.rate };
  }

  // One click can produce several changes (pause, seek, play), so wait briefly and send the end state.
  private queueSend(action: PlaybackAction) {
    this.expected = null;
    if (action === 'seek' || this.pendingAction !== 'seek') this.pendingAction = action;
    if (this.pendingSend) clearTimeout(this.pendingSend);
    this.pendingSend = window.setTimeout(() => this.sendPlayback(), 250);
  }

  private sendPlayback() {
    const action = this.pendingAction ?? 'play';
    this.pendingSend = null;
    this.pendingAction = null;
    const { paused, time } = this.player;
    this.playback = { paused, time, updatedAt: Date.now() + this.options.getOffset(), by: this.options.uid };
    this.options
      .send(paused, time, action)
      .catch(err => this.showNotice(`Không gửi được trạng thái: ${(err as Error).message}`));
  }

  // ---------- Drift ----------

  private checkDrift() {
    const { player, playback } = this;
    if (!player.ready || !playback || this.pendingSend || this.view.needsGesture) return;
    const state = player.state;
    if (state === STATE.BUFFERING || state === STATE.UNSTARTED) return;
    if (state === STATE.CUED && playback.paused) return;
    const target = roomPosition(playback, this.options.getOffset());
    if (!playback.paused && player.duration > 1 && target >= player.duration - 1) {
      this.setView({ drift: null });
      return;
    }
    if (playback.paused !== player.paused) {
      this.apply(false);
      return;
    }
    const diff = player.time - target;
    this.setView({ drift: Math.round(diff * 10) / 10 });
    if (Math.abs(diff) > DRIFT_SEEK_SECONDS) {
      const now = Date.now();
      this.expected = { paused: playback.paused, time: target, at: now, until: now + 2000, fromCued: false };
      this.lastSample = null;
      player.seek(target);
    }
  }
}
