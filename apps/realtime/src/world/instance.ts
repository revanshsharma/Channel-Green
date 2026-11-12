import { randomInt } from 'node:crypto';
import {
  buildCollisionMap,
  type AvatarConfig,
  type ChatMessage,
  type CollisionMap,
  type Direction,
  type MapDef,
  type MediaChannel,
  type MediaState,
  type PublicPlayer,
  type Registry,
  type RoomInfo,
  type RoomMode,
} from '@channel-green/shared';
import { TokenBucket } from '../safety/rateLimit';
import type { MoveState } from './movement';

export interface Player {
  pid: string;
  sid: string; // socket id
  sub: string;
  uid: string;
  guest: boolean;
  moderator: boolean;
  name: string;
  avatar: AvatarConfig;
  x: number;
  y: number;
  dir: Direction;
  flags: number;
  /** when a timed activity (a stretch) ends by itself; 0 when none is running */
  actUntil: number;
  /** server time of the last accepted move */
  moveT: number;
  dirty: boolean;
  blocks: Set<string>;
  /** silenced by the room host or a guide */
  silenced: boolean;
  joinedAt: number;
  instance: Instance | null;
  buckets: { move: TokenBucket; chat: TokenBucket; req: TokenBucket; emote: TokenBucket; activity: TokenBucket; media: TokenBucket; any: TokenBucket; report: TokenBucket; room: TokenBucket; join: TokenBucket };
  abuse: number;
}

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export class Instance {
  readonly players = new Map<string, Player>();
  hostPid: string | null = null;
  locked = false;
  silenced = false;
  /** uid -> until (ms epoch) */
  readonly bans = new Map<string, number>();
  readonly history: ChatMessage[] = [];
  /** last few lines per author uid, kept only to attach to a report */
  readonly recent = new Map<string, string[]>();
  readonly media: Partial<Record<MediaChannel, MediaState>> = {};
  readonly createdAt = Date.now();

  constructor(
    readonly id: string,
    readonly map: MapDef,
    readonly collision: CollisionMap,
    readonly mode: RoomMode,
    readonly name: string,
    readonly code?: string,
    readonly capacity: number = map.capacity,
  ) {}

  get channel() {
    return `i:${this.id}`;
  }
  get population() {
    return this.players.size;
  }
  get full() {
    return this.players.size >= this.capacity;
  }

  info(): RoomInfo {
    return {
      instanceId: this.id,
      mapId: this.map.id,
      name: this.name,
      mode: this.mode,
      code: this.code,
      hostPid: this.hostPid,
      locked: this.locked,
      silenced: this.silenced,
      population: this.players.size,
      capacity: this.capacity,
    };
  }

  isBanned(uid: string, now = Date.now()): boolean {
    const until = this.bans.get(uid);
    if (until === undefined) return false;
    if (until <= now) {
      this.bans.delete(uid);
      return false;
    }
    return true;
  }

  remember(uid: string, text: string): void {
    const list = this.recent.get(uid) ?? [];
    list.push(text);
    if (list.length > 8) list.shift();
    this.recent.set(uid, list);
  }

  publicPlayer(p: Player): PublicPlayer {
    return {
      pid: p.pid,
      uid: p.uid,
      name: p.name,
      avatar: p.avatar,
      x: p.x,
      y: p.y,
      dir: p.dir,
      flags: p.flags,
      role: p.moderator ? 'guide' : p.pid === this.hostPid ? 'host' : 'player',
    };
  }

  moveState(p: Player): MoveState {
    return { x: p.x, y: p.y, t: p.moveT, seated: (p.flags & 2) !== 0 };
  }
}

export class WorldManager {
  private instances = new Map<string, Instance>();
  private byCodeIdx = new Map<string, Instance>();
  private collisions = new Map<string, CollisionMap>();
  private counters = new Map<string, number>();

  constructor(
    private reg: Registry,
    private privateCapacity = 24,
  ) {}

  mapDef(id: string): MapDef | undefined {
    return this.reg.maps[id];
  }

  private collision(mapId: string): CollisionMap {
    let c = this.collisions.get(mapId);
    if (!c) {
      c = buildCollisionMap(this.reg.maps[mapId], this.reg);
      this.collisions.set(mapId, c);
    }
    return c;
  }

  /** The fullest public copy that still has room, else a fresh one. People who walk in together tend to land together. */
  publicFor(mapId: string): Instance {
    const map = this.reg.maps[mapId];
    if (!map) throw new Error(`unknown map ${mapId}`);
    let best: Instance | null = null;
    for (const i of this.instances.values()) {
      if (i.mode !== 'public' || i.map.id !== mapId || i.full) continue;
      if (!best || i.population > best.population) best = i;
    }
    if (best) return best;
    const n = (this.counters.get(mapId) ?? 0) + 1;
    this.counters.set(mapId, n);
    const inst = new Instance(`${mapId}#${n}`, map, this.collision(mapId), 'public', n === 1 ? map.name : `${map.name} ${n}`);
    this.instances.set(inst.id, inst);
    return inst;
  }

  createPrivate(mapId: string, name: string | undefined): Instance | null {
    const map = this.reg.maps[mapId];
    if (!map || !map.allowPrivate) return null;
    let code = makeCode();
    while (this.byCodeIdx.has(code)) code = makeCode();
    const inst = new Instance(`p-${code}`, map, this.collision(mapId), 'invite', name?.trim() || `${map.name} (private)`, code, Math.min(map.capacity, this.privateCapacity));
    this.instances.set(inst.id, inst);
    this.byCodeIdx.set(code, inst);
    return inst;
  }

  byCode(code: string): Instance | undefined {
    return this.byCodeIdx.get(code.trim().toUpperCase());
  }

  get(id: string): Instance | undefined {
    return this.instances.get(id);
  }

  /** Drops an instance once nobody is in it. */
  releaseIfEmpty(inst: Instance): boolean {
    if (inst.players.size > 0) return false;
    this.instances.delete(inst.id);
    if (inst.code) this.byCodeIdx.delete(inst.code);
    return true;
  }

  all(): IterableIterator<Instance> {
    return this.instances.values();
  }

  stats() {
    let players = 0;
    for (const i of this.instances.values()) players += i.players.size;
    return { instances: this.instances.size, players };
  }

  /** Spawn point (feet, pixels) by name, falling back to something sensible. */
  spawn(inst: Instance, name?: string): [number, number] {
    const s = inst.collision.spawns;
    return s[name ?? ''] ?? s.start ?? s.door ?? Object.values(s)[0] ?? [inst.collision.width / 2, inst.collision.height / 2];
  }
}
