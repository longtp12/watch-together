import { useRef, useState, type FormEvent } from 'react';
import { useSyncEngine } from '../hooks/useSyncEngine';
import { changeVideo } from '../lib/room';
import { parseVideoId } from '../lib/youtube';

interface Props {
  code: string;
  name: string;
  uid: string;
}

function driftText(seconds: number | null) {
  if (seconds == null) return '';
  const abs = Math.abs(seconds);
  return abs < 0.5 ? 'Khớp với phòng' : `${seconds > 0 ? 'Nhanh' : 'Chậm'} hơn phòng ${abs.toFixed(1)} giây`;
}

export function PlayerPanel({ code, name, uid }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const { engine, view } = useSyncEngine(host, code, uid, name);
  const [videoUrl, setVideoUrl] = useState('');

  const change = async (event: FormEvent) => {
    event.preventDefault();
    const videoId = parseVideoId(videoUrl);
    if (!videoId) return engine?.showNotice('Link YouTube không hợp lệ.');
    setVideoUrl('');
    if (!engine || videoId === engine.videoId) return;
    engine.startNewVideo();
    try {
      await changeVideo(code, uid, name, videoId);
    } catch (err) {
      engine.showNotice(`Không đổi được video: ${(err as Error).message}`);
    }
  };

  return (
    <section className="stage">
      <div className="player-box">
        <div id="player" className="player-host" ref={host} />
        {view.needsGesture && (
          <button id="play-gesture" className="play-gesture" onClick={() => engine?.playFromGesture()}>
            ▶ Bấm để phát cùng phòng
          </button>
        )}
      </div>
      <div className="controls">
        <button id="resync" onClick={() => engine?.resync()}>
          Resync
        </button>
        <span id="drift" className="drift">
          {driftText(view.drift)}
        </span>
      </div>
      <form id="change-form" className="change" onSubmit={change}>
        <input
          id="change-url"
          placeholder="Dán link YouTube khác để đổi video cho cả phòng"
          value={videoUrl}
          onChange={e => setVideoUrl(e.target.value)}
        />
        <button>Đổi video</button>
      </form>
      {view.notice && (
        <p id="notice" className="notice">
          {view.notice}
        </p>
      )}
    </section>
  );
}
