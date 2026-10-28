import { useState, type FormEvent } from 'react';
import { signedIn } from '../lib/firebase';
import { createRoom, extractRoomCode, joinRoom } from '../lib/room';
import { parseVideoId } from '../lib/youtube';
import type { Session } from '../App';
import { InstallButton } from './InstallButton';

interface Props {
  uid: string | null;
  invitedCode: string | null;
  startupError: string | null;
  onJoined: (session: Session) => void;
}

function loadName() {
  try {
    return localStorage.getItem('wt-name') || '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem('wt-name', name);
  } catch {}
}

export function Lobby({ uid, invitedCode, startupError, onJoined }: Props) {
  const [name, setName] = useState(loadName);
  const [videoUrl, setVideoUrl] = useState('');
  const [code, setCode] = useState(invitedCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  async function run(kind: 'create' | 'join', action: (uid: string, name: string) => Promise<string>) {
    setError(null);
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return setError('Hãy nhập tên của bạn.');
    setBusy(kind);
    try {
      const id = uid ?? (await signedIn);
      const joined = await action(id, trimmed);
      saveName(trimmed);
      onJoined({ code: joined, name: trimmed });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const create = (event: FormEvent) => {
    event.preventDefault();
    const videoId = parseVideoId(videoUrl);
    if (!videoId) return setError('Link YouTube không hợp lệ.');
    run('create', async (id, trimmed) => joinRoom(await createRoom(videoId, id), id, trimmed));
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    run('join', (id, trimmed) => joinRoom(code, id, trimmed));
  };

  const focus = !name ? 'name' : invitedCode ? 'join' : 'create';

  return (
    <main id="lobby" className="lobby">
      <h1>
        Watch Together <span>YouTube</span>
      </h1>
      <p className="lead">Xem YouTube cùng bạn bè: ai play, pause hay tua thì mọi người trong phòng làm theo.</p>
      <label>
        Tên của bạn
        <input
          id="name"
          maxLength={30}
          placeholder="Ví dụ: Long"
          autoComplete="nickname"
          autoFocus={focus === 'name'}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </label>
      <form className="card" onSubmit={create}>
        <h2>Tạo phòng mới</h2>
        <input
          id="create-url"
          placeholder="Dán link YouTube"
          autoFocus={focus === 'create'}
          value={videoUrl}
          onChange={e => setVideoUrl(e.target.value)}
        />
        <button id="create" className="primary" disabled={busy !== null}>
          {busy === 'create' ? 'Đang tạo…' : 'Tạo phòng'}
        </button>
      </form>
      <form className="card" onSubmit={join}>
        <h2>Vào phòng</h2>
        <input
          id="join-code"
          placeholder="Mã phòng hoặc link mời"
          autoCapitalize="characters"
          value={code}
          onChange={e => setCode(extractRoomCode(e.target.value) ?? e.target.value.toUpperCase())}
        />
        <button id="join" disabled={busy !== null} autoFocus={focus === 'join'}>
          {busy === 'join' ? 'Đang vào…' : 'Vào phòng'}
        </button>
      </form>
      <InstallButton />
      {(error || startupError) && (
        <p id="lobby-error" className="error">
          {error || startupError}
        </p>
      )}
    </main>
  );
}
