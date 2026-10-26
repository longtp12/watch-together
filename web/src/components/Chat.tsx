import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { sendChat } from '../lib/room';
import type { ChatMessage } from '../types';

interface Props {
  code: string;
  name: string;
  uid: string;
  messages: ChatMessage[];
}

export function Chat({ code, name, uid, messages }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Follow new messages, unless the user scrolled up to read older ones.
  useLayoutEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = box.current!;
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim().slice(0, 500);
    setText('');
    if (!message) return;
    setError(null);
    sendChat(code, uid, name, message).catch(err => setError(`Không gửi được tin nhắn: ${err.message}`));
  };

  return (
    <>
      <div id="chat" className="chat" ref={box} onScroll={onScroll}>
        {messages.map(m =>
          m.system ? (
            <div key={m.id} className="msg system" title={time(m.at)}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="msg" title={time(m.at)}>
              <span className="who">{m.name}: </span>
              {m.text}
            </div>
          ),
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      <form id="chat-form" className="chat-form" onSubmit={submit}>
        <input
          id="chat-input"
          maxLength={500}
          placeholder="Nhắn gì đó…"
          autoComplete="off"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button>Gửi</button>
      </form>
    </>
  );
}

function time(at?: number) {
  return typeof at === 'number' ? new Date(at).toLocaleTimeString() : undefined;
}
