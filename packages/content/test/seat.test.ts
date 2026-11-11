import { describe, expect, it } from 'vitest';
import { FRAME_H, FRAME_NAMES, FRAME_W, approach, findSeat, furnitureDepth, renderAvatarFrames, randomAvatar, seatPoint, seatedDepth, seatedFrame, smoothstep, type Registry } from '@channel-green/shared';
import { registry } from '../src/index';

const reg = registry as Registry;

describe('seats', () => {
  const sits: { map: string; index: number; furniture: string }[] = [];
  for (const map of Object.values(reg.maps)) {
    map.objects.forEach((o, index) => {
      if (reg.furniture[o.furniture]?.interaction?.kind === 'sit') sits.push({ map: map.id, index, furniture: o.furniture });
    });
  }

  it('the world has things to sit on', () => {
    expect(sits.length).toBeGreaterThan(5);
  });

  it('every seat point is found again as that seat, facing the way the furniture says', () => {
    for (const s of sits) {
      const map = reg.maps[s.map];
      const o = map.objects[s.index];
      const def = reg.furniture[o.furniture];
      const pt = seatPoint(def, o.at, o.at[0] + def.size[0] / 2);
      const found = findSeat(map, reg.furniture, pt.x, pt.y);
      expect(found, `${s.map}/${s.furniture} seat not found`).not.toBeNull();
      expect(found!.dir).toBe(def.interaction?.kind === 'sit' ? (def.interaction.dir ?? 'down') : 'down');
    }
  });

  it('standing in the open is not a seat', () => {
    expect(findSeat(reg.maps['town-square'], reg.furniture, 1, 1)).toBeNull();
  });

  it('the seat point stays on the seat however far along you were', () => {
    const o = reg.maps['town-square'].objects.find((x) => reg.furniture[x.furniture]?.interaction?.kind === 'sit')!;
    const def = reg.furniture[o.furniture];
    const left = seatPoint(def, o.at, -500);
    const right = seatPoint(def, o.at, 5000);
    expect(left.x).toBeLessThan(right.x);
    expect(left.y).toBe(right.y);
    expect(right.x).toBeLessThanOrEqual(o.at[0] + def.size[0]);
  });

  it('a backrest that faces the room covers a sitter, a plain seat sits under them', () => {
    const map = reg.maps['town-square'];
    const withBack = sits.find((s) => s.map === 'town-square' && s.furniture === 'bench-up')!;
    const o = map.objects[withBack.index];
    const def = reg.furniture[o.furniture];
    const pt = seatPoint(def, o.at, o.at[0] + 10);
    const seat = findSeat(map, reg.furniture, pt.x, pt.y)!;
    expect(seat.inFront).toBe(true);
    expect(seatedDepth(seat, pt.y)).toBeLessThan(furnitureDepth(def, o.at));
    const plain = sits.find((s) => s.map === 'town-square' && s.furniture === 'bench')!;
    const po = map.objects[plain.index];
    const pdef = reg.furniture[po.furniture];
    const pp = seatPoint(pdef, po.at, po.at[0] + 10);
    const ps = findSeat(map, reg.furniture, pp.x, pp.y)!;
    expect(ps.inFront).toBe(false);
    expect(seatedDepth(ps, pp.y)).toBeGreaterThan(furnitureDepth(pdef, po.at));
  });
});

describe('easing helpers', () => {
  it('smoothstep starts and ends gently and clamps', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0.1)).toBeLessThan(0.1);
  });

  it('approach closes the gap without overshooting', () => {
    let v = 0;
    for (let i = 0; i < 400; i++) v = approach(v, 10, 0.1, 0.2);
    expect(v).toBe(10);
    expect(approach(0, -3, 0.5, 0.1)).toBeLessThan(0);
    expect(approach(9.95, 10, 0.1, 0.2)).toBe(10);
  });
});

describe('seated pictures', () => {
  it('a still picture under reduced motion, a living one otherwise', () => {
    for (let t = 0; t < 40000; t += 97) expect(seatedFrame(t, 1234, true)).toBe('sit0');
    const seen = new Set<string>();
    for (let t = 0; t < 40000; t += 50) seen.add(seatedFrame(t, 0, false));
    expect([...seen].sort()).toEqual(['sit0', 'sit1', 'sit2', 'sit3']);
  });

  it('blinks are brief and rare, so nothing flashes', () => {
    let blink = 0;
    let flips = 0;
    let last = '';
    for (let t = 0; t < 60000; t += 10) {
      const f = seatedFrame(t, 0, false);
      if (f === 'sit2') blink++;
      if (f !== last) flips++;
      last = f;
    }
    expect(blink / 6000).toBeLessThan(0.05);
    // at most a few changes per second
    expect(flips / 60).toBeLessThan(2);
  });

  it('every look draws all four seated pictures, in every direction, and they differ from standing', () => {
    const frames = renderAvatarFrames(randomAvatar(reg.avatar, 7), reg.avatar);
    for (const d of ['down', 'up', 'left', 'right'] as const) {
      const keys = (['sit0', 'sit1', 'sit2', 'sit3'] as const).map((n) => `${d}-${n}` as const);
      for (const k of keys) {
        expect(frames[k], k).toBeDefined();
        expect(frames[k].w).toBe(FRAME_W);
        expect(frames[k].h).toBe(FRAME_H);
      }
      const sig = (k: keyof typeof frames) => frames[k].checksum();
      expect(sig(`${d}-sit0`)).not.toBe(sig(`${d}-idle0`));
      expect(sig(`${d}-sit0`)).not.toBe(sig(`${d}-sit1`));
    }
    expect(FRAME_NAMES.slice(0, 2)).toEqual(['idle0', 'idle1']);
  });
});
