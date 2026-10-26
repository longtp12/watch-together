import { useEffect, useState } from 'react';
import { watchChat, watchConnection, watchMembers } from '../lib/room';
import type { ChatMessage, Member } from '../types';

// Members and chat of a room, kept up to date from Firebase.
export function useRoom(code: string, uid: string, name: string) {
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setMembers([]);
    setMessages([]);
    const stops = [
      watchMembers(code, setMembers),
      watchChat(code, message =>
        setMessages(list => (list.some(m => m.id === message.id) ? list : [...list, message])),
      ),
      watchConnection(code, uid, name),
    ];
    return () => stops.forEach(stop => stop());
  }, [code, uid, name]);

  return { members, messages };
}
