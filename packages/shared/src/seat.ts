import type { FurnitureDef, MapDef } from './content';
import type { Direction } from './avatar';

/** Where a seated player rests, and how the sprite should be layered against the furniture. Shared so the server and every client agree. */

export interface SeatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type SeatDef = Pick<FurnitureDef, 'size' | 'footprint' | 'flat' | 'interaction'>;

/** The part of the furniture a person can sit on: its solid footprint, or the whole picture for flat things like cushions. */
export function seatRect(def: SeatDef, at: readonly [number, number]): SeatRect {
  const fp = def.footprint;
  return fp ? { x: at[0] + fp[0], y: at[1] + fp[1], w: fp[2], h: fp[3] } : { x: at[0], y: at[1], w: def.size[0], h: def.size[1] };
}

/** The spot a player ends up on: as near as they stand along the seat, on its front edge. */
export function seatPoint(def: SeatDef, at: readonly [number, number], px: number): { x: number; y: number } {
  const r = seatRect(def, at);
  return { x: Math.min(Math.max(px, r.x + 4), r.x + r.w - 4), y: r.y + r.h - 2 };
}

export interface SeatInfo {
  index: number;
  dir: Direction;
  /** true when the furniture picture must cover the lower body (backrest in front of someone facing away) */
  inFront: boolean;
  /** draw order of the furniture picture itself */
  furnitureDepth: number;
}

/** Draw order of a furniture picture (the same rule the scene uses when it places the picture). */
export function furnitureDepth(def: Pick<FurnitureDef, 'size' | 'flat'>, at: readonly [number, number], extra = 0): number {
  return def.flat ? -50000 + at[1] : at[1] + def.size[1] + extra;
}

/** Finds the seat a seated player at (x, y) is on, or null when there is none. Picks the closest on a tie. */
export function findSeat(map: Pick<MapDef, 'objects'>, furniture: Record<string, SeatDef>, x: number, y: number): SeatInfo | null {
  let best: SeatInfo | null = null;
  let bestD = Infinity;
  map.objects.forEach((o, index) => {
    const def = furniture[o.furniture];
    if (!def || def.interaction?.kind !== 'sit') return;
    const r = seatRect(def, o.at);
    const sy = r.y + r.h - 2;
    if (x < r.x - 1 || x > r.x + r.w + 1 || Math.abs(y - sy) > 3) return;
    const d = Math.abs(y - sy) + Math.abs(x - (r.x + r.w / 2)) * 0.01;
    if (d >= bestD) return;
    bestD = d;
    const dir = def.interaction.dir ?? 'down';
    best = { index, dir, inFront: dir === 'up' && !def.flat, furnitureDepth: furnitureDepth(def, o.at, o.depth ?? 0) };
  });
  return best;
}

/** Sprite draw order for a seated player: on top of the seat, or tucked behind a backrest that faces the room. */
export function seatedDepth(seat: SeatInfo | null, y: number): number {
  if (!seat) return y;
  return seat.inFront ? seat.furnitureDepth - 0.5 : Math.max(y, seat.furnitureDepth + 0.5);
}

/** Easing for sit and stand: starts and ends slowly. */
export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Moves a value toward a goal by a fraction of the gap but never slower than `minStep` per call, and never past it. */
export function approach(cur: number, goal: number, frac: number, minStep: number): number {
  const gap = goal - cur;
  const step = Math.max(Math.abs(gap) * frac, minStep);
  return Math.abs(gap) <= step ? goal : cur + Math.sign(gap) * step;
}

export type SeatedFrame = 'sit0' | 'sit1' | 'sit2' | 'sit3';

/**
 * Which seated picture to show at time `t` (ms). A slow breath every few seconds, a blink now and then, a small
 * head tilt in between. `phase` keeps people from breathing in unison. Reduced motion gets one still picture.
 */
export function seatedFrame(t: number, phase: number, reduce: boolean): SeatedFrame {
  if (reduce) return 'sit0';
  const u = t + phase;
  if (u % 5300 < 140) return 'sit2';
  if (u % 11000 > 7600) return 'sit3';
  return Math.floor(u / 1700) % 2 === 0 ? 'sit0' : 'sit1';
}
