// Firebase project settings live in firebase-config.js (not committed to git).
// Copy firebase-config.example.js to firebase-config.js and fill it in.
export { FIREBASE_CONFIG } from './firebase-config.js';

// true = use the local Firebase emulators (npm run emulators) instead of the real project.
export const USE_EMULATOR = false;
export const EMULATOR_HOST = '127.0.0.1';

// How often a playing video is checked against the room position, and when it gets corrected.
export const DRIFT_CHECK_MS = 5000;
export const DRIFT_SEEK_SECONDS = 1.5;
export const DRIFT_RATE_SECONDS = 0.3;

// Videos shorter than this are treated as ads.
export const AD_MAX_SECONDS = 120;

export const CHAT_HISTORY = 50;
