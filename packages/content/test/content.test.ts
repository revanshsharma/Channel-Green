import { describe, expect, it } from 'vitest';
import { buildCollisionMap, canStand, reachableTiles, renderAvatarFrames, randomAvatar, sanitizeAvatar, renderFurniture, renderTile, TILE, type Registry } from '@channel-green/shared';
import { registry, checkReferences, mergePacks } from '../src/index';

const reg = registry as Registry;

describe('core content pack', () => {
  it('has no broken references', () => {
    expect(checkReferences(reg)).toEqual([]);
  });

  it('ships the rooms the project promises', () => {
    for (const id of ['town-square', 'cafe', 'living-room', 'rooftop', 'garden', 'listening-room', 'tv-lounge', 'rain-room', 'confession-wall', 'quiet-nook', 'paint-yard']) {
      expect(reg.maps[id], id).toBeDefined();
    }
    expect(reg.maps['tv-lounge'].features).toContain('watch');
    expect(reg.maps['listening-room'].features).toContain('listen');
    expect(reg.maps['confession-wall'].features).toContain('confession');
  });

  it('every spawn is standable and every portal is reachable from every spawn', () => {
    for (const map of Object.values(reg.maps)) {
      const cm = buildCollisionMap(map, reg);
      const spawns = Object.entries(cm.spawns);
      expect(spawns.length, map.id).toBeGreaterThan(0);
      for (const [name, [x, y]] of spawns) expect(canStand(cm, x, y), `${map.id}/${name} spawn blocked`).toBe(true);
      const [, [sx, sy]] = spawns[0];
      const reach = reachableTiles(cm, sx, sy);
      for (const [name, [x, y]] of spawns) expect(reach.has(Math.floor(y / TILE) * cm.cols + Math.floor(x / TILE)), `${map.id}/${name} unreachable`).toBe(true);
      for (const p of cm.portals) {
        let ok = false;
        for (let ty = p.rect[1]; ty < p.rect[1] + p.rect[3]; ty++) for (let tx = p.rect[0]; tx < p.rect[0] + p.rect[2]; tx++) if (reach.has(ty * cm.cols + tx)) ok = true;
        expect(ok, `${map.id}/${p.id} portal unreachable`).toBe(true);
      }
    }
  });

  it('portals form a round trip: every room can be left and the hub links to every other room', () => {
    const hub = reg.maps['town-square'];
    const targets = new Set(hub.portals.map((p) => p.to));
    for (const id of Object.keys(reg.maps)) if (id !== 'town-square') expect(targets.has(id), `hub has no door to ${id}`).toBe(true);
    for (const m of Object.values(reg.maps)) if (m.id !== 'town-square') expect(m.portals.some((p) => p.to === 'town-square'), `${m.id} has no exit`).toBe(true);
  });

  it('spawn points inside a room are not on top of a portal (no instant bounce)', () => {
    for (const map of Object.values(reg.maps)) {
      const cm = buildCollisionMap(map, reg);
      for (const [name, [x, y]] of Object.entries(cm.spawns)) {
        for (const p of cm.portals) {
          const inside = x >= p.px.x && x < p.px.x + p.px.w && y - 3 >= p.px.y && y - 3 < p.px.y + p.px.h;
          expect(inside, `${map.id}/${name} spawns inside portal ${p.id}`).toBe(false);
        }
      }
    }
  });

  it('every furniture item and tile draws something', () => {
    for (const f of Object.values(reg.furniture)) expect(renderFurniture(f).opaqueCount(), f.id).toBeGreaterThan(10);
    for (const t of Object.values(reg.tiles)) expect(renderTile(t).opaqueCount(), t.id).toBe(TILE * TILE);
  });

  it('rejects duplicate ids and unknown files when packs are merged', () => {
    const core = { dir: 'a', files: { 'pack.json': { id: 'a', name: 'A', version: '1.0.0', author: 'x', license: 'CC0-1.0' }, 'emotes.json': [{ id: 'w', label: 'w', glyph: 'x' }, { id: 'w', label: 'w', glyph: 'x' }], 'notes.json': {} } };
    const { errors } = mergePacks([core]);
    expect(errors.some((e) => e.includes('duplicate emote'))).toBe(true);
    expect(errors.some((e) => e.includes('not recognised'))).toBe(true);
  });
});

describe('avatars', () => {
  it('renders deterministically', () => {
    const cfg = randomAvatar(reg.avatar, 7);
    const a = renderAvatarFrames(cfg, reg.avatar);
    const b = renderAvatarFrames(cfg, reg.avatar);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(a[k].checksum()).toBe(b[k].checksum());
  });

  it('different choices look different', () => {
    const sums = new Set<number>();
    for (let i = 0; i < 20; i++) sums.add(renderAvatarFrames(randomAvatar(reg.avatar, i + 100), reg.avatar)['down-idle0'].checksum());
    expect(sums.size).toBeGreaterThan(15);
  });

  it('has 72 frames and mirrors the side view', () => {
    const f = renderAvatarFrames(randomAvatar(reg.avatar, 3), reg.avatar);
    expect(Object.keys(f)).toHaveLength(72);
    expect(f['right-idle0'].checksum()).toBe(f['left-idle0'].flippedX().checksum());
  });

  it('sanitises hostile or stale configs to valid ones', () => {
    const clean = sanitizeAvatar({ body: '<script>', skin: 'nope', hair: 'x'.repeat(500), top: 42 }, reg.avatar);
    expect(reg.avatar.bodies.some((b) => b.id === clean.body)).toBe(true);
    expect(reg.avatar.skins.some((s) => s.id === clean.skin)).toBe(true);
    expect(() => renderAvatarFrames(clean, reg.avatar)).not.toThrow();
    expect(() => sanitizeAvatar(null, reg.avatar)).not.toThrow();
  });
});
