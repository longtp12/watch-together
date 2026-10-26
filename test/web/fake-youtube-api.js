// Stand-in for https://www.youtube.com/iframe_api in tests: same YT.Player surface
// (the parts app.js uses), backed by a local <video>. Video ids map to test files;
// "noembed0000" fails like a video whose owner disabled embedding.
(() => {
  const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const MEDIA = { bbbbbbbbbbb: '/media/ad.webm' };

  class Player {
    constructor(element, { videoId, events = {} }) {
      this.events = events;
      this.state = PlayerState.UNSTARTED;
      const video = (this.video = document.createElement('video'));
      video.controls = true;
      video.preload = 'auto';
      (typeof element === 'string' ? document.getElementById(element) : element).replaceWith(video);

      video.addEventListener('playing', () => this.setState(PlayerState.PLAYING));
      video.addEventListener('pause', () => !video.ended && this.setState(PlayerState.PAUSED));
      video.addEventListener('waiting', () => this.setState(PlayerState.BUFFERING));
      video.addEventListener('ended', () => this.setState(PlayerState.ENDED));
      video.addEventListener('seeking', () => this.state !== PlayerState.CUED && this.setState(PlayerState.BUFFERING));
      video.addEventListener('seeked', () => {
        if (this.state === PlayerState.CUED) return;
        this.setState(video.paused ? PlayerState.PAUSED : PlayerState.PLAYING);
      });

      this.cueVideoById(videoId, () => events.onReady?.({ target: this }));
    }

    setState(state) {
      if (state === this.state) return;
      this.state = state;
      this.events.onStateChange?.({ target: this, data: state });
    }

    cueVideoById(videoIdOrOptions, done) {
      const { videoId, startSeconds = 0 } =
        typeof videoIdOrOptions === 'string' ? { videoId: videoIdOrOptions } : videoIdOrOptions;
      this.videoId = videoId;
      if (videoId === 'noembed0000') {
        this.video.removeAttribute('src');
        setTimeout(() => {
          done?.();
          this.events.onError?.({ target: this, data: 150 });
        }, 100);
        return;
      }
      this.state = PlayerState.UNSTARTED;
      this.video.src = MEDIA[videoId] || '/media/movie.webm';
      this.video.addEventListener(
        'loadedmetadata',
        () => {
          if (startSeconds) this.video.currentTime = startSeconds;
          this.setState(PlayerState.CUED);
          done?.();
        },
        { once: true },
      );
    }

    loadVideoById(videoId) {
      this.cueVideoById(videoId, () => this.playVideo());
    }

    playVideo() {
      this.video.play().catch(() => this.setState(PlayerState.UNSTARTED));
    }

    pauseVideo() {
      this.video.pause();
    }

    // Like YouTube: seeking a cued video starts it, seeking a paused one keeps it paused.
    seekTo(seconds) {
      const cued = this.state === PlayerState.CUED;
      this.video.currentTime = seconds;
      if (cued) {
        this.state = PlayerState.BUFFERING;
        this.playVideo();
      }
    }

    getCurrentTime() {
      return this.video.currentTime;
    }

    getDuration() {
      return Number.isFinite(this.video.duration) ? this.video.duration : 0;
    }

    getPlaybackRate() {
      return this.video.playbackRate;
    }

    getPlayerState() {
      return this.state;
    }

    destroy() {
      this.video.remove();
    }
  }

  window.YT = { Player, PlayerState };
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
})();
