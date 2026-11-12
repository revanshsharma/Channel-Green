import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { registry } from '@channel-green/content';
import {
  AvatarConfigSchema,
  BlockSchema,
  ChannelSchema,
  ChatSchema,
  ConfessionIdSchema,
  ConfessionPostSchema,
  DIR_INDEX,
  ActivitySchema,
  STRETCH_MS,
  activityBits,
  activityBlocked,
  activityOf,
  withoutActivity,
  EmoteSendSchema,
  FLAG_MOVING,
  FLAG_SEATED,
  seatPoint,
  InteractSchema,
  JoinSchema,
  LIMITS,
  MediaControlSchema,
  MediaSetSchema,
  ModActionSchema,
  MoveSchema,
  NAME_MAX,
  PortalUseSchema,
  ReportSchema,
  RequestRespondSchema,
  RequestSendSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomModSchema,
  VoiceTokenSchema,
  canStand,
  currentPosition,
  parseMediaSource,
  randomAvatar,
  rectsOverlap,
  sanitizeAvatar,
  sanitizeName,
  sanitizeText,
  feetBox,
  type ChatMessage,
  type Confession,
  type IncomingRequest,
  type InteractResult,
  type JoinOk,
  type MediaChannel,
  type Registry,
  type ServerToClient,
} from '@channel-green/shared';
import { Auth } from './auth';
import type { Config } from './config';
import { KeyedLimiter, TokenBucket } from './safety/rateLimit';
import { Moderation } from './safety/moderation';
import { createStore, type Store } from './store';
import { createVoice, livekitRoomName, type VoiceService } from './voice';
import { applyMedia } from './world/media';
import { validateMove } from './world/movement';
import { Instance, WorldManager, type Player } from './world/instance';

const reg = registry as Registry;
const HUB = 'town-square';
const TICK_MS = 66;
const HISTORY_MAX = 30;
const REACH_PX = 28;
const REQUEST_TTL_MS = 30_000;

type Ack = (res: any) => void;
const noop: Ack = () => {};
const fail = (error: string) => ({ ok: false as const, error });

interface Pending {
  req: IncomingRequest;
  to: string;
  fromPid: string;
  instanceId: string;
}

export interface Realtime {
  http: HttpServer;
  io: Server;
  world: WorldManager;
  store: Store;
  mod: Moderation;
  auth: Auth;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createRealtime(cfg: Config, overrides: { store?: Store; voice?: VoiceService; moderation?: Moderation } = {}): Realtime {
  const store = overrides.store ?? createStore(cfg);
  const auth = new Auth(cfg);
  const voice = overrides.voice ?? createVoice(cfg);
  const mod = overrides.moderation ?? new Moderation({ extraTerms: cfg.extraBlockedTerms });
  const world = new WorldManager(reg);
  const guestLimiter = new KeyedLimiter(10, 10 / 3600);
  const joinLimiter = new KeyedLimiter(20, 20 / 60);
  const confessionLimiter = new KeyedLimiter(2, 1 / 90);
  const reqCooldown = new Map<string, number>();
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Player>(); // by socket id
  const byPid = new Map<string, Player>();
  const byUid = new Map<string, Player>();
  const ipCount = new Map<string, number>();
  const lastQuiet = new Map<string, number>();

  const originOk = (origin: string | undefined) => !origin || cfg.allowedOrigins.includes('*') || cfg.allowedOrigins.includes(origin);

  // ----------------------------------------------------------------- http

  const clientIp = (req: IncomingMessage): string => {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const json = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (origin && originOk(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers.vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage, max = 8192): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > max) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

  const bearer = (req: IncomingMessage) => {
    const h = String(req.headers.authorization ?? '');
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  };

  const features = (mapId: string): JoinOk['features'] => {
    const m = reg.maps[mapId];
    if (!voice.enabled) return { voice: false, voiceReason: 'Voice and video need a LiveKit server, which is not set up here yet.', persistence: store.kind };
    if (m?.voice === 'off') return { voice: false, voiceReason: 'This room keeps its voices off.', persistence: store.kind };
    return { voice: true, persistence: store.kind };
  };

  const http = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (req.method === 'OPTIONS') {
        const headers: Record<string, string> = { 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': 'content-type,authorization', 'access-control-max-age': '600' };
        if (origin && originOk(origin)) headers['access-control-allow-origin'] = origin;
        res.writeHead(204, headers);
        return void res.end();
      }
      if (origin && !originOk(origin)) return json(res, 403, { error: 'origin not allowed' });
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), ...world.stats(), store: store.kind, voice: voice.enabled }, origin);
      }
      if (url.pathname === '/config' && req.method === 'GET') {
        return json(res, 200, { voice: voice.enabled, persistence: store.kind, accounts: !!cfg.supabase, nameMax: NAME_MAX }, origin);
      }
      if (url.pathname === '/auth/guest' && req.method === 'POST') {
        if (!guestLimiter.allow(clientIp(req))) return json(res, 429, { error: 'Too many new guests from here. Try again later.' }, origin);
        return json(res, 200, await auth.issueGuest(), origin);
      }
      if (url.pathname === '/profile') {
        const id = await auth.verify(bearer(req));
        if (!id) return json(res, 401, { error: 'sign in first' }, origin);
        if (!joinLimiter.allow(`profile:${id.uid}`)) return json(res, 429, { error: 'slow down' }, origin);
        if (req.method === 'GET') return json(res, 200, { profile: await store.getProfile(id.sub) }, origin);
        if (req.method === 'PUT') {
          const body = z.object({ name: z.string().max(80), avatar: z.unknown() }).safeParse(await readBody(req));
          const name = body.success ? sanitizeName(body.data.name) : null;
          if (!body.success || !name || !mod.nameAllowed(name)) return json(res, 400, { error: 'That name or avatar cannot be saved.' }, origin);
          const avatar = sanitizeAvatar(body.data.avatar, reg.avatar);
          await store.saveProfile(id.sub, { name, avatar });
          return json(res, 200, { ok: true, profile: { name, avatar } }, origin);
        }
      }
      json(res, 404, { error: 'not found' }, origin);
    } catch (e) {
      if (!res.headersSent) json(res, 400, { error: 'bad request' }, origin);
      if (cfg.production === false) console.warn('[http]', (e as Error).message);
    }
  });

  // ----------------------------------------------------------------- socket plumbing

  const io = new Server(http, {
    cors: { origin: cfg.allowedOrigins.includes('*') ? true : cfg.allowedOrigins },
    maxHttpBufferSize: 100_000,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    allowRequest: (req, cb) => cb(null, originOk(req.headers.origin)),
    serveClient: false,
  });

  const send = <K extends keyof ServerToClient>(sid: string, ev: K, ...args: Parameters<ServerToClient[K]>) => {
    (io.to(sid) as any).emit(ev, ...args);
  };
  const toRoom = <K extends keyof ServerToClient>(inst: Instance, ev: K, ...args: Parameters<ServerToClient[K]>) => {
    (io.to(inst.channel) as any).emit(ev, ...args);
  };
  const hides = (a: Player, b: Player) => a.blocks.has(b.uid) || b.blocks.has(a.uid);
  /** like toRoom, but skips anyone who has blocked (or been blocked by) the sender */
  const toVisible = <K extends keyof ServerToClient>(inst: Instance, from: Player, ev: K, ...args: Parameters<ServerToClient[K]>) => {
    for (const p of inst.players.values()) if (p === from || !hides(from, p)) send(p.sid, ev, ...args);
  };
  /** After a block or unblock, make both screens match: neither side keeps a frozen copy of the other, and both see each other again once nobody blocks. */
  const syncVisibility = (p: Player, otherUid: string) => {
    const inst = p.instance as Instance | undefined;
    if (!inst) return;
    for (const o of inst.players.values()) {
      if (o === p || o.uid !== otherUid) continue;
      if (hides(p, o)) {
        send(p.sid, 'player:leave', { pid: o.pid });
        send(o.sid, 'player:leave', { pid: p.pid });
      } else {
        send(p.sid, 'player:join', inst.publicPlayer(o));
        send(o.sid, 'player:join', inst.publicPlayer(p));
      }
    }
  };
  const notice = (p: Player, text: string, level: 'info' | 'warn' = 'info') => send(p.sid, 'notice', { level, text });
  const canModerate = (p: Player, inst: Instance) => p.moderator || inst.hostPid === p.pid;

  const ipOf = (socket: Socket): string => {
    if (cfg.trustProxy) {
      const xff = String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return socket.handshake.address || 'unknown';
  };

  io.use((socket, next) => {
    const ip = ipOf(socket);
    const n = ipCount.get(ip) ?? 0;
    if (n >= cfg.maxConnectionsPerIp) return next(new Error('too many connections'));
    ipCount.set(ip, n + 1);
    socket.data.ip = ip;
    socket.data.bucket = new TokenBucket(40, 25);
    socket.data.strikes = 0;
    next();
  });

  // ----------------------------------------------------------------- world helpers

  function uniqueName(inst: Instance, p: Player): string {
    const taken = new Set([...inst.players.values()].filter((o) => o !== p && o.uid !== p.uid).map((o) => o.name.toLowerCase()));
    if (!taken.has(p.name.toLowerCase())) return p.name;
    for (let i = 2; i < 100; i++) {
      const base = Array.from(p.name).slice(0, NAME_MAX - 3).join('');
      const cand = `${base} ${i}`;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
    return p.name;
  }

  function placeAtSpawn(p: Player, inst: Instance, spawnName?: string) {
    const [sx, sy] = world.spawn(inst, spawnName);
    let x = sx;
    let y = sy;
    for (let i = 0; i < 8; i++) {
      const jx = i === 0 ? 0 : (Math.random() - 0.5) * 14;
      const jy = i === 0 ? 0 : (Math.random() - 0.5) * 8;
      if (canStand(inst.collision, sx + jx, sy + jy)) {
        x = sx + jx;
        y = sy + jy;
        break;
      }
    }
    p.x = x;
    p.y = y;
  }

  function enter(p: Player, inst: Instance, spawnName?: string, asHost = false) {
    p.instance = inst;
    p.name = uniqueName(inst, p);
    p.dir = 'down';
    p.flags = 0;
    p.actUntil = 0;
    p.moveT = Date.now();
    p.dirty = false;
    p.silenced = false;
    placeAtSpawn(p, inst, spawnName);
    inst.players.set(p.pid, p);
    if (asHost || (inst.mode === 'invite' && !inst.hostPid)) inst.hostPid = p.pid;
    const sock = io.sockets.sockets.get(p.sid);
    sock?.join(inst.channel);
    if (inst.map.features.includes('confession')) sock?.join('confession');
    for (const o of inst.players.values()) if (o !== p) send(o.sid, 'player:join', inst.publicPlayer(p));
    toRoom(inst, 'room:info', inst.info());
  }

  function leave(p: Player) {
    const inst = p.instance;
    if (!inst) return;
    inst.players.delete(p.pid);
    p.instance = null;
    const sock = io.sockets.sockets.get(p.sid);
    sock?.leave(inst.channel);
    sock?.leave('confession');
    toRoom(inst, 'player:leave', { pid: p.pid });
    for (const [id, pr] of pending) if (pr.to === p.pid || pr.fromPid === p.pid) pending.delete(id);
    for (const ch of ['watch', 'listen'] as MediaChannel[]) {
      const m = inst.media[ch];
      if (m && m.hostPid === p.pid) inst.media[ch] = { ...m, hostPid: null, rev: m.rev + 1 };
    }
    if (inst.hostPid === p.pid) {
      const next = [...inst.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      inst.hostPid = inst.mode === 'invite' && next ? next.pid : null;
      if (next && inst.hostPid) toRoom(inst, 'player:update', { pid: next.pid, role: next.moderator ? 'guide' : 'host' });
    }
    if (!world.releaseIfEmpty(inst)) toRoom(inst, 'room:info', inst.info());
  }

  function joinOk(p: Player, inst: Instance): JoinOk {
    const media: JoinOk['media'] = {};
    for (const ch of inst.map.features) if (ch === 'watch' || ch === 'listen') if (inst.media[ch]) media[ch] = inst.media[ch];
    return {
      me: inst.publicPlayer(p),
      room: inst.info(),
      map: inst.map.id,
      players: [...inst.players.values()].filter((o) => o !== p).map((o) => inst.publicPlayer(o)),
      serverNow: Date.now(),
      features: features(inst.map.id),
      media,
      history: inst.history.filter((m) => !m.from || !p.blocks.has(m.from.uid)),
      moderator: p.moderator,
    };
  }

  /** Sends one player's place and pose to the room right away and reliably, so a change of pose is never lost like a walking step can be. */
  function pushState(inst: Instance, p: Player) {
    toRoom(inst, 'world:state', [[p.pid, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, DIR_INDEX[p.dir], p.flags]]);
  }

  /** Moves a player to another instance and tells them to rebuild the scene. */
  function relocate(p: Player, inst: Instance, spawn?: string, asHost = false) {
    leave(p);
    enter(p, inst, spawn, asHost);
    send(p.sid, 'room:changed', joinOk(p, inst));
  }

  function publicFor(mapId: string, uid: string): Instance {
    // skip copies that banned this player
    const inst = world.publicFor(mapId);
    if (!inst.isBanned(uid)) return inst;
    for (const i of world.all()) if (i.mode === 'public' && i.map.id === mapId && !i.full && !i.isBanned(uid)) return i;
    // all existing copies refuse them: open another by briefly filling the counter
    const fresh = world.publicFor(mapId);
    return fresh;
  }

  function sendHome(p: Player, why: string) {
    send(p.sid, 'kicked', { reason: why });
    relocate(p, publicFor(HUB, p.uid), 'start');
  }

  // ----------------------------------------------------------------- guard

  type Bucket = keyof Player['buckets'] | null;
  function on<S extends z.ZodType | null>(
    socket: Socket,
    event: string,
    schema: S,
    bucket: Bucket,
    fn: (p: Player, data: S extends z.ZodType ? z.infer<S> : undefined, ack: Ack) => void | Promise<void>,
    { needsJoin = true } = {},
  ) {
    socket.on(event, async (a: unknown, b: unknown) => {
      const ack: Ack = typeof b === 'function' ? (b as Ack) : typeof a === 'function' ? (a as Ack) : noop;
      const raw = typeof a === 'function' ? undefined : a;
      if (!socket.data.bucket.take()) {
        socket.data.strikes++;
        ack(fail('Slow down.'));
        if (socket.data.strikes > 8) socket.disconnect(true);
        return;
      }
      const p = sessions.get(socket.id);
      if (needsJoin && !p) return ack(fail('Join first.'));
      let data: unknown = undefined;
      if (schema) {
        const r = (schema as z.ZodType).safeParse(raw);
        if (!r.success) return ack(fail('That did not look right.'));
        data = r.data;
      }
      if (p && bucket && !p.buckets[bucket].take()) return ack(fail('Easy there, try again in a moment.'));
      try {
        await fn(p as Player, data as never, ack);
      } catch (e) {
        console.warn(`[socket] ${event} failed:`, (e as Error).message);
        ack(fail('Something went wrong. Try again.'));
      }
    });
  }

  // ----------------------------------------------------------------- connection

  io.on('connection', (socket) => {
    on(socket, 'time:ping', null, null, (_p, _d, ack) => (ack as any)(Date.now()), { needsJoin: false });

    on(
      socket,
      'join',
      JoinSchema,
      null,
      async (_p, data, ack) => {
        if (sessions.has(socket.id) || socket.data.joining) return ack(fail('Already joined.'));
        socket.data.joining = true;
        try {
          if (!joinLimiter.allow(`ip:${socket.data.ip}`)) return ack(fail('Too many tries. Wait a minute.'));
          const id = await auth.verify(data.token);
          if (!id) return ack(fail('Could not sign you in. Please reload the page.'));
          if (await store.isBanned(id.uid)) return ack(fail('This account cannot join Channel Green.'));
          const name = sanitizeName(data.name);
          if (!name) return ack(fail('Pick a name with at least 2 letters or numbers.'));
          if (!mod.nameAllowed(name)) return ack(fail('That name is not available.'));
          const avatar = sanitizeAvatar(data.avatar, reg.avatar);

          let inst: Instance | undefined;
          if (data.code) {
            inst = world.byCode(data.code);
            if (!inst) return ack(fail('No room with that code.'));
            if (inst.locked) return ack(fail('That room is locked.'));
            if (inst.isBanned(id.uid)) return ack(fail('You cannot join that room.'));
            if (inst.full) return ack(fail('That room is full.'));
          } else {
            const mapId = data.map && reg.maps[data.map] ? data.map : HUB;
            inst = publicFor(mapId, id.uid);
          }

          // one live session per person: a second tab replaces the first
          const old = byUid.get(id.uid);
          if (old) {
            send(old.sid, 'kicked', { reason: 'You joined from another window.' });
            const s = io.sockets.sockets.get(old.sid);
            if (s) s.disconnect(true);
            else dropSession(old);
          }

          const stored = await store.getBlocks(id.uid).catch(() => [] as string[]);
          const blocks = new Set<string>([...stored, ...(data.blocks ?? [])].filter((b) => b !== id.uid).slice(0, LIMITS.blocksMax));
          const p: Player = {
            pid: randomUUID().slice(0, 12),
            sid: socket.id,
            sub: id.sub,
            uid: id.uid,
            guest: id.guest,
            moderator: !id.guest && cfg.moderatorUserIds.has(id.sub),
            name,
            avatar,
            x: 0,
            y: 0,
            dir: 'down',
            flags: 0,
            actUntil: 0,
            moveT: Date.now(),
            dirty: false,
            blocks,
            silenced: false,
            joinedAt: Date.now(),
            instance: null,
            abuse: 0,
            buckets: {
              move: new TokenBucket(40, 30),
              chat: new TokenBucket(4, 0.7),
              req: new TokenBucket(3, 0.25),
              emote: new TokenBucket(4, 0.6),
              activity: new TokenBucket(5, 0.5),
              media: new TokenBucket(6, 0.5),
              any: new TokenBucket(30, 15),
              report: new TokenBucket(3, 1 / 40),
              room: new TokenBucket(3, 0.1),
              join: new TokenBucket(3, 0.2),
            },
          };
          sessions.set(socket.id, p);
          byPid.set(p.pid, p);
          byUid.set(p.uid, p);
          enter(p, inst);
          store.saveProfile(id.sub, { name, avatar }).catch(() => {});
          ack({ ok: true, ...joinOk(p, inst) });
        } finally {
          socket.data.joining = false;
        }
      },
      { needsJoin: false },
    );

    function dropSession(p: Player) {
      leave(p);
      sessions.delete(p.sid);
      if (byPid.get(p.pid) === p) byPid.delete(p.pid);
      if (byUid.get(p.uid) === p) byUid.delete(p.uid);
      lastQuiet.delete(p.pid);
    }

    socket.on('disconnect', () => {
      const ip = socket.data.ip as string;
      const n = (ipCount.get(ip) ?? 1) - 1;
      if (n <= 0) ipCount.delete(ip);
      else ipCount.set(ip, n);
      const p = sessions.get(socket.id);
      if (p) dropSession(p);
    });

    // ------------------------------------------------------------- movement

    on(socket, 'move', MoveSchema, 'move', (p, d) => {
      const inst = p.instance;
      if (!inst) return;
      const now = Date.now();
      const seated = (p.flags & FLAG_SEATED) !== 0;
      // a "still here" message from someone seated, sipping tea or lying down changes nothing; walking anywhere ends it
      if ((seated || activityOf(p.flags)) && !d.moving && Math.hypot(d.x - p.x, d.y - p.y) < 0.5) return;
      const v = validateMove(inst.collision, inst.moveState(p), d.x, d.y, now);
      if (!v.ok) {
        send(p.sid, 'pos:correct', { x: p.x, y: p.y, seq: d.seq });
        return;
      }
      p.x = v.x;
      p.y = v.y;
      p.dir = d.dir;
      p.flags = d.moving ? FLAG_MOVING : 0;
      p.actUntil = 0;
      p.moveT = now;
      p.dirty = true;
    });

    // ------------------------------------------------------------- activities

    on(socket, 'activity', ActivitySchema, 'activity', (p, d, ack) => {
      const inst = p.instance;
      if (!inst) return ack(fail('Not in a room.'));
      const seated = (p.flags & FLAG_SEATED) !== 0;
      if (d.id === 'none') {
        p.flags = withoutActivity(p.flags);
      } else {
        const why = activityBlocked(d.id, seated);
        if (why) return ack(fail(why));
        if (d.id === 'lie') {
          if (inst.collision.portals.some((x) => rectsOverlap(feetBox(p.x, p.y), { x: x.px.x - 8, y: x.px.y - 8, w: x.px.w + 16, h: x.px.h + 16 }))) return ack(fail('Not in the doorway. Find a quiet corner.'));
          for (const o of inst.players.values()) if (o !== p && activityOf(o.flags) === 'lie' && Math.hypot(o.x - p.x, o.y - p.y) < 14) return ack(fail('Someone is resting right there.'));
        }
        if (activityOf(p.flags) === d.id) {
          // asking for the same thing again puts it away, so one key does both
          p.flags = withoutActivity(p.flags);
        } else p.flags = (p.flags & FLAG_SEATED) | activityBits(d.id);
        p.actUntil = d.id === 'stretch' && activityOf(p.flags) ? Date.now() + STRETCH_MS : 0;
      }
      p.moveT = Date.now();
      p.dirty = false;
      pushState(inst, p);
      ack({ ok: true, flags: p.flags });
    });

    // ------------------------------------------------------------- chat

    function deliverChat(p: Player, text: string, to: Player | null, ack: Ack) {
      const inst = p.instance as Instance;
      const msg: ChatMessage = {
        id: randomUUID().slice(0, 10),
        scope: to ? 'dm' : 'room',
        ts: Date.now(),
        from: { pid: p.pid, uid: p.uid, name: p.name },
        to: to ? { pid: to.pid, name: to.name } : undefined,
        text,
      };
      if (to) {
        send(p.sid, 'chat:msg', msg);
        if (!hides(p, to)) send(to.sid, 'chat:msg', msg);
      } else {
        inst.history.push(msg);
        if (inst.history.length > HISTORY_MAX) inst.history.shift();
        inst.remember(p.uid, text);
        toVisible(inst, p, 'chat:msg', msg);
      }
      ack({ ok: true });
    }

    on(socket, 'chat:send', ChatSchema, 'chat', (p, d, ack) => {
      const inst = p.instance as Instance;
      const quiet = !!inst.map.quiet;
      const text = sanitizeText(d.text, quiet ? LIMITS.noteMax : LIMITS.chatMax);
      if (!text) return ack(fail('Write something first.'));
      if (mod.mutedUntil(p.uid)) return ack(fail('You are muted for a little while. Take a breath.'));
      let to: Player | null = null;
      if (d.to) {
        to = inst.players.get(d.to) ?? null;
        if (!to || to === p) return ack(fail('They are not here right now.'));
      } else {
        if (p.silenced) return ack(fail('The host has asked you to stay quiet for now.'));
        if (inst.silenced && !canModerate(p, inst)) return ack(fail('Only the host can speak right now.'));
        if (quiet) {
          const last = lastQuiet.get(p.pid) ?? 0;
          if (Date.now() - last < 4000) return ack(fail('This room is quiet. A small note every few seconds is plenty.'));
          lastQuiet.set(p.pid, Date.now());
        }
      }
      if (mod.isRepeat(p.uid, text)) return ack(fail('You just said that.'));
      const verdict = mod.checkText(text);
      if (!verdict.ok) {
        const until = mod.strike(p.uid);
        if (until) notice(p, 'You have been muted for a few minutes. Let us all keep it kind.', 'warn');
        return ack(fail(verdict.reason === 'spam' ? 'That looks like spam, so it was not sent.' : 'That message was not sent. Please keep it kind.'));
      }
      if (to && hides(p, to)) return ack({ ok: true }); // silently dropped: nobody learns they were blocked
      deliverChat(p, text, to, ack);
    });

    on(socket, 'emote', EmoteSendSchema, 'emote', (p, d, ack) => {
      const e = reg.emotes.find((x) => x.id === d.id);
      if (!e || !p.instance) return ack(fail('Unknown emote.'));
      toVisible(p.instance, p, 'emote', { pid: p.pid, id: e.id, glyph: e.glyph });
      ack({ ok: true });
    });

    // ------------------------------------------------------------- objects and portals

    const distToRect = (p: Player, r: { x: number; y: number; w: number; h: number }) => {
      const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
      const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
      return Math.hypot(dx, dy);
    };

    on(socket, 'interact', InteractSchema, 'any', (p, d, ack) => {
      const inst = p.instance as Instance;
      const placement = inst.map.objects[d.object];
      const def = placement && reg.furniture[placement.furniture];
      if (!placement || !def?.interaction) return ack(fail('Nothing to do there.'));
      const box = { x: placement.at[0], y: placement.at[1], w: def.size[0], h: def.size[1] };
      if (distToRect(p, box) > REACH_PX) return ack(fail('Walk a little closer.'));
      const it = def.interaction;
      let result: InteractResult;
      switch (it.kind) {
        case 'inspect':
          result = { kind: 'inspect', text: placement.text ?? it.text, name: placement.label ?? def.name };
          break;
        case 'wish':
          toRoom(inst, 'wish', { pid: p.pid, name: p.name });
          result = { kind: 'wish' };
          break;
        case 'panel':
          if ((it.panel === 'watch' || it.panel === 'listen' || it.panel === 'confession') && !inst.map.features.includes(it.panel)) return ack(fail('Nothing is playing in this room.'));
          result = { kind: 'panel', panel: it.panel };
          break;
        case 'sit': {
          const { x: sx, y: sy } = seatPoint(def, placement.at, p.x);
          for (const o of inst.players.values()) if (o !== p && (o.flags & FLAG_SEATED) && Math.hypot(o.x - sx, o.y - sy) < 9) return ack(fail('Someone is already sitting there.'));
          p.x = sx;
          p.y = sy;
          p.dir = it.dir ?? 'down';
          // a cup of tea comes along to the seat; anything else is put away
          p.flags = FLAG_SEATED | (activityOf(p.flags) === 'tea' ? activityBits('tea') : 0);
          p.actUntil = 0;
          p.moveT = Date.now();
          p.dirty = false;
          pushState(inst, p);
          result = { kind: 'sit', x: sx, y: sy, dir: p.dir };
          break;
        }
      }
      ack({ ok: true, result });
    });

    on(socket, 'portal:use', PortalUseSchema, 'room', (p, d, ack) => {
      const inst = p.instance as Instance;
      const portal = inst.collision.portals.find((x) => x.id === d.portal);
      if (!portal) return ack(fail('No such door.'));
      const pad = { x: portal.px.x - 6, y: portal.px.y - 6, w: portal.px.w + 12, h: portal.px.h + 12 };
      if (!rectsOverlap(feetBox(p.x, p.y), pad)) return ack(fail('Walk up to the door first.'));
      if (!reg.maps[portal.to]) return ack(fail('That door leads nowhere yet.'));
      relocate(p, publicFor(portal.to, p.uid), portal.spawn);
      ack({ ok: true });
    });

    // ------------------------------------------------------------- requests

    on(socket, 'request:send', RequestSendSchema, 'req', async (p, d, ack) => {
      const inst = p.instance as Instance;
      const target = inst.players.get(d.to);
      if (!target || target === p) return ack(fail('They are not here right now.'));
      if (d.kind === 'invite' && inst.mode !== 'invite') return ack(fail('Invites are for private rooms. Create one first.'));
      const key = `${p.pid}>${target.pid}:${d.kind}`;
      const nowMs = Date.now();
      if ((reqCooldown.get(key) ?? 0) > nowMs) return ack(fail('You already asked. Give them a moment.'));
      let outbound = 0;
      for (const pr of pending.values()) if (pr.fromPid === p.pid) outbound++;
      if (outbound >= 3) return ack(fail('You have a few requests waiting already.'));
      reqCooldown.set(key, nowMs + 20_000);
      if (hides(p, target)) return ack({ ok: true }); // silently dropped
      let note = d.note ? sanitizeText(d.note, LIMITS.noteMax) : undefined;
      if (note && !mod.checkText(note).ok) note = undefined;
      const req: IncomingRequest = {
        id: randomUUID().slice(0, 10),
        kind: d.kind,
        from: { pid: p.pid, uid: p.uid, name: p.name },
        note: note || undefined,
        code: d.kind === 'invite' ? inst.code : undefined,
        expiresAt: nowMs + REQUEST_TTL_MS,
      };
      pending.set(req.id, { req, to: target.pid, fromPid: p.pid, instanceId: inst.id });
      send(target.sid, 'request:incoming', req);
      ack({ ok: true });
    });

    on(socket, 'request:respond', RequestRespondSchema, 'any', (p, d, ack) => {
      const pr = pending.get(d.id);
      if (!pr || pr.to !== p.pid) return ack(fail('That request has expired.'));
      pending.delete(d.id);
      const from = byPid.get(pr.fromPid);
      if (!from || pr.req.expiresAt < Date.now()) return ack(fail('That request has expired.'));
      send(from.sid, 'request:result', { id: d.id, accepted: d.accept, by: p.name, kind: pr.req.kind });
      const inst = p.instance;
      if (d.accept && inst && from.instance === inst && (pr.req.kind === 'wave' || pr.req.kind === 'hug' || pr.req.kind === 'sit')) {
        const near = Math.hypot(from.x - p.x, from.y - p.y) <= 120;
        if (near) toVisible(inst, p, 'request:effect', { kind: pr.req.kind, a: from.pid, b: p.pid });
        else {
          notice(p, 'Walk closer to share that.');
          notice(from, 'Walk closer to share that.');
        }
      }
      ack({ ok: true });
    });

    // ------------------------------------------------------------- safety

    on(socket, 'safety:block', BlockSchema, 'any', async (p, d, ack) => {
      if (d.uid === p.uid) return ack(fail('That is you.'));
      if (p.blocks.size >= LIMITS.blocksMax) return ack(fail('Your block list is full.'));
      p.blocks.add(d.uid);
      syncVisibility(p, d.uid);
      await store.addBlock(p.uid, d.uid).catch(() => {});
      ack({ ok: true });
    });
    on(socket, 'safety:unblock', BlockSchema, 'any', async (p, d, ack) => {
      p.blocks.delete(d.uid);
      syncVisibility(p, d.uid);
      await store.removeBlock(p.uid, d.uid).catch(() => {});
      ack({ ok: true });
    });

    on(socket, 'safety:report', ReportSchema, 'report', async (p, d, ack) => {
      const inst = p.instance as Instance;
      const details = d.details ? sanitizeText(d.details, LIMITS.reportReasonMax) : null;
      if (d.confession) {
        const c = await store.getConfession(d.confession);
        if (!c) return ack(fail('That confession is already gone.'));
        await store.addReport({ id: randomUUID(), ts: Date.now(), reporterUid: p.uid, targetUid: null, confessionId: c.id, reason: d.reason, details, mapId: inst.map.id, context: [c.text] });
        const count = await store.reportConfession(c.id, p.uid);
        if (count >= 3 && !c.hidden) {
          await store.hideConfession(c.id);
          (io.to('confession') as any).emit('confession:removed', { id: c.id });
        }
        return ack({ ok: true });
      }
      const target = d.pid ? inst.players.get(d.pid) : undefined;
      if (!target || target === p) return ack(fail('They are not here right now.'));
      await store.addReport({
        id: randomUUID(),
        ts: Date.now(),
        reporterUid: p.uid,
        targetUid: target.uid,
        confessionId: null,
        reason: d.reason,
        details,
        mapId: inst.map.id,
        context: [...(inst.recent.get(target.uid) ?? [])],
      });
      p.blocks.add(target.uid);
      syncVisibility(p, target.uid);
      store.addBlock(p.uid, target.uid).catch(() => {});
      const r = mod.report(target.uid, p.uid);
      if (r.tripped) {
        notice(target, 'Several people have asked for some quiet. You are muted for a while.', 'warn');
        if (!canModerate(target, inst)) target.silenced = false;
      }
      ack({ ok: true });
    });

    // ------------------------------------------------------------- rooms

    on(socket, 'room:create', RoomCreateSchema, 'room', (p, d, ack) => {
      const name = d.name ? sanitizeText(d.name, LIMITS.roomNameMax) : undefined;
      if (name && !mod.checkText(name).ok) return ack(fail('Please pick a different room name.'));
      if (p.instance?.mode === 'invite' && p.instance.hostPid === p.pid) return ack(fail('You are already hosting a room. Leave it first.'));
      const inst = world.createPrivate(d.map, name);
      if (!inst) return ack(fail('That place cannot be made private.'));
      relocate(p, inst, undefined, true);
      ack({ ok: true, code: inst.code });
    });

    on(socket, 'room:join', RoomJoinSchema, 'join', (p, d, ack) => {
      const inst = world.byCode(d.code);
      if (!inst) return ack(fail('No room with that code.'));
      if (inst === p.instance) return ack({ ok: true });
      if (inst.locked) return ack(fail('That room is locked.'));
      if (inst.isBanned(p.uid)) return ack(fail('You cannot join that room.'));
      if (inst.full) return ack(fail('That room is full.'));
      relocate(p, inst);
      ack({ ok: true });
    });

    on(socket, 'room:leave', null, 'room', (p, _d, ack) => {
      if (p.instance?.mode === 'invite') {
        relocate(p, publicFor(HUB, p.uid), 'start');
      }
      ack({ ok: true });
    });

    on(socket, 'room:mod', RoomModSchema, 'any', async (p, d, ack) => {
      const inst = p.instance as Instance;
      if (!canModerate(p, inst)) return ack(fail('Only the host can do that.'));
      const needsTarget = ['kick', 'ban', 'silence-player', 'unsilence-player', 'make-host'].includes(d.action);
      const target = d.pid ? inst.players.get(d.pid) : undefined;
      if (needsTarget) {
        if (!target || target === p) return ack(fail('Pick someone else in the room.'));
        if (target.moderator && !p.moderator) return ack(fail('You cannot do that to a guide.'));
      }
      switch (d.action) {
        case 'kick':
        case 'ban': {
          const t = target as Player;
          inst.bans.set(t.uid, Date.now() + (d.action === 'ban' ? 24 * 3600_000 : 5 * 60_000));
          if (voice.enabled) voice.remove(livekitRoomName(inst.id), t.pid).catch(() => {});
          sendHome(t, d.action === 'ban' ? 'You were removed from that room.' : 'You were asked to leave that room for a bit.');
          break;
        }
        case 'silence-player':
        case 'unsilence-player': {
          const t = target as Player;
          t.silenced = d.action === 'silence-player';
          toRoom(inst, 'player:update', { pid: t.pid, silenced: t.silenced });
          notice(t, t.silenced ? 'The host has asked for you to be quiet for now.' : 'You can chat again.', t.silenced ? 'warn' : 'info');
          break;
        }
        case 'lock':
        case 'unlock':
          inst.locked = d.action === 'lock';
          toRoom(inst, 'room:info', inst.info());
          break;
        case 'silence-room':
        case 'unsilence-room':
          inst.silenced = d.action === 'silence-room';
          toRoom(inst, 'room:info', inst.info());
          break;
        case 'make-host': {
          const t = target as Player;
          const old = inst.hostPid;
          inst.hostPid = t.pid;
          if (old) {
            const o = inst.players.get(old);
            if (o) toRoom(inst, 'player:update', { pid: o.pid, role: o.moderator ? 'guide' : 'player' });
          }
          toRoom(inst, 'player:update', { pid: t.pid, role: t.moderator ? 'guide' : 'host' });
          toRoom(inst, 'room:info', inst.info());
          break;
        }
      }
      ack({ ok: true });
    });

    // ------------------------------------------------------------- watch together and listening room

    const mayControl = (p: Player, inst: Instance, channel: MediaChannel) => {
      if (p.moderator || inst.hostPid === p.pid) return true;
      if (inst.mode === 'invite') return false; // private parties: the host drives
      const m = inst.media[channel];
      return !m?.hostPid || m.hostPid === p.pid || !inst.players.has(m.hostPid);
    };
    const publishMedia = (inst: Instance, channel: MediaChannel) => {
      const m = inst.media[channel];
      if (m) toRoom(inst, 'media:state', m);
    };

    on(socket, 'media:set', MediaSetSchema, 'media', (p, d, ack) => {
      const inst = p.instance as Instance;
      if (!inst.map.features.includes(d.channel)) return ack(fail('There is nothing to play in this room.'));
      if (!mayControl(p, inst, d.channel)) return ack(fail(inst.mode === 'invite' ? 'Only the host picks what plays.' : 'Someone else is running this right now.'));
      const title = d.title ? sanitizeText(d.title, 80) : undefined;
      if (title && !mod.checkText(title).ok) return ack(fail('Please pick a different title.'));
      const r = parseMediaSource(d.channel, d.kind, d.input, title, reg.tapes);
      if (!r.ok) return ack(fail(r.error));
      const prev = inst.media[d.channel];
      inst.media[d.channel] = { channel: d.channel, source: r.source, playing: true, position: 0, at: Date.now(), rev: (prev?.rev ?? 0) + 1, hostPid: p.pid };
      publishMedia(inst, d.channel);
      ack({ ok: true });
    });

    on(socket, 'media:control', MediaControlSchema, 'media', (p, d, ack) => {
      const inst = p.instance as Instance;
      const cur = inst.media[d.channel];
      if (!inst.map.features.includes(d.channel) || !cur) return ack(fail('Nothing is playing.'));
      if (!mayControl(p, inst, d.channel)) return ack(fail('Only the host can do that.'));
      inst.media[d.channel] = applyMedia(cur, d.action, d.position, Date.now());
      publishMedia(inst, d.channel);
      ack({ ok: true });
    });

    on(socket, 'media:state', ChannelSchema, 'any', (p, d, ack) => {
      const inst = p.instance as Instance;
      const m = inst.media[d.channel] ?? null;
      ack({ ok: true, state: m ? { ...m, position: currentPosition(m, Date.now()), at: Date.now() } : null });
    });

    // ------------------------------------------------------------- confession wall

    const publicConfession = (c: { id: string; text: string; ts: number; hearts: number }): Confession => ({ id: c.id, text: c.text, ts: c.ts, hearts: c.hearts });
    const needsWall = (p: Player) => !!p.instance?.map.features.includes('confession');

    on(socket, 'confession:list', null, 'any', async (p, _d, ack) => {
      if (!needsWall(p)) return ack(fail('There is no wall here.'));
      ack({ ok: true, items: (await store.listConfessions(60)).map(publicConfession) });
    });

    on(socket, 'confession:post', ConfessionPostSchema, 'any', async (p, d, ack) => {
      if (!needsWall(p)) return ack(fail('There is no wall here.'));
      const text = sanitizeText(d.text, LIMITS.confessionMax);
      if (text.length < 3) return ack(fail('Write a little more.'));
      if (mod.mutedUntil(p.uid)) return ack(fail('You are muted for a little while.'));
      if (!confessionLimiter.allow(p.uid)) return ack(fail('One at a time. Come back in a minute or two.'));
      const v = mod.checkText(text);
      if (!v.ok || /https?:\/\/|www\./i.test(text)) {
        mod.strike(p.uid);
        return ack(fail('That could not be pinned. No links, and please keep it kind.'));
      }
      const c = { id: randomUUID().slice(0, 12), text, ts: Date.now(), hearts: 0, hidden: false, authorUid: p.uid };
      await store.addConfession(c);
      (io.to('confession') as any).emit('confession:new', publicConfession(c));
      ack({ ok: true });
    });

    on(socket, 'confession:heart', ConfessionIdSchema, 'any', async (p, d, ack) => {
      if (!needsWall(p)) return ack(fail('There is no wall here.'));
      const n = await store.heartConfession(d.id, p.uid);
      if (n === null) return ack(fail('Already hearted.'));
      (io.to('confession') as any).emit('confession:hearts', { id: d.id, hearts: n });
      ack({ ok: true });
    });

    on(socket, 'mod:action', ModActionSchema, 'any', async (p, d, ack) => {
      if (!p.moderator) return ack(fail('Only guides can do that.'));
      const c = await store.getConfession(d.id);
      if (!c) return ack(fail('Not found.'));
      await store.hideConfession(c.id);
      (io.to('confession') as any).emit('confession:removed', { id: c.id });
      if (d.action === 'ban-user') {
        await store.ban(c.authorUid, 'banned via confession review');
        const online = byUid.get(c.authorUid);
        if (online) {
          send(online.sid, 'kicked', { reason: 'This account can no longer join Channel Green.' });
          io.sockets.sockets.get(online.sid)?.disconnect(true);
        }
      }
      ack({ ok: true });
    });

    // ------------------------------------------------------------- voice

    on(socket, 'voice:token', VoiceTokenSchema, 'any', async (p, _d, ack) => {
      const inst = p.instance as Instance;
      const f = features(inst.map.id);
      const proximity = inst.map.voice === 'proximity';
      if (!f.voice) return ack({ ok: true, enabled: false, reason: f.voiceReason ?? 'Voice is off.', proximity });
      const room = livekitRoomName(inst.id);
      const token = await voice.token(room, p.pid, p.name);
      ack({ ok: true, enabled: true, url: cfg.livekit?.url, token, room, proximity });
    });
  });

  // ----------------------------------------------------------------- timers

  const tick = setInterval(() => {
    const nowMs = Date.now();
    for (const inst of world.all()) {
      let rows: [string, number, number, number, number][] | null = null;
      for (const p of inst.players.values()) {
        if (p.actUntil && nowMs >= p.actUntil) {
          // a stretch ends by itself
          p.actUntil = 0;
          p.flags = withoutActivity(p.flags);
          pushState(inst, p);
        }
        if (!p.dirty) continue;
        p.dirty = false;
        (rows ??= []).push([p.pid, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, DIR_INDEX[p.dir], p.flags]);
      }
      if (rows) (io.to(inst.channel).volatile as any).emit('world:state', rows);
    }
  }, TICK_MS);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, pr] of pending) if (pr.req.expiresAt < now) pending.delete(id);
    for (const [k, t] of reqCooldown) if (t < now) reqCooldown.delete(k);
    guestLimiter.sweep();
    joinLimiter.sweep();
    confessionLimiter.sweep();
    mod.sweep();
  }, 30_000);

  const purge = setInterval(() => {
    store.purgeExpired(cfg.confessionTtlDays * 86_400_000).catch(() => {});
  }, 3_600_000);

  for (const t of [tick, sweep, purge]) t.unref();

  return {
    http,
    io,
    world,
    store,
    mod,
    auth,
    listen(port = cfg.port) {
      return new Promise((resolve) => http.listen(port, () => resolve((http.address() as { port: number }).port)));
    },
    close() {
      clearInterval(tick);
      clearInterval(sweep);
      clearInterval(purge);
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

export { AvatarConfigSchema, randomAvatar };
