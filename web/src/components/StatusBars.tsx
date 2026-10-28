import { pwa } from '../lib/pwa';
import { useOnline } from '../hooks/useOnline';
import { usePwa } from '../hooks/usePwa';

// Thin bars at the top of every screen: no network, or a new version waiting.
export function StatusBars() {
  const online = useOnline();
  const { needRefresh } = usePwa();
  return (
    <>
      {!online && (
        <div id="offline-bar" className="status-bar offline">
          Mất kết nối mạng, cần mạng để xem chung.
        </div>
      )}
      {needRefresh && (
        <div id="update-bar" className="status-bar update">
          Có bản mới.
          <button onClick={() => pwa.reload()}>Tải lại</button>
        </div>
      )}
    </>
  );
}
