import type { Member } from '../types';

export function MemberList({ members, uid }: { members: Member[]; uid: string }) {
  return (
    <ul id="members" className="members">
      {members.map(m => (
        <li key={m.uid}>
          {m.name}
          {m.uid === uid ? ' (bạn)' : ''}
        </li>
      ))}
    </ul>
  );
}
