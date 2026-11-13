import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { registry } from '@channel-green/content';
import { activityOf, paintTargets, paintZone, zonePx, PAINT_FIRE_GAP_MS, VEND_GAP_MS, randomAvatar, type JoinOk, type Registry, type PublicPlayer, type ChatMessage } from '@channel-green/shared';
import { createRealtime } from '../src/server';
import { loadConfig } from '../src/config';

const reg = registry as Registry;
let rt: ReturnType<typeof createRealtime>;
let base = '';

/** node:http directly: sandboxes with a global fetch proxy would otherwise intercept loopback calls. */
function getJson<T>(path: string, method = 'GET'): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const once = <T>(s: Socket, ev: string, pred: (v: T) => boolean = () => true, ms = 4000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (v: T) => {
      if (pred(v)) {
        clearTimeout(t);
        s.off(ev, h);
        resolve(v);
      }
    };
    s.on(ev, h);
  });

const emit = <T = object>(s: Socket, ev: string, data?: unknown) =>
  new Promise<{ ok: boolean; error?: string } & T>((resolve) => (data === undefined ? s.emit(ev, resolve) : s.emit(ev, data, resolve)));

async function client(name: string, extra: Record<string, unknown> = {}) {
  const g = await getJson<{ token: string }>('/auth/guest', 'POST');
  const s = connect(base, { transports: ['websocket'], forceNew: true });
  await once(s, 'connect');
  const joined = await emit<JoinOk>(s, 'join', { token: g.token, name, avatar: randomAvatar(reg.avatar, name.length), ...extra });
  return { s, joined };
}

beforeAll(async () => {
  rt = createRealtime(loadConfig({ NODE_ENV: 'test', ALLOWED_ORIGINS: '*' }));
  base = `http://127.0.0.1:${await rt.listen(0)}`;
});
afterAll(async () => {
  await rt.close();
});

describe('two clients', () => {
  it('reports health and config with no keys set', async () => {
    const cfg = await getJson<{ voice: boolean; persistence: string }>('/config');
    expect(cfg.voice).toBe(false);
    expect(cfg.persistence).toBe('memory');
  });

  it('refuses to join without a session token', async () => {
    const s = connect(base, { transports: ['websocket'], forceNew: true });
    await once(s, 'connect');
    const r = await emit(s, 'join', { name: 'Nobody', avatar: {} });
    expect(r.ok).toBe(false);
    s.close();
  });

  it('connect, see each other, move, chat, and leave', async () => {
    const a = await client('Alder');
    expect(a.joined.ok).toBe(true);
    expect(a.joined.room.mapId).toBe('town-square');
    const seeB = once<PublicPlayer>(a.s, 'player:join', (p) => p.name === 'Birch');
    const b = await client('Birch');
    expect(b.joined.ok).toBe(true);
    expect(b.joined.players.map((p) => p.name)).toContain('Alder');
    expect((await seeB).name).toBe('Birch');

    // Birch takes a few small steps; Alder must see the new position in world updates.
    const start = b.joined.me;
    const target = { x: start.x + 6, y: start.y };
    const moved = once<[string, number, number, number, number][]>(a.s, 'world:state', (rows) => rows.some((r) => r[0] === start.pid && Math.abs(r[1] - start.x) > 2));
    for (let i = 1; i <= 3; i++) {
      b.s.emit('move', { x: start.x + i * 2, y: start.y, dir: 'right', moving: true });
      await new Promise((r) => setTimeout(r, 60));
    }
    const rows = await moved;
    const row = rows.find((r) => r[0] === start.pid)!;
    expect(row[1]).toBeGreaterThan(start.x);
    expect(row[1]).toBeLessThanOrEqual(target.x);

    const heard = once<ChatMessage>(a.s, 'chat:msg', (m) => m.text === 'hello there');
    const sent = await emit(b.s, 'chat:send', { text: 'hello there' });
    expect(sent.ok).toBe(true);
    expect((await heard).from?.name).toBe('Birch');

    const gone = once<{ pid: string }>(a.s, 'player:leave', (p) => p.pid === start.pid);
    b.s.close();
    expect((await gone).pid).toBe(start.pid);
    a.s.close();
  });

  it('shares tea and lying down with the room, refuses nonsense, and ends them on a step', async () => {
    const a = await client('Elm');
    const b = await client('Fir');
    const me = b.joined.me;
    const rowOf = (rows: [string, number, number, number, number][]) => rows.find((r) => r[0] === me.pid);
    const tea = once<[string, number, number, number, number][]>(a.s, 'world:state', (rows) => !!rowOf(rows) && activityOf(rowOf(rows)![4]) === 'tea');
    const r1 = await emit<{ flags: number }>(b.s, 'activity', { id: 'tea' });
    expect(r1.ok).toBe(true);
    expect(activityOf(r1.flags)).toBe('tea');
    await tea;
    // the same request again puts it away
    const r2 = await emit<{ flags: number }>(b.s, 'activity', { id: 'tea' });
    expect(activityOf(r2.flags)).toBeNull();
    const lie = once<[string, number, number, number, number][]>(a.s, 'world:state', (rows) => !!rowOf(rows) && activityOf(rowOf(rows)![4]) === 'lie');
    expect((await emit(b.s, 'activity', { id: 'lie' })).ok).toBe(true);
    await lie;
    // junk is refused
    expect((await emit(b.s, 'activity', { id: 'fly' })).ok).toBe(false);
    // walking ends it
    const up = once<[string, number, number, number, number][]>(a.s, 'world:state', (rows) => !!rowOf(rows) && activityOf(rowOf(rows)![4]) === null && rowOf(rows)![4] !== undefined && rowOf(rows)![1] !== me.x);
    await new Promise((r) => setTimeout(r, 120));
    b.s.emit('move', { x: me.x + 2, y: me.y, dir: 'right', moving: true });
    await up;
    a.s.close();
    b.s.close();
  });

  it('keeps blocked players out of each other\'s view of chat', async () => {
    const a = await client('Cedar');
    const b = await client('Dogwood', { blocks: [] });
    const heardByA: string[] = [];
    a.s.on('chat:msg', (m: ChatMessage) => heardByA.push(m.text));
    const blocked = await emit(a.s, 'safety:block', { uid: b.joined.me.uid });
    expect(blocked.ok).toBe(true);
    await emit(b.s, 'chat:send', { text: 'can you see this' });
    await new Promise((r) => setTimeout(r, 300));
    expect(heardByA).not.toContain('can you see this');
    a.s.close();
    b.s.close();
  });

  it('hides both players from each other on block and shows them again on unblock', async () => {
    const a = await client('Hazel');
    const b = await client('Ivy');
    const bSeesAGo = once<{ pid: string }>(b.s, 'player:leave', (v) => v.pid === a.joined.me.pid);
    const aSeesBGo = once<{ pid: string }>(a.s, 'player:leave', (v) => v.pid === b.joined.me.pid);
    expect((await emit(a.s, 'safety:block', { uid: b.joined.me.uid })).ok).toBe(true);
    await Promise.all([bSeesAGo, aSeesBGo]);
    const bSeesABack = once<PublicPlayer>(b.s, 'player:join', (v) => v.pid === a.joined.me.pid);
    const aSeesBBack = once<PublicPlayer>(a.s, 'player:join', (v) => v.pid === b.joined.me.pid);
    expect((await emit(a.s, 'safety:unblock', { uid: b.joined.me.uid })).ok).toBe(true);
    await Promise.all([bSeesABack, aSeesBBack]);
    a.s.close();
    b.s.close();
  });

  it('refuses a teleport and corrects the position', async () => {
    const a = await client('Elm');
    const fix = once<{ x: number; y: number }>(a.s, 'pos:correct');
    a.s.emit('move', { x: a.joined.me.x + 300, y: a.joined.me.y, dir: 'right', moving: true });
    const c = await fix;
    expect(Math.abs(c.x - a.joined.me.x)).toBeLessThan(40);
    a.s.close();
  });

  it('reports voice as disabled honestly when LiveKit is not configured', async () => {
    const a = await client('Fir');
    const v = await emit<{ enabled: boolean; reason?: string }>(a.s, 'voice:token', { scope: 'room' });
    expect(v.ok).toBe(true);
    expect(v.enabled).toBe(false);
    expect(v.reason).toBeTruthy();
    a.s.close();
  });
});

describe('vending machine and paint yard', () => {
  // a fresh server: the sign-in limits of the first group are per address and already used up
  beforeAll(async () => {
    await rt.close();
    rt = createRealtime(loadConfig({ NODE_ENV: 'test', ALLOWED_ORIGINS: '*' }));
    base = `http://127.0.0.1:${await rt.listen(0)}`;
  });

  const walked = new WeakMap<Socket, { x: number; y: number }>();
  /** Walks a client in small, believable steps so the server's speed check is happy. */
  async function walkTo(c: Awaited<ReturnType<typeof client>>, tx: number, ty: number) {
    const here = (walked.get(c.s) ?? c.joined.me) as { x: number; y: number };
    let { x, y } = here;
    for (let i = 0; i < 60 && (Math.abs(tx - x) > 1 || Math.abs(ty - y) > 1); i++) {
      const dx = Math.max(-36, Math.min(36, tx - x));
      const dy = Math.abs(dx) > 0.5 ? 0 : Math.max(-36, Math.min(36, ty - y));
      await new Promise((r) => setTimeout(r, 480));
      c.s.emit('move', { x: x + dx, y: y + dy, dir: dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up', moving: true });
      x += dx;
      y += dy;
    }
    await new Promise((r) => setTimeout(r, 150));
    walked.set(c.s, { x, y });
    return { x, y };
  }
  const flagsFor = (rows: [string, number, number, number, number][], pid: string) => rows.find((r) => r[0] === pid)?.[4];
  const machineIndex = reg.maps['town-square'].objects.findIndex((o) => o.furniture === 'vending-machine');

  it('sells a snack from the vending machine, shows it to the room, and refuses nonsense', async () => {
    const a = await client('Hazel');
    const b = await client('Ivy');
    // too far from the machine
    expect((await emit(b.s, 'vend:buy', { object: machineIndex, item: 'cola' })).ok).toBe(false);
    // not a machine
    expect((await emit(b.s, 'vend:buy', { object: 1, item: 'cola' })).ok).toBe(false);
    const at = await walkTo(b, 480, 176);
    expect(at.x).toBe(480);
    const cola = once<[string, number, number, number, number][]>(a.s, 'world:state', (rows) => activityOf(flagsFor(rows, b.joined.me.pid) ?? 0) === 'cola');
    const drop = once<{ pid: string; item: string }>(a.s, 'vend:drop', (v) => v.pid === b.joined.me.pid);
    // items you can't buy
    expect((await emit(b.s, 'vend:buy', { object: machineIndex, item: 'tea' })).ok).toBe(false);
    expect((await emit(b.s, 'vend:buy', { object: machineIndex, item: 'diamond' })).ok).toBe(false);
    const ok = await emit<{ flags: number }>(b.s, 'vend:buy', { object: machineIndex, item: 'cola' });
    expect(ok.ok).toBe(true);
    expect(activityOf(ok.flags)).toBe('cola');
    expect((await drop).item).toBe('cola');
    await cola;
    // a second pick straight away has to wait
    expect((await emit(b.s, 'vend:buy', { object: machineIndex, item: 'chips' })).ok).toBe(false);
    // nobody can hand themselves a vended item through the activity door
    expect((await emit(b.s, 'activity', { id: 'chips' })).ok).toBe(false);
    await new Promise((r) => setTimeout(r, VEND_GAP_MS + 1200));
    const again = await emit<{ flags: number }>(b.s, 'vend:buy', { object: machineIndex, item: 'chips' });
    expect(again.ok, again.error).toBe(true);
    expect(activityOf(again.flags)).toBe('chips');
    a.s.close();
    b.s.close();
  }, 30000);

  it('runs the paint yard: opt in, tag a friend, plink a target, wash off, and refuse the rest', async () => {
    const a = await client('Juniper', { map: 'paint-yard' });
    const b = await client('Kestrel', { map: 'paint-yard' });
    expect(a.joined.room.mapId).toBe('paint-yard');
    const map = reg.maps['paint-yard'];
    const zone = zonePx(paintZone(map)!);
    // outside the yard nothing works
    expect(zone.x).toBeGreaterThan(a.joined.me.x);
    expect((await emit(a.s, 'paint:join')).ok).toBe(false);
    expect((await emit(a.s, 'paint:fire', { a: 0 })).ok).toBe(false);
    // both step onto the boards, side by side, so a shot to the right reaches the friend
    const row = a.joined.me.y;
    const [pa, pb] = await Promise.all([walkTo(a, zone.x + 20, row), walkTo(b, zone.x + 68, row)]);
    expect([pa.x, pb.x]).toEqual([zone.x + 20, zone.x + 68]);
    // only people who joined can shoot
    expect((await emit(a.s, 'paint:fire', { a: 0 })).ok).toBe(false);
    const ja = await emit<{ c: number }>(a.s, 'paint:join');
    const jb = await emit<{ c: number }>(b.s, 'paint:join');
    expect(ja.ok && jb.ok).toBe(true);
    expect(ja.c).not.toBe(jb.c);

    // a tags b: b wears a's colour, and everyone hears about it
    type PaintState = { pid: string; paint: { c: number; splats: [number, number, number][] } | null };
    const tagged = once<PaintState>(a.s, 'paint:state', (v) => v.pid === b.joined.me.pid && (v.paint?.splats.length ?? 0) > 0);
    const shot = once<{ hit: string; victim?: string; c: number }>(b.s, 'paint:shot', (v) => v.hit === 'player');
    const fired = await emit<{ score: number }>(a.s, 'paint:fire', { a: 0 });
    expect(fired.ok).toBe(true);
    const st = await tagged;
    expect(st.paint!.splats).toHaveLength(1);
    expect(st.paint!.splats[0][0]).toBe(ja.c);
    const seen = await shot;
    expect(seen.victim).toBe(b.joined.me.pid);
    expect(seen.c).toBe(ja.c);
    // the marker needs a moment between shots
    expect((await emit(a.s, 'paint:fire', { a: 0 })).ok).toBe(false);
    // a wild angle is junk
    expect((await emit(a.s, 'paint:fire', { a: 99 })).ok).toBe(false);

    // b washes off
    const clean = once<PaintState>(a.s, 'paint:state', (v) => v.pid === b.joined.me.pid && v.paint?.splats.length === 0);
    expect((await emit(b.s, 'paint:wash')).ok).toBe(true);
    await clean;

    // a walks under the first bullseye and plinks it
    const t = paintTargets(map)[0];
    await walkTo(a, t.x + t.w / 2, 190);
    const score = once<{ score: number }>(a.s, 'paint:score', (v) => v.score === 1);
    await new Promise((r) => setTimeout(r, PAINT_FIRE_GAP_MS + 50));
    const hit = await emit<{ score: number }>(a.s, 'paint:fire', { a: -Math.PI / 2 });
    expect(hit.ok).toBe(true);
    expect(hit.score).toBe(1);
    await score;
    // a miss into the wall scores nothing
    await new Promise((r) => setTimeout(r, PAINT_FIRE_GAP_MS + 50));
    const miss = await emit<{ score: number }>(a.s, 'paint:fire', { a: Math.PI });
    expect(miss.score).toBe(1);

    // stepping off the yard puts the marker down
    const out = once<PaintState>(b.s, 'paint:state', (v) => v.pid === a.joined.me.pid && v.paint === null);
    expect((await emit(a.s, 'paint:leave')).ok).toBe(true);
    await out;
    expect((await emit(a.s, 'paint:fire', { a: 0 })).ok).toBe(false);
    a.s.close();
    b.s.close();
  }, 40000);
});
