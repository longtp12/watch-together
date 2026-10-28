import { useEffect, useState } from 'react';
import { signedIn } from './lib/firebase';
import { leaveRoom } from './lib/room';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';
import { StatusBars } from './components/StatusBars';

export interface Session {
  code: string;
  name: string;
}

export function App() {
  const [uid, setUid] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    signedIn.then(setUid, err => setError(`Không kết nối được Firebase: ${err.message}`));
  }, []);

  // Opening another invite link while in a room starts over with that room.
  useEffect(() => {
    const onHashChange = () => {
      if (session && codeFromHash() !== session.code) location.reload();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [session]);

  const join = (next: Session) => {
    history.replaceState(null, '', `#${next.code}`);
    setSession(next);
  };

  const leave = async () => {
    if (uid && session) await leaveRoom(session.code, uid);
    history.replaceState(null, '', location.pathname);
    setSession(null);
  };

  return (
    <>
      <StatusBars />
      {session && uid ? (
        <Room code={session.code} name={session.name} uid={uid} onLeave={leave} />
      ) : (
        <Lobby uid={uid} invitedCode={codeFromHash()} startupError={error} onJoined={join} />
      )}
    </>
  );
}

export function codeFromHash() {
  const value = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(value) ? value : null;
}
