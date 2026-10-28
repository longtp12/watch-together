// Vite config for the YouTube web app. web/ is the Vite root; the build goes to web/dist/.
//   vite web                       dev server on http://localhost:5173
//   vite build web                 production build
//   vite build web --mode emulator build that talks to the local Firebase emulators (tests)
// Firebase config comes from the FIREBASE_* variables (Vercel, or web/.env.local on your
// machine), otherwise from src/firebase-config.js, the file the extension uses.
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(webDir);

const ENV_KEYS = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  databaseURL: 'FIREBASE_DATABASE_URL',
  projectId: 'FIREBASE_PROJECT_ID',
  appId: 'FIREBASE_APP_ID',
} as const;

const DEMO_CONFIG = {
  apiKey: 'demo-key',
  projectId: 'demo-watch-together',
  databaseURL: 'http://127.0.0.1:9000?ns=demo-watch-together-default-rtdb',
};

type FirebaseConfig = Partial<Record<keyof typeof ENV_KEYS, string>>;

// Returns the config to inject, or null to use src/firebase-config.js as it is.
function configOverride(env: Record<string, string>, emulator: boolean): FirebaseConfig | null {
  if (emulator) return DEMO_CONFIG;
  const fromEnv: FirebaseConfig = {};
  for (const [key, name] of Object.entries(ENV_KEYS) as [keyof typeof ENV_KEYS, string][]) {
    const value = env[name]?.trim();
    if (value) fromEnv[key] = value;
  }
  if (Object.keys(fromEnv).length) {
    const missing = (['apiKey', 'databaseURL', 'projectId'] as const).filter(key => !fromEnv[key]).map(key => ENV_KEYS[key]);
    if (missing.length) throw new Error(`Thiếu biến môi trường: ${missing.join(', ')}`);
    return fromEnv;
  }
  const file = path.join(repoRoot, 'src/firebase-config.js');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').includes('DIEN_')) {
    throw new Error(
      'Chưa có config Firebase. Đặt các biến FIREBASE_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_PROJECT_ID ' +
        '(và FIREBASE_AUTH_DOMAIN, FIREBASE_APP_ID) trên Vercel hoặc trong web/.env.local, hoặc tạo src/firebase-config.js.',
    );
  }
  return null;
}

function firebaseConfig(override: FirebaseConfig | null, emulator: boolean): Plugin {
  const virtualId = '\0firebase-config';
  return {
    name: 'firebase-config',
    enforce: 'pre',
    resolveId(source, importer) {
      if (override && source.endsWith('firebase-config.js') && importer && /[\\/]src[\\/]config\.js$/.test(importer)) {
        return virtualId;
      }
      return null;
    },
    load(id) {
      return id === virtualId ? `export const FIREBASE_CONFIG = ${JSON.stringify(override)};` : null;
    },
    transform(code, id) {
      if (emulator && /[\\/]src[\\/]config\.js$/.test(id)) return code.replace('USE_EMULATOR = false', 'USE_EMULATOR = true');
      return null;
    },
  };
}

// Installable app: manifest + a service worker that keeps the app files (HTML, JS, CSS, icons)
// on the device. YouTube and Firebase always go to the network; the service worker never touches them.
function pwa() {
  return VitePWA({
    registerType: 'prompt', // a new version waits for the user's "Tải lại" instead of reloading mid-video
    injectRegister: false, // registered in src/lib/pwa.ts
    includeAssets: ['icon.png', 'icons/apple-touch-icon.png'],
    manifest: {
      name: 'Watch Together',
      short_name: 'Watch Together',
      description: 'Xem YouTube cùng bạn bè: ai play, pause hay tua thì mọi người trong phòng làm theo.',
      lang: 'vi',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#7c3aed',
      background_color: '#0f0f13',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
      navigateFallback: '/index.html',
      cleanupOutdatedCaches: true,
    },
    devOptions: { enabled: false },
  });
}

export default defineConfig(({ mode }) => {
  const emulator = mode === 'emulator';
  const env = loadEnv(mode, webDir, 'FIREBASE_');
  return {
    root: webDir,
    plugins: [react(), firebaseConfig(configOverride(env, emulator), emulator), pwa()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: { manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/database'], react: ['react', 'react-dom', 'react-dom/client'] } },
      },
    },
    server: { port: 5173, fs: { allow: [repoRoot] } },
  };
});
