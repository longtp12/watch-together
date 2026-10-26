import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { serverOffset } from '../lib/firebase';
import { watchPlayback, watchVideoId, writePlayback } from '../lib/room';
import { SyncEngine, type SyncView } from '../lib/sync-engine';

const EMPTY_VIEW: SyncView = { drift: null, needsGesture: false, notice: null };
const noop = () => () => {};

// Creates the SyncEngine for a room, feeds it the room's video and playback,
// and returns the engine (for its actions) plus the view React renders.
export function useSyncEngine(host: RefObject<HTMLDivElement | null>, code: string, uid: string, name: string) {
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  useEffect(() => {
    const sync = new SyncEngine(host.current!, {
      uid,
      getOffset: serverOffset,
      send: (paused, time, action) => writePlayback(code, uid, name, paused, time, action),
    });
    const stops = [
      watchVideoId(code, videoId => videoId && sync.setVideo(videoId)),
      watchPlayback(code, playback => sync.setPlayback(playback)),
    ];
    setEngine(sync);
    return () => {
      stops.forEach(stop => stop());
      sync.destroy();
      setEngine(null);
    };
  }, [host, code, uid, name]);

  const view = useSyncExternalStore(engine?.subscribe ?? noop, engine?.getView ?? (() => EMPTY_VIEW));
  return { engine, view };
}
