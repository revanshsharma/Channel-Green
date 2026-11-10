import { describe, expect, it } from 'vitest';
import { registry } from '@channel-green/content';
import { buildCollisionMap, type MediaState, type Registry } from '@channel-green/shared';
import { TokenBucket, KeyedLimiter } from '../src/safety/rateLimit';
import { Moderation } from '../src/safety/moderation';
import { validateMove } from '../src/world/movement';
import { applyMedia } from '../src/world/media';
import { WorldManager } from '../src/world/instance';
import { Auth } from '../src/auth';
import { loadConfig } from '../src/config';
import { MemoryStore } from '../src/store/memory';

const reg = registry as Registry;

describe('rate limiting', () => {
  it('lets a burst through then refuses, then refills', () => {
    let t = 0;
    const b = new TokenBucket(3, 1, () => t);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    t = 2000;
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
  it('keeps separate budgets per key and sweeps idle ones', () => {
    let t = 0;
    const l = new KeyedLimiter(1, 0.001, () => t);
    expect(l.allow('a')).toBe(true);
    expect(l.allow('a')).toBe(false);
    expect(l.allow('b')).toBe(true);
    t = 20 * 60_000;
    l.sweep();
    expect(l.size).toBe(0);
  });
});

describe('moderation', () => {
  it('blocks listed terms, including light obfuscation, and spam', () => {
    const m = new Moderation({ extraTerms: ['grumblefish'] });
    expect(m.checkText('hello friend').ok).toBe(true);
    expect(m.checkText('you grumblefish').ok).toBe(false);
    expect(m.checkText('gr.u.m.b.l.e.f.i.s.h').ok).toBe(false);
    expect(m.checkText('BUY NOW!!!! http://spam.example http://spam2.example').ok).toBe(false);
    expect(m.nameAllowed('grumblefish')).toBe(false);
    expect(m.nameAllowed('Marlow')).toBe(true);
  });
  it('drops an immediate repeat but not a later one', () => {
    let t = 0;
    const m = new Moderation({ now: () => t });
    expect(m.isRepeat('u', 'hi')).toBe(false);
    expect(m.isRepeat('u', 'hi')).toBe(true);
    t = 20_000;
    expect(m.isRepeat('u', 'hi')).toBe(false);
  });
  it('mutes after repeated strikes, and the mute expires', () => {
    let t = 1000;
    const m = new Moderation({ now: () => t });
    expect(m.strike('u')).toBe(0);
    m.strike('u');
    m.strike('u');
    const until = m.strike('u');
    expect(until).toBeGreaterThan(t);
    expect(m.mutedUntil('u')).toBe(until);
    t = until + 1;
    expect(m.mutedUntil('u')).toBe(0);
  });
  it('mutes a target once enough different people report them, not one person repeatedly', () => {
    const m = new Moderation();
    expect(m.report('t', 'a').tripped).toBe(false);
    expect(m.report('t', 'a').tripped).toBe(false);
    expect(m.report('t', 'b').tripped).toBe(false);
    const r = m.report('t', 'c');
    expect(r.distinct).toBe(3);
    expect(r.tripped).toBe(true);
    expect(m.mutedUntil('t')).toBeGreaterThan(0);
  });
});

describe('movement validation', () => {
  const map = reg.maps['town-square'];
  const col = buildCollisionMap(map, reg as any);
  const [sx, sy] = [col.spawns.start.x, col.spawns.start.y];
  const prev = { x: sx, y: sy, t: 0, seated: false };

  it('accepts a normal step', () => {
    expect(validateMove(col, prev, sx + 2, sy, 100).ok).toBe(true);
  });
  it('rejects teleporting and NaN', () => {
    expect(validateMove(col, prev, sx + 200, sy, 100)).toMatchObject({ ok: false, reason: 'too-far' });
    expect(validateMove(col, prev, NaN, sy, 100).ok).toBe(false);
  });
  it('rejects leaving the map', () => {
    expect(validateMove(col, { ...prev, x: 2, y: 2 }, -5, 2, 100)).toMatchObject({ ok: false, reason: 'bounds' });
  });
  it('does not bank unlimited time', () => {
    expect(validateMove(col, prev, sx + 100, sy, 10 * 60_000).ok).toBe(false);
  });
  it('rejects walking into a wall or furniture', () => {
    // find a blocked pixel one step away from the spawn by scanning
    let found = false;
    for (let dx = -40; dx <= 40 && !found; dx += 2) {
      for (let dy = -40; dy <= 40 && !found; dy += 2) {
        const v = validateMove(col, { ...prev, t: 0 }, sx + dx, sy + dy, 1000);
        if (!v.ok && v.reason === 'blocked') found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('media transitions', () => {
  const base: MediaState = {
    channel: 'watch',
    source: { kind: 'video', url: 'https://example.com/a.mp4', title: 'x' } as any,
    playing: true,
    position: 10,
    at: 0,
    rev: 1,
    hostPid: 'h',
  };
  it('pause freezes the playhead where it had got to', () => {
    const p = applyMedia(base, 'pause', undefined, 5000);
    expect(p.playing).toBe(false);
    expect(p.position).toBeCloseTo(15, 1);
    expect(p.rev).toBe(2);
  });
  it('seek and stop work, and an empty channel ignores play', () => {
    expect(applyMedia(base, 'seek', 42, 1000).position).toBe(42);
    expect(applyMedia(base, 'stop', undefined, 1000).source).toBeNull();
    const empty = { ...base, source: null };
    expect(applyMedia(empty, 'play', undefined, 1000)).toBe(empty);
  });
});

describe('world manager', () => {
  it('reuses a public copy, makes private rooms with unique codes, and releases empty ones', () => {
    const w = new WorldManager(reg);
    const a = w.publicFor('town-square');
    expect(w.publicFor('town-square')).toBe(a);
    const p1 = w.createPrivate('living-room', 'Friends');
    const p2 = w.createPrivate('living-room');
    expect(p1 && p2 && p1.code !== p2.code).toBe(true);
    expect(w.byCode(p1!.code!.toLowerCase())).toBe(p1);
    expect(w.byCode('NOPE00')).toBeUndefined();
    expect(w.releaseIfEmpty(p1!)).toBe(true);
    expect(w.byCode(p1!.code!)).toBeUndefined();
  });
});

describe('auth', () => {
  const cfg = loadConfig({ SERVER_SECRET: 'x'.repeat(40) });
  it('issues guest tokens that verify, and rejects tampering', async () => {
    const a = new Auth(cfg);
    const { token } = await a.issueGuest();
    const id = await a.verify(token);
    expect(id?.guest).toBe(true);
    expect(id?.uid).toMatch(/^[a-z0-9_-]{10,}$/i);
    expect(id?.uid).not.toContain(id!.sub);
    expect(await a.verify(token + 'x')).toBeNull();
    expect(await a.verify('garbage')).toBeNull();
    expect(await a.verify(undefined)).toBeNull();
  });
  it('rejects a token signed with a different secret', async () => {
    const other = new Auth(loadConfig({ SERVER_SECRET: 'y'.repeat(40) }));
    const { token } = await other.issueGuest();
    expect(await new Auth(cfg).verify(token)).toBeNull();
  });
  it('requires a real secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow();
  });
});

describe('memory store', () => {
  it('keeps confessions without leaking the author, hearts once, hides on request', async () => {
    const s = new MemoryStore();
    await s.addConfession({ id: 'c1', text: 'hi', ts: Date.now(), hearts: 0, hidden: false, authorUid: 'u1' });
    expect(await s.heartConfession('c1', 'u2')).toBe(1);
    expect(await s.heartConfession('c1', 'u2')).toBeNull();
    expect(JSON.stringify(await s.listConfessions(10))).not.toContain('u1');
    await s.hideConfession('c1');
    expect(await s.listConfessions(10)).toHaveLength(0);
  });
});
