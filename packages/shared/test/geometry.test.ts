import { describe, expect, it } from 'vitest';
import { canStand, pathClear, portalAt, reachableTiles, PLAYER_SPEED, type CollisionMap } from '../src/geometry';
import { JoinSchema, MoveSchema } from '../src/protocol';

// 8x6 tiles of 16px: walls around the edge, a wall column at x=4 with a gap at y=3, a portal on the right
function room(): CollisionMap {
  const cols = 8, rows = 6;
  const solidTiles = new Array(cols * rows).fill(false);
  for (let x = 0; x < cols; x++) { solidTiles[x] = true; solidTiles[(rows - 1) * cols + x] = true; }
  for (let y = 0; y < rows; y++) { solidTiles[y * cols] = true; solidTiles[y * cols + cols - 1] = true; }
  for (let y = 1; y < rows - 1; y++) if (y !== 3) solidTiles[y * cols + 4] = true;
  return {
    id: 't', width: cols * 16, height: rows * 16, cols, rows, solidTiles,
    solidRects: [{ x: 20, y: 20, w: 10, h: 10 }],
    portals: [{ id: 'p', label: 'P', rect: [6, 3, 1, 1], to: 'x', spawn: 's', px: { x: 96, y: 48, w: 16, h: 16 } }] as never,
    spawns: { start: [24, 40] },
  };
}

describe('canStand', () => {
  const m = room();
  it('allows open floor', () => expect(canStand(m, 24, 44)).toBe(true));
  it('blocks walls, solid rects and the outside', () => {
    expect(canStand(m, 8, 40)).toBe(false);
    expect(canStand(m, 25, 28)).toBe(false);
    expect(canStand(m, -5, 40)).toBe(false);
    expect(canStand(m, 500, 40)).toBe(false);
  });
});

describe('pathClear (movement validation)', () => {
  const m = room();
  it('accepts a legal step', () => expect(pathClear(m, 24, 44, 40, 44)).toBe(true));
  it('refuses to walk through a wall or a prop', () => {
    expect(pathClear(m, 40, 30, 90, 30)).toBe(false);
    expect(pathClear(m, 24, 40, 24, 20)).toBe(false);
  });
  it('allows going through the gap', () => expect(pathClear(m, 48, 56, 80, 56)).toBe(true));
  it('speed constant is sane', () => expect(PLAYER_SPEED).toBeGreaterThan(20));
});

describe('portals and reachability', () => {
  const m = room();
  it('finds the portal under the feet', () => {
    expect(portalAt(m, 104, 62)?.id).toBe('p');
    expect(portalAt(m, 24, 44)).toBeUndefined();
  });
  it('flood fill respects walls', () => {
    const reach = reachableTiles(m, 24, 44);
    expect(reach.has(3 * m.cols + 5)).toBe(true); // through the gap
    expect(reach.has(1 * m.cols + 4)).toBe(false); // wall
  });
});

describe('protocol schemas', () => {
  it('rejects non-finite or malformed moves', () => {
    expect(MoveSchema.safeParse({ x: 1, y: 2, dir: 'down', moving: false }).success).toBe(true);
    expect(MoveSchema.safeParse({ x: NaN, y: 2, dir: 'down', moving: false }).success).toBe(false);
    expect(MoveSchema.safeParse({ x: Infinity, y: 2, dir: 'down', moving: false }).success).toBe(false);
    expect(MoveSchema.safeParse({ x: 1, y: 2, dir: 'sideways', moving: false }).success).toBe(false);
  });
  it('rejects oversize join payloads', () => {
    expect(JoinSchema.safeParse({ name: 'x'.repeat(5000), avatar: {} }).success).toBe(false);
  });
});
