import { pwa } from '../lib/pwa';
import { usePwa } from '../hooks/usePwa';

// "Cài ứng dụng" where the browser can install the app; a hint on iPhone, where only
// Share → Add to Home Screen works; nothing once installed.
export function InstallButton() {
  const { canInstall, installed, ios } = usePwa();
  if (installed) return null;
  if (canInstall) {
    return (
      <button id="install" className="install" onClick={() => pwa.install()}>
        Cài ứng dụng
      </button>
    );
  }
  if (ios) {
    return (
      <p id="install-hint" className="hint">
        Cài thành ứng dụng: bấm nút Chia sẻ của Safari rồi chọn <b>Thêm vào MH chính</b>.
      </p>
    );
  }
  return null;
}
