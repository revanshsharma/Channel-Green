/**
 * Paintball, the gentle kind: a marked yard where people who opted in can tag each other with colour and plink the targets.
 * Colour is cosmetic only and washes off. The same trace is used by the server to decide what a shot touches and by the
 * client to draw the aim line, so what you see is what happens.
 */
import type { CollisionMap, Rect } from './geometry';
import type { MapDef } from './content';
import { TILE } from './worldart';

export const PAINT_COLORS = ['#e4572e', '#2e86de', '#f2c14e', '#3bb273', '#c44cc9', '#17bebb', '#ff8fab', '#7768ae'] as const;
export const PAINT_NAMES = ['Coral', 'Blue', 'Sunny', 'Green', 'Orchid', 'Teal', 'Pink', 'Violet'] as const;
export type PaintColor = number;

export const PAINT_RANGE = 150;
/** Fewest ms between two shots. The server enforces this; the client paces itself a little slower. */
export const PAINT_FIRE_GAP_MS = 380;
export const PAINT_SPLAT_MS = 60_000;
export const PAINT_MAX_SPLATS = 7;
export const PAINT_TRACE_STEP = 2;
/** How fast a shot flies (px per second), only for the picture. */
export const PAINT_SHOT_SPEED = 420;
/** The marker is held at about chest height. */
export const PAINT_MUZZLE_DY = 9;
/** What a player looks like to a paint shot: a box around the body, relative to their feet. */
export const PAINT_BODY = { w: 10, h: 18 };
export const TARGET_BOX = { x: 2, y: 2, w: 12, h: 12 };

export interface Zone {
  id: string;
  kind: 'paint';
  /** in tiles: [x, y, w, h] */
  rect: [number, number, number, number];
  label?: string;
}

export function zonePx(z: Zone): Rect {
  return { x: z.rect[0] * TILE, y: z.rect[1] * TILE, w: z.rect[2] * TILE, h: z.rect[3] * TILE };
}

export function paintZone(map: Pick<MapDef, 'zones'>): Zone | null {
  return (map.zones ?? []).find((z) => z.kind === 'paint') ?? null;
}

export function inZone(z: Zone | null, x: number, y: number): boolean {
  if (!z) return false;
  const r = zonePx(z);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export interface TargetBox extends Rect {
  /** index of the placement in the map's object list */
  index: number;
}

/** The bullseyes of a map: every placed `paint-target`. */
export function paintTargets(map: Pick<MapDef, 'objects'>): TargetBox[] {
  const out: TargetBox[] = [];
  map.objects.forEach((o, index) => {
    if (o.furniture !== 'paint-target') return;
    out.push({ index, x: o.at[0] + TARGET_BOX.x, y: o.at[1] + TARGET_BOX.y, w: TARGET_BOX.w, h: TARGET_BOX.h });
  });
  return out;
}

export function bodyBox(x: number, y: number): Rect {
  return { x: x - PAINT_BODY.w / 2, y: y - PAINT_BODY.h, w: PAINT_BODY.w, h: PAINT_BODY.h };
}

function pointIn(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** True where a shot cannot pass: walls, trees and furniture. */
export function pointSolid(map: CollisionMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  if (map.solidTiles[Math.floor(y / TILE) * map.cols + Math.floor(x / TILE)]) return true;
  for (const r of map.solidRects) if (pointIn(r, x, y)) return true;
  return false;
}

export type ShotHit = { kind: 'none' } | { kind: 'wall' } | { kind: 'target'; index: number } | { kind: 'player'; pid: string };

export interface ShotResult {
  /** where the shot ended */
  x: number;
  y: number;
  hit: ShotHit;
  /** pixels travelled */
  length: number;
}

export interface ShotWorld {
  map: CollisionMap;
  targets: TargetBox[];
  players: { pid: string; x: number; y: number }[];
}

export function aimFrom(x: number, y: number): { x: number; y: number } {
  return { x, y: y - PAINT_MUZZLE_DY };
}

/** Follows a shot from the shooter's marker along `angle` (radians) until it touches something or runs out of range. */
export function traceShot(w: ShotWorld, fromPid: string, fx: number, fy: number, angle: number, range = PAINT_RANGE): ShotResult {
  const o = aimFrom(fx, fy);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const boxes = w.players.filter((p) => p.pid !== fromPid).map((p) => ({ pid: p.pid, box: bodyBox(p.x, p.y) }));
  let last = { x: o.x, y: o.y };
  for (let d = PAINT_TRACE_STEP; d <= range; d += PAINT_TRACE_STEP) {
    const x = o.x + dx * d;
    const y = o.y + dy * d;
    for (const t of w.targets) if (pointIn(t, x, y)) return { x, y, hit: { kind: 'target', index: t.index }, length: d };
    for (const b of boxes) if (pointIn(b.box, x, y)) return { x, y, hit: { kind: 'player', pid: b.pid }, length: d };
    if (pointSolid(w.map, x, y)) return { x: last.x, y: last.y, hit: { kind: 'wall' }, length: d - PAINT_TRACE_STEP };
    last = { x, y };
  }
  return { x: last.x, y: last.y, hit: { kind: 'none' }, length: range };
}

/** A splat on someone's sprite: colour index and where on the body, relative to their feet. */
export type Splat = [color: number, ox: number, oy: number];

/** Where a hit lands on the body, from where it struck, so splats sit on the side that was shot at. */
export function splatSpot(hitX: number, hitY: number, px: number, py: number, salt: number): [number, number] {
  const jitter = ((salt * 7919) % 5) - 2;
  const ox = Math.max(-4, Math.min(4, Math.round(hitX - px) + jitter));
  const oy = Math.max(-16, Math.min(-3, Math.round(hitY - py) + ((salt * 31) % 3) - 1));
  return [ox, oy];
}

export function angleOk(a: number): boolean {
  return Number.isFinite(a) && a >= -Math.PI * 2 && a <= Math.PI * 2;
}
