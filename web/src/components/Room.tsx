import { useState } from 'react';
import { useRoom } from '../hooks/useRoom';
import { PlayerPanel } from './PlayerPanel';
import { MemberList } from './MemberList';
import { Chat } from './Chat';

interface Props {
  code: string;
  name: string;
  uid: string;
  onLeave: () => Promise<void>;
}

export function Room({ code, name, uid, onLeave }: Props) {
  const { members, messages } = useRoom(code, uid, name);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const copyLink = async () => {
    const link = `${location.origin}${location.pathname}#${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy link này gửi bạn bè:', link);
    }
  };

  const leave = () => {
    setLeaving(true);
    onLeave();
  };

  return (
    <main id="room" className="room">
      <header className="bar">
        <b id="room-code">Phòng {code}</b>
        <button id="copy-link" title="Copy link mời bạn bè" onClick={copyLink}>
          {copied ? 'Đã copy' : 'Copy link mời'}
        </button>
        <span className="spacer" />
        <button id="leave" onClick={leave} disabled={leaving}>
          Rời phòng
        </button>
      </header>
      <div className="layout">
        <PlayerPanel code={code} name={name} uid={uid} />
        <aside className="side">
          <h2>Trong phòng</h2>
          <MemberList members={members} uid={uid} />
          <h2>Chat</h2>
          <Chat code={code} name={name} uid={uid} messages={messages} />
        </aside>
      </div>
    </main>
  );
}
