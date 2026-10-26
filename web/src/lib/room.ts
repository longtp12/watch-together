// Rooms live under ytRooms/{code}: videoId, playback, members, chat.
import {
  ref,
  get,
  set,
  update,
  remove,
  push,
  query,
  limitToLast,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/database';
import { CHAT_HISTORY } from '../../../src/config.js';
import { formatTime } from '../../../src/shared.js';
import { db } from './firebase';
import type { ChatMessage, Member, Playback, PlaybackAction } from '../types';

const roomPath = (code: string) => `ytRooms/${code}`;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function normalizeCode(input: string) {
  return input.trim().toUpperCase();
}

export function isRoomCode(code: string) {
  return /^[A-Z0-9]{6}$/.test(code);
}

export async function createRoom(videoId: string, uid: string) {
  let code = generateCode();
  for (let i = 0; i < 5; i++) {
    if (!(await get(ref(db, `${roomPath(code)}/videoId`))).exists()) break;
    code = generateCode();
  }
  await set(ref(db, roomPath(code)), {
    videoId,
    createdAt: serverTimestamp(),
    playback: { paused: true, time: 0, updatedAt: serverTimestamp(), by: uid },
  });
  return code;
}

// Checks the room exists, then adds us to its members.
export async function joinRoom(input: string, uid: string, name: string) {
  const code = normalizeCode(input);
  if (!isRoomCode(code)) throw new Error('Mã phòng gồm 6 ký tự.');
  if (!(await get(ref(db, `${roomPath(code)}/videoId`))).exists()) throw new Error(`Không tìm thấy phòng ${code}.`);
  await writeMember(code, uid, name);
  return code;
}

export async function writeMember(code: string, uid: string, name: string) {
  const memberRef = ref(db, `${roomPath(code)}/members/${uid}`);
  await onDisconnect(memberRef).remove();
  await set(memberRef, { name, joinedAt: serverTimestamp() });
}

export async function leaveRoom(code: string, uid: string) {
  const memberRef = ref(db, `${roomPath(code)}/members/${uid}`);
  await onDisconnect(memberRef).cancel().catch(() => {});
  await remove(memberRef).catch(() => {});
}

export async function writePlayback(code: string, uid: string, name: string, paused: boolean, time: number, action: PlaybackAction) {
  await set(ref(db, `${roomPath(code)}/playback`), { paused, time, updatedAt: serverTimestamp(), by: uid });
  const at = formatTime(time);
  pushSystemMessage(code, uid, name, action === 'seek' ? `${name} đã tua tới ${at}` : `${name} đã ${paused ? 'pause' : 'play'} ở ${at}`);
}

// New video for everyone, paused at the start, in one write.
export async function changeVideo(code: string, uid: string, name: string, videoId: string) {
  await update(ref(db, roomPath(code)), {
    videoId,
    playback: { paused: true, time: 0, updatedAt: serverTimestamp(), by: uid },
  });
  pushSystemMessage(code, uid, name, `${name} đã đổi video. Bấm play khi mọi người sẵn sàng.`);
}

export async function sendChat(code: string, uid: string, name: string, text: string) {
  await push(ref(db, `${roomPath(code)}/chat`), { uid, name, text, at: serverTimestamp() });
}

function pushSystemMessage(code: string, uid: string, name: string, text: string) {
  push(ref(db, `${roomPath(code)}/chat`), { uid, name, text, system: true, at: serverTimestamp() }).catch(() => {});
}

export function watchVideoId(code: string, callback: (videoId: string | null) => void): Unsubscribe {
  return onValue(ref(db, `${roomPath(code)}/videoId`), snap => callback(snap.val()));
}

export function watchPlayback(code: string, callback: (playback: Playback | null) => void): Unsubscribe {
  return onValue(ref(db, `${roomPath(code)}/playback`), snap => callback(snap.val()));
}

export function watchMembers(code: string, callback: (members: Member[]) => void): Unsubscribe {
  return onValue(ref(db, `${roomPath(code)}/members`), snap => {
    const members = Object.entries((snap.val() || {}) as Record<string, Omit<Member, 'uid'>>)
      .map(([uid, m]) => ({ uid, ...m }))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    callback(members);
  });
}

export function watchChat(code: string, callback: (message: ChatMessage) => void): Unsubscribe {
  return onChildAdded(query(ref(db, `${roomPath(code)}/chat`), limitToLast(CHAT_HISTORY)), snap =>
    callback({ id: snap.key!, ...snap.val() }),
  );
}

// After a dropped connection onDisconnect has removed us from the room, so add us back.
export function watchConnection(code: string, uid: string, name: string): Unsubscribe {
  let dropped = false;
  return onValue(ref(db, '.info/connected'), snap => {
    if (snap.val() !== true) dropped = true;
    else if (dropped) {
      dropped = false;
      writeMember(code, uid, name).catch(() => {});
    }
  });
}
