export interface Playback {
  paused: boolean;
  time: number;
  // Server time in ms. Our own fresh writes hold an estimate until Firebase answers.
  updatedAt: number;
  by: string;
}

export interface Member {
  uid: string;
  name: string;
  joinedAt?: number;
}

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  at?: number;
  system?: boolean;
}

export type PlaybackAction = 'play' | 'pause' | 'seek';
