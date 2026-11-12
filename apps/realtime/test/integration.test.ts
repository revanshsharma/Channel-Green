import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { registry } from '@channel-green/content';
import { activityOf, randomAvatar, type JoinOk, type Registry, type PublicPlayer, type ChatMessage } from '@channel-green/shared';
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
