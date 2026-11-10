import type { MediaChannel, MediaState } from '@channel-green/shared';
import { currentPosition } from '@channel-green/shared';

export function emptyMedia(channel: MediaChannel): MediaState {
  return { channel, source: null, playing: false, position: 0, at: Date.now(), rev: 0, hostPid: null };
}

export type MediaAction = 'play' | 'pause' | 'seek' | 'stop';

/** Pure transition used by the server; `now` is injected for tests. */
export function applyMedia(s: MediaState, action: MediaAction, position: number | undefined, now: number): MediaState {
  if (!s.source && action !== 'stop') return s;
  const cur = currentPosition(s, now);
  switch (action) {
    case 'play':
      return { ...s, playing: true, position: position ?? cur, at: now, rev: s.rev + 1 };
    case 'pause':
      return { ...s, playing: false, position: position ?? cur, at: now, rev: s.rev + 1 };
    case 'seek':
      return { ...s, position: position ?? cur, at: now, rev: s.rev + 1 };
    case 'stop':
      return { ...s, source: null, playing: false, position: 0, at: now, rev: s.rev + 1, hostPid: null };
  }
}
