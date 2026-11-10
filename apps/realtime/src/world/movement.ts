import { PLAYER_SPEED, canStand, pathClear, type CollisionMap } from '@channel-green/shared';

export interface MoveState {
  x: number;
  y: number;
  /** server time of the last accepted move (ms) */
  t: number;
  seated: boolean;
}

export type MoveVerdict = { ok: true; x: number; y: number } | { ok: false; reason: 'too-far' | 'blocked' | 'bounds' };

/** A little slack for network jitter and the client's frame timing. */
export const SPEED_TOLERANCE = 1.4;
export const SLACK_PX = 4;
/** Longest gap we credit to a single move; stops "wait five minutes then teleport". */
export const MAX_CREDIT_MS = 1000;
/** How far a seated player may step to get up. */
export const STAND_UP_PX = 24;

/**
 * The server never trusts a position: a move is accepted only if the player could have walked there
 * in the time that has passed and the straight path is free of walls and furniture.
 */
export function validateMove(map: CollisionMap, prev: MoveState, nx: number, ny: number, now: number): MoveVerdict {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { ok: false, reason: 'bounds' };
  const x = Math.round(nx * 10) / 10;
  const y = Math.round(ny * 10) / 10;
  if (x < 0 || y < 0 || x > map.width || y > map.height) return { ok: false, reason: 'bounds' };
  const dist = Math.hypot(x - prev.x, y - prev.y);
  if (prev.seated) {
    if (dist > STAND_UP_PX || !canStand(map, x, y)) return { ok: false, reason: dist > STAND_UP_PX ? 'too-far' : 'blocked' };
    return { ok: true, x, y };
  }
  const dt = Math.min(Math.max(now - prev.t, 0), MAX_CREDIT_MS) / 1000;
  const allowed = PLAYER_SPEED * SPEED_TOLERANCE * dt + SLACK_PX;
  if (dist > allowed) return { ok: false, reason: 'too-far' };
  if (!pathClear(map, prev.x, prev.y, x, y)) return { ok: false, reason: 'blocked' };
  return { ok: true, x, y };
}
