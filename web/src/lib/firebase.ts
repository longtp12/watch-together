import { initializeApp } from 'firebase/app';
import { initializeAuth, browserSessionPersistence, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator, ref, onValue } from 'firebase/database';
import { FIREBASE_CONFIG, USE_EMULATOR, EMULATOR_HOST } from '../../../src/config.js';

const app = initializeApp(FIREBASE_CONFIG);
// Session persistence gives each tab its own uid, so two tabs in one browser are two members.
const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getDatabase(app);
if (USE_EMULATOR) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, EMULATOR_HOST, 9000);
}

let offset = 0; // server clock - local clock, ms
onValue(ref(db, '.info/serverTimeOffset'), snap => {
  offset = snap.val() || 0;
});

export const serverOffset = () => offset;

// Resolves with this tab's anonymous uid.
export const signedIn: Promise<string> = (async () => {
  await auth.authStateReady();
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  return user.uid;
})();
