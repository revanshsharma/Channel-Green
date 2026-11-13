import { describe, expect, it } from 'vitest';
import { buildCollisionMap, PAINT_COLORS, PAINT_RANGE, TILE, bodyBox, inZone, paintTargets, paintZone, splatSpot, traceShot, zonePx, type MapDef } from '../src';
import type { Registry } from '../src';
import { registry } from '../../content/src/index';

const reg = registry as Registry;
const map = reg.maps['paint-yard'] as MapDef;
const cm = buildCollisionMap(map, reg);

describe('paint yard shots', () => {
  it('has a marked zone, a handful of targets and distinct colours', () => {
    const z = paintZone(map);
    expect(z).not.toBeNull();
    expect(paintTargets(map).length).toBeGreaterThanOrEqual(3);
    expect(new Set(PAINT_COLORS).size).toBe(PAINT_COLORS.length);
    expect(PAINT_COLORS.length).toBeGreaterThanOrEqual(6);
    const r = zonePx(z!);
    expect(inZone(z, r.x + 1, r.y + 1)).toBe(true);
    expect(inZone(z, r.x - 1, r.y + 1)).toBe(false);
    expect(inZone(null, 10, 10)).toBe(false);
  });

  it('hits a target straight ahead, and a wall when there is nothing in the way', () => {
    const t = paintTargets(map)[1];
    const sx = t.x + t.w / 2;
    const sy = 180;
    const hit = traceShot({ map: cm, targets: paintTargets(map), players: [] }, 'me', sx, sy, -Math.PI / 2);
    expect(hit.hit).toEqual({ kind: 'target', index: t.index });
    const between = (t.x + t.w + paintTargets(map)[2].x) / 2;
    const wall = traceShot({ map: cm, targets: paintTargets(map), players: [] }, 'me', between, 140, -Math.PI / 2);
    expect(wall.hit.kind).toBe('wall');
    expect(wall.y).toBeGreaterThanOrEqual(TILE * 4 - 4);
  });

  it('hits another player but never the shooter, and stops at range', () => {
    const w = { map: cm, targets: [], players: [{ pid: 'me', x: 200, y: 180 }, { pid: 'you', x: 240, y: 180 }] };
    const r = traceShot(w, 'me', 200, 180, 0);
    expect(r.hit).toEqual({ kind: 'player', pid: 'you' });
    expect(r.length).toBeLessThan(40);
    const far = traceShot({ ...w, players: [{ pid: 'you', x: 200 + PAINT_RANGE + 40, y: 180 }] }, 'me', 200, 180, 0);
    expect(far.hit.kind).toBe('none');
    expect(far.length).toBe(PAINT_RANGE);
    const b = bodyBox(240, 140);
    expect(b.y + b.h).toBe(140);
  });

  it('puts a splat on the body, near where the shot landed', () => {
    for (let salt = 0; salt < 50; salt++) {
      const [ox, oy] = splatSpot(243, 131, 240, 140, salt);
      expect(ox).toBeGreaterThanOrEqual(-4);
      expect(ox).toBeLessThanOrEqual(4);
      expect(oy).toBeGreaterThanOrEqual(-16);
      expect(oy).toBeLessThanOrEqual(-3);
    }
  });
});
