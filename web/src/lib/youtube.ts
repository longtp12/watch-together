// Thin wrapper around the YouTube IFrame Player API, so the sync engine only deals with
// play/pause/seek and two callbacks.
const API_URL = 'https://www.youtube.com/iframe_api';

export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const ERRORS: Record<number, string> = {
  2: 'Link video không hợp lệ.',
  5: 'Trình duyệt không phát được video này.',
  100: 'Video không tồn tại hoặc đã bị ẩn.',
  101: 'Video này không cho phép xem nhúng. Hãy chọn video khác.',
  150: 'Video này không cho phép xem nhúng. Hãy chọn video khác.',
};

type ApiWindow = Window & { YT?: typeof YT; onYouTubeIframeAPIReady?: () => void };

let apiPromise: Promise<typeof YT> | null = null;

function loadApi() {
  apiPromise ??= new Promise((resolve, reject) => {
    const w = window as ApiWindow;
    if (w.YT?.Player) return resolve(w.YT);
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT!);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Không tải được trình phát YouTube. Kiểm tra mạng rồi tải lại trang.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

interface Handlers {
  onStateChange: (state: number) => void;
  onError: (message: string) => void;
}

export class YouTubePlayer {
  private player: YT.Player | null = null;
  private videoId: string | null = null;
  private destroyed = false;
  private creating: Promise<void> | null = null;

  // The API replaces the element it is given, so it gets a child of host that React never renders.
  constructor(
    private host: HTMLElement,
    private handlers: Handlers,
  ) {}

  // Shows a video without starting it. The first call creates the player.
  async load(videoId: string) {
    if (videoId === this.videoId) return;
    this.videoId = videoId;
    if (!this.creating) {
      this.creating = this.create(videoId);
      return this.creating;
    }
    await this.creating;
    if (this.ready && this.videoId === videoId) this.player!.cueVideoById(videoId);
  }

  private async create(videoId: string) {
    const api = await loadApi();
    if (this.destroyed) return;
    const element = document.createElement('div');
    this.host.appendChild(element);
    await new Promise<void>(resolve => {
      this.player = new api.Player(element, {
        videoId,
        playerVars: { playsinline: 1, rel: 0, enablejsapi: 1, origin: location.origin },
        events: {
          onReady: () => resolve(),
          onStateChange: event => this.handlers.onStateChange(event.data),
          onError: event => this.handlers.onError(ERRORS[event.data] || `Lỗi trình phát YouTube (${event.data}).`),
        },
      });
    });
  }

  get ready() {
    return !this.destroyed && typeof this.player?.getPlayerState === 'function';
  }

  get state(): number {
    return this.ready ? this.player!.getPlayerState() : STATE.UNSTARTED;
  }

  // Paused, cued, ended and not-yet-started all count as "not playing".
  get paused() {
    const s = this.state;
    return s !== STATE.PLAYING && s !== STATE.BUFFERING;
  }

  get time() {
    return this.ready ? this.player!.getCurrentTime() || 0 : 0;
  }

  get rate() {
    return this.ready ? this.player!.getPlaybackRate() || 1 : 1;
  }

  get duration() {
    return this.ready ? this.player!.getDuration() || 0 : 0;
  }

  play() {
    if (this.ready) this.player!.playVideo();
  }

  pause() {
    if (this.ready) this.player!.pauseVideo();
  }

  seek(seconds: number) {
    if (!this.ready) return;
    const max = this.duration > 1 ? this.duration - 0.5 : seconds;
    this.player!.seekTo(Math.max(0, Math.min(seconds, max)), true);
  }

  // Shows the video paused at a position, with its thumbnail, without starting it.
  // (Seeking a cued video makes YouTube start playing it.)
  cueAt(seconds: number) {
    if (this.ready && this.videoId) this.player!.cueVideoById({ videoId: this.videoId, startSeconds: Math.max(0, seconds) });
  }

  destroy() {
    this.destroyed = true;
    this.player?.destroy();
    this.player = null;
    this.host.textContent = '';
  }
}

// Accepts watch?v=, youtu.be/, shorts/, embed/, live/ links or a bare 11-character id.
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null | undefined = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
