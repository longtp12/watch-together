// Installable-app state for React: whether a new version is waiting, whether the browser
// offers an install dialog, and whether we already run as an installed app.
import { registerSW } from 'virtual:pwa-register';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  needRefresh: boolean; // a new version is downloaded and waits for "Tải lại"
  canInstall: boolean; // Chrome / Edge / Android offered an install dialog
  installed: boolean; // running as the installed app
  ios: boolean; // Safari on iPhone / iPad: no install dialog, only "Add to Home Screen"
}

const standalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let state: PwaState = { needRefresh: false, canInstall: false, installed: standalone, ios: ios && !standalone };
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function set(change: Partial<PwaState>) {
  state = { ...state, ...change };
  listeners.forEach(listener => listener());
}

export const pwa = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,
  async install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    set({ canInstall: false, installed: outcome === 'accepted' });
  },
  reload: () => updateSW(true),
};

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); // show our own button instead of the browser's mini bar
  installPrompt = event as InstallPromptEvent;
  set({ canInstall: true });
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  set({ canInstall: false, installed: true });
});

const updateSW = registerSW({
  onNeedRefresh: () => set({ needRefresh: true }),
});
