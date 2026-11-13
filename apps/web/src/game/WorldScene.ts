import * as Phaser from 'phaser';
import {
  FLAG_MOVING,
  FLAG_SEATED,
  FRAME_H,
  FRAME_NAMES,
  FRAME_W,
  DIRECTIONS,
  LIE_H,
  LIE_NAMES,
  LIE_W,
  PLAYER_SPEED,
  STRETCH_MS,
  activityOf,
  cupAnchor,
  heldKind,
  lieFrame,
  renderLyingSheet,
  stretchFrame,
  teaFrame,
  type ActivityId,
  type FrameName,
  PAINT_FIRE_GAP_MS,
  paintTargets,
  aimFrom,
  inZone,
  paintZone,
  type Zone,
  VEND_DROP_MS,
  TILE,
  approach,
  findSeat,
  seatedDepth,
  seatedFrame,
  smoothstep,
  type SeatInfo,
  buildCollisionMap,
  canStand,
  portalAt,
  renderAvatarSheet,
  hashString,
  type CollisionMap,
  type Direction,
  type FurnitureDef,
  type JoinOk,
  type MapDef,
  type PublicPlayer,
} from '@channel-green/shared';
import { bufToCanvas, furnitureCanvas, renderGround } from '@/lib/art';
import { registry } from '@/lib/registry';
import type { GameSession, SceneEvent } from './session';
import type { Controls } from './controls';
import { audio } from './audio';
import { PaintFx } from './paintFx';
import { moodFor, type GradeStop, type Mood } from './mood';

type Obj = Phaser.GameObjects.GameObject;

interface Avatar {
  pid: string;
  sprite: Phaser.GameObjects.Sprite;
  name: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Text;
  bubbleUntil: number;
  glyph?: Phaser.GameObjects.Text;
  glyphUntil: number;
  x: number;
  y: number;
  moving: boolean;
  seated: boolean;
  /** 0 standing .. 1 settled in the seat; eased into a pose with smoothstep */
  sitK: number;
  seat: SeatInfo | null;
  glow?: Phaser.GameObjects.Image;
  /** keeps neighbours from breathing in step */
  phase: number;
  dir: Direction;
  texKey: string;
  role: PublicPlayer['role'];
  /** what the look is made of, kept so the lying pictures and the steam anchor can be made from it */
  look: unknown;
  /** the activity being shown, when it began (ms), and how far along getting down or up we are (0 on your feet, 1 lying) */
  act: ActivityId | null;
  actAt: number;
  lieK: number;
  /** which way the head points while lying */
  lieSide: 'left' | 'right';
  lyingShown: boolean;
  steam?: Phaser.GameObjects.Rectangle[];
}

const FONT = '"Pixelify Sans", "Jost", system-ui, sans-serif';
const REACH = 26;
/** seconds to settle into a seat and to get up again */
const SIT_IN = 0.6;
const SIT_OUT = 0.4;
/** pixels the sprite settles into the cushion once seated */
const SIT_SINK = 1;
/** seconds to get down and to get up again when lying */
const LIE_IN = 0.7;
const LIE_OUT = 0.5;
const GLIDE_SPEED = PLAYER_SPEED * 0.55;
const SEAT_PETALS = ['#ffc9a3', '#f3e3b3', '#cdb8ea', '#ff9a6a'];

function travelDir(dx: number, dy: number, fallback: Direction): Direction {
  if (Math.hypot(dx, dy) < 0.5) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export class WorldScene extends Phaser.Scene {
  private session!: GameSession;
  private controls!: Controls;
  private map!: MapDef;
  private col!: CollisionMap;
  private roomObjs: Obj[] = [];
  private avatars = new Map<string, Avatar>();
  private myX = 0;
  private myY = 0;
  private myDir: Direction = 'down';
  private moving = false;
  private seated = false;
  /** where we are still walking to (the server already has us on the seat) */
  private seatGlide: { x: number; y: number; dir: Direction } | null = null;
  /** a small leftover offset that melts away so getting up does not hop */
  private offX = 0;
  private offY = 0;
  private mySitK = 0;
  private myLieK = 0;
  /** what you are doing right now where you stand; the server has the same answer */
  private activity: ActivityId | null = null;
  private anchors = new Map<string, { x: number; y: number } | null>();
  private seatPetals: { r: Phaser.GameObjects.Rectangle; age: number; life: number; ox: number; ph: number }[] = [];
  private lastSend = 0;
  private lastSentMoving = false;
  private seq = 0;
  private portalSince = 0;
  private portalLock = 0;
  private fx: ((t: number, dt: number) => void)[] = [];
  private prompt!: Phaser.GameObjects.Text;
  private unsub: (() => void) | null = null;
  private zoomLevel = 3;
  private nearIndex = -1;
  private nearPortal = '';
  private ready = false;
  private pendingJoin: JoinOk | null = null;
  private reduce = false;
  private paintFx!: PaintFx;
  private zone: Zone | null = null;
  private aimAngle = 0;
  private lastFire = 0;
  private lastTap = -9999;
  private nearVend = false;
  private pointerSeen = false;
  private touchPoint = { x: 0, y: 0 };
  /** pictures of an activity stay hidden until the snack has dropped (ms timestamps by player) */
  private holdUntil = new Map<string, number>();

  constructor() {
    super('world');
  }

  init(data: { session: GameSession; controls: Controls }) {
    this.session = data.session;
    this.controls = data.controls;
  }

  create() {
    this.reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.cameras.main.setBackgroundColor('#0b1f15');
    this.scale.on('resize', () => this.fit());
    this.fit();
    this.prompt = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '8px', color: '#faf5e8', backgroundColor: '#14301fcc', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(99999).setVisible(false);
    this.prompt.setResolution(this.textRes());
    this.paintFx = new PaintFx(this, () => this.reduce, () => this.textRes());
    this.unsub = this.session.onScene((e) => this.onEvent(e));
    this.controls.onAction = () => this.act();
    this.controls.onPaint = (what) => {
      if (!this.ready || !this.map) return;
      if (what === 'toggle') void this.togglePaint();
      else this.fire(this.aimAngle);
    };
    this.controls.onEscape = () => this.session.closeVend();
    this.controls.onActivity = (id) => {
      if (this.ready && this.map && !this.seatGlide) void this.session.doActivity(id);
    };
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Obj[]) => {
      // in the yard a click or tap is a shot, wherever it lands
      if (this.playing()) {
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        const o = aimFrom(this.myX, this.myY);
        this.aimAngle = Math.atan2(w.y - o.y, w.x - o.x);
        this.pointerSeen = true;
        if (p.wasTouch) {
          this.lastTap = this.time.now;
          this.touchPoint = { x: w.x, y: w.y };
        }
        this.fire(this.aimAngle);
        return;
      }
      if (over.length) return;
      this.session.select(null);
      void p;
    });
    this.events.once('shutdown', () => this.cleanup());
    this.ready = true;
    if (process.env.NODE_ENV !== 'production') {
      // development-only hook used by the browser test script; never present in a production build
      (window as unknown as Record<string, unknown>).__cgDev = {
        canStand: (x: number, y: number) => !!this.col && canStand(this.col, x, y),
        size: () => ({ w: this.col?.width ?? 0, h: this.col?.height ?? 0 }),
        pos: () => ({ x: this.myX, y: this.myY }),
        portals: () => this.col?.portals.map((p) => ({ id: p.id, label: p.label, to: p.to, x: p.px.x + p.px.w / 2, y: p.px.y + p.px.h / 2 })) ?? [],
        screen: (x: number, y: number) => {
          const c = this.cameras.main;
          const r = this.game.canvas.getBoundingClientRect();
          const k = r.width / this.scale.width;
          return { x: r.left + (x - c.worldView.x) * c.zoom * k, y: r.top + (y - c.worldView.y) * c.zoom * k };
        },
        yard: () => ({ zone: this.zone, targets: this.map ? paintTargets(this.map) : [], vend: this.map?.objects.filter((o) => o.furniture === 'vending-machine').map((o) => o.at) ?? [] }),
        controls: this.controls,
        session: this.session,
        looks: () => [...this.avatars.values()].map((a) => ({ pid: a.pid, act: a.act, lieK: a.lieK, tex: a.sprite.texture.key, frame: a.sprite.frame.name, steam: a.steam?.filter((r) => r.visible).length ?? 0 })),
      };
    }
    if (!this.pendingJoin && this.session.lastJoin) this.pendingJoin = this.session.lastJoin;
    if (this.pendingJoin) this.loadRoom(this.pendingJoin);
  }

  /** Text is drawn sharper than the pixel grid. The plain canvas fallback (no WebGL) does not scale it back down, so keep it at 1 there. */
  private textRes() {
    return this.game.renderer.type === Phaser.CANVAS ? 1 : this.zoomLevel * 2;
  }

  private cleanup() {
    this.unsub?.();
    this.controls.onAction = null;
    this.controls.onActivity = null;
    this.controls.onPaint = null;
    this.controls.onEscape = null;
    this.paintFx.destroy();
  }

  /** Change what you are doing. Stopping is also told to the server so everyone else sees it end. */
  private setMyActivity(a: ActivityId | null, tell = false) {
    if (this.activity === a) return;
    this.activity = a;
    this.session.setActivity(a);
    if (tell && !a) void this.session.doActivity('none');
  }

  /** Leave room under the HUD (top bar and emote bar) so portal labels and the floor are never hidden behind it. */
  private setCamBounds() {
    if (!this.col) return;
    const small = this.scale.width < 640;
    const top = Math.ceil((small ? 64 : 48) / this.zoomLevel);
    const bottom = Math.ceil((small ? 150 : 70) / this.zoomLevel);
    this.cameras.main.setBounds(0, -top, this.col.width, this.col.height + top + bottom);
  }

  private fit() {
    const w = this.scale.width;
    const h = this.scale.height;
    this.zoomLevel = Math.max(2, Math.min(5, Math.floor(Math.min(w / 300, h / 190))));
    this.cameras.main.setZoom(this.zoomLevel);
    this.setCamBounds();
    if (this.prompt) this.prompt.setResolution(this.textRes());
    for (const a of this.avatars.values()) {
      a.name.setResolution(this.textRes());
      a.bubble?.setResolution(this.textRes());
      a.glyph?.setResolution(this.textRes());
    }
  }

  // ------------------------------------------------------------------ events

  private onEvent(e: SceneEvent) {
    switch (e.type) {
      case 'room':
        if (!this.ready) this.pendingJoin = e.join;
        else this.loadRoom(e.join);
        break;
      case 'join':
        this.addAvatar(e.player);
        break;
      case 'leave':
        this.removeAvatar(e.pid);
        break;
      case 'update': {
        const a = this.avatars.get(e.pid);
        const p = this.session.players.get(e.pid);
        if (a && p) a.role = p.role;
        break;
      }
      case 'say':
        this.showBubble(e.pid, e.text);
        break;
      case 'emote':
        this.showGlyph(e.pid, e.glyph);
        break;
      case 'effect':
        this.showGlyph(e.a, e.kind === 'hug' ? '🫂' : e.kind === 'wave' ? '👋' : '💚');
        this.showGlyph(e.b, e.kind === 'hug' ? '🫂' : e.kind === 'wave' ? '👋' : '💚');
        break;
      case 'wish':
        this.showGlyph(e.pid, '🌠');
        break;
      case 'vend': {
        const o = this.map?.objects[e.object];
        const def = o && registry.furniture[o.furniture];
        if (o && def) this.paintFx.drop(e.item, o.at, def.size);
        this.holdUntil.set(e.pid, this.time.now + VEND_DROP_MS);
        if (e.pid === this.session.me?.pid) this.myDir = 'down';
        break;
      }
      case 'shot': {
        const a = e.shot.victim ? this.avatars.get(e.shot.victim) : undefined;
        this.paintFx.shot(e.shot, a ? { sprite: a.sprite, x: a.x, y: a.y } : null);
        if (e.shot.hit === 'target' && e.shot.pid === this.session.me?.pid) audio().blip('heart');
        break;
      }
      case 'paint':
        break;
      case 'correct':
        this.myX = e.x;
        this.myY = e.y;
        this.seated = false;
        this.seatGlide = null;
        this.session.setSeated(false);
        this.setMyActivity(null, true);
        break;
      case 'activity':
        this.activity = e.activity;
        break;
      case 'seat':
        // a cup of tea comes along to the seat, anything else is put away
        if (this.activity !== 'tea') this.setMyActivity(null);
        this.seated = true;
        if (this.reduce || Math.hypot(e.x - this.myX, e.y - this.myY) < 0.5) {
          this.myX = e.x;
          this.myY = e.y;
          this.myDir = e.dir;
          this.seatGlide = null;
          this.session.setSeated(true);
        } else this.seatGlide = { x: e.x, y: e.y, dir: e.dir };
        break;
    }
  }

  // ------------------------------------------------------------------ room building

  private clearRoom() {
    this.tweens.killAll();
    this.seatPetals = [];
    this.roomObjs.forEach((o) => o.destroy());
    this.roomObjs = [];
    this.avatars.forEach((a) => this.destroyAvatar(a));
    this.avatars.clear();
    this.fx = [];
    this.paintFx?.reset(null);
    this.holdUntil.clear();
  }

  private track<T extends Obj>(o: T): T {
    this.roomObjs.push(o);
    return o;
  }

  private loadRoom(j: JoinOk) {
    this.clearRoom();
    const map = registry.maps[j.map];
    if (!map) return;
    this.map = map;
    this.col = buildCollisionMap(map, registry);
    this.zone = paintZone(map);
    this.paintFx.reset(map);
    const key = `ground:${map.id}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, renderGround(map, registry));
    this.track(this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-100000));

    // furniture, sorted by feet line so players walk behind and in front
    map.objects.forEach((o, i) => {
      const def = registry.furniture[o.furniture];
      if (!def) return;
      const tk = `f:${o.furniture}`;
      if (!this.textures.exists(tk)) {
        const c = furnitureCanvas(registry, o.furniture);
        if (!c) return;
        this.textures.addCanvas(tk, c);
      }
      const img = this.track(this.add.image(o.at[0], o.at[1], tk).setOrigin(0, 0));
      img.setDepth(def.flat ? -50000 + o.at[1] : o.at[1] + def.size[1] + (o.depth ?? 0));
      this.animateFurniture(img, def, i);
      this.paintFx.registerObject(i, img);
      if (def.interaction?.kind === 'vend') {
        // click or tap the machine as well as pressing E
        img.setInteractive({ useHandCursor: true, pixelPerfect: false });
        img.on('pointerdown', () => {
          if (this.nearIndex === i) void this.session.interact(i);
          else this.session.toast('Walk up to the machine first.', 'info');
        });
      }
      if (def.light) this.addLight(o.at[0] + def.light.x, o.at[1] + def.light.y, def);
    });

    const w = this.col.width;
    const h = this.col.height;
    const mood = moodFor(map.id);
    this.applyMood(map.id, mood, w, h);
    for (const e of map.effects) if (!mood.skipEffects?.includes(e.type)) this.addEffect(e.type, e.count ?? 20, e.color);
    this.addMotes(mood, w, h);
    this.addSeatPetals();

    // portal glow so doors can be found
    for (const p of this.col.portals) {
      const g = this.track(this.add.rectangle(p.px.x, p.px.y, p.px.w, p.px.h, 0x9dff6a, 0.12).setOrigin(0, 0).setDepth(-49000));
      if (!this.reduce) this.tweens.add({ targets: g, alpha: 0.28, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      const label = this.track(
        this.add.text(p.px.x + p.px.w / 2, p.px.y + p.px.h / 2, p.label, { fontFamily: FONT, fontSize: '7px', color: '#e8f7cf', stroke: '#0b1f15', strokeThickness: 2 }).setOrigin(0.5).setDepth(89000).setAlpha(0.85),
      );
      label.setResolution(this.textRes());
    }

    this.myX = j.me.x;
    this.myY = j.me.y;
    this.myDir = j.me.dir;
    this.seated = (j.me.flags & FLAG_SEATED) !== 0;
    this.seatGlide = null;
    this.offX = this.offY = 0;
    this.mySitK = 0;
    this.myLieK = 0;
    this.anchors.clear();
    this.activity = activityOf(j.me.flags);
    this.session.setActivity(this.activity);
    this.session.setSeated(this.seated);
    this.moving = false;
    this.portalLock = this.time.now + 1600;
    this.portalSince = 0;

    this.avatarFor(j.me);
    this.addAvatar(j.me, true);
    for (const p of j.players) this.addAvatar(p);

    const cam = this.cameras.main;
    this.setCamBounds();
    cam.centerOn(this.myX, this.myY - 12);
    const me = this.avatars.get(j.me.pid);
    if (me) cam.startFollow(me.sprite, true, 0.12, 0.12);
    cam.setRoundPixels(true);
  }

  private animateFurniture(img: Phaser.GameObjects.Image, def: FurnitureDef, i: number) {
    if (this.reduce && def.anim !== 'tv') return;
    switch (def.anim) {
      case 'sway':
        img.setOrigin(0.5, 1).setPosition(img.x + def.size[0] / 2, img.y + def.size[1]);
        this.tweens.add({ targets: img, angle: { from: -1.4, to: 1.4 }, duration: 2600 + (i % 5) * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        break;
      case 'flicker':
      case 'glow':
        this.tweens.add({ targets: img, alpha: { from: 1, to: 0.82 }, duration: 900 + (i % 4) * 250, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        break;
      case 'bob':
        this.tweens.add({ targets: img, y: img.y - 1, duration: 1400 + (i % 3) * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        break;
      case 'tv': {
        const colors = [0xffffff, 0xcfe0ff, 0xfff0d0, 0xd8ffe0];
        let n = 0;
        this.fx.push((t) => {
          if (Math.floor(t / 450) !== n) {
            n = Math.floor(t / 450);
            img.setTint(colors[n % colors.length]);
          }
        });
        break;
      }
      default:
        break;
    }
  }

  private lightTex(radius: number, color: string): string {
    const key = `light:${radius}:${color}`;
    if (!this.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = c.height = radius * 2;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
      g.addColorStop(0, color + 'ff');
      g.addColorStop(0.4, color + '66');
      g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, radius * 2, radius * 2);
      this.textures.addCanvas(key, c);
    }
    return key;
  }

  private addLight(x: number, y: number, def: FurnitureDef) {
    const l = def.light;
    if (!l) return;
    const img = this.track(this.add.image(x, y, this.lightTex(Math.round(l.radius), l.color)).setBlendMode(Phaser.BlendModes.ADD).setDepth(90001));
    const base = l.intensity * 0.7;
    img.setAlpha(base);
    if (this.reduce) return;
    if (l.flicker) this.tweens.add({ targets: img, alpha: base * (1 - l.flicker * 2), duration: 170 + Math.random() * 200, yoyo: true, repeat: -1 });
    else this.tweens.add({ targets: img, alpha: base * 0.9, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  private addEffect(type: string, count: number, color?: string) {
    const W = this.col.width;
    const H = this.col.height;
    const col = color ? Phaser.Display.Color.HexStringToColor(color).color : undefined;
    const n = Math.min(count, 80);
    const items = Array.from({ length: n }, () => {
      const size = type === 'rain' ? 1 : type === 'stars' ? 1 : 2;
      const r = this.track(this.add.rectangle(Math.random() * W, Math.random() * H, size, type === 'rain' ? 4 : size, col ?? 0xffffff, 0.8).setDepth(90002));
      return { r, ph: Math.random() * 10, sp: 0.5 + Math.random(), x: r.x, y: r.y };
    });
    const colors: Record<string, number> = { fireflies: 0xd9ff9a, leaves: 0xc9683a, stars: 0xfff4c8, rain: 0xa8c8ff, dust: 0xfaf5e8, smoke: 0xb8b8b0, lanterns: 0xffb060, petals: 0xffc0d0, snow: 0xffffff };
    items.forEach((it) => it.r.setFillStyle(col ?? colors[type] ?? 0xffffff));
    this.fx.push((t, dt) => {
      const s = dt / 1000;
      for (const it of items) {
        const r = it.r;
        switch (type) {
          case 'fireflies':
            it.x += Math.sin(t / 900 + it.ph) * 8 * s;
            it.y += Math.cos(t / 1100 + it.ph) * 6 * s;
            r.setAlpha(0.2 + 0.8 * Math.max(0, Math.sin(t / 500 + it.ph)));
            break;
          case 'leaves':
          case 'petals':
            it.y += 9 * it.sp * s;
            it.x += Math.sin(t / 700 + it.ph) * 12 * s;
            if (it.y > H) it.y = -4;
            break;
          case 'rain':
            it.y += 120 * it.sp * s;
            it.x -= 12 * s;
            if (it.y > H) {
              it.y = -6;
              it.x = Math.random() * W;
            }
            r.setAlpha(0.35);
            break;
          case 'snow':
            it.y += 14 * it.sp * s;
            it.x += Math.sin(t / 900 + it.ph) * 6 * s;
            if (it.y > H) it.y = -4;
            break;
          case 'stars':
            r.setAlpha(0.25 + 0.75 * Math.abs(Math.sin(t / 900 + it.ph)));
            break;
          case 'smoke':
          case 'lanterns':
            it.y -= 5 * it.sp * s;
            it.x += Math.sin(t / 1000 + it.ph) * 4 * s;
            if (it.y < -4) it.y = H;
            r.setAlpha(type === 'lanterns' ? 0.55 + 0.3 * Math.sin(t / 400 + it.ph) : 0.2);
            break;
          default:
            it.x += Math.sin(t / 1400 + it.ph) * 3 * s;
            it.y += Math.cos(t / 1700 + it.ph) * 2 * s;
            r.setAlpha(0.15 + 0.2 * Math.sin(t / 800 + it.ph));
        }
        r.setPosition(it.x, it.y);
      }
    });
  }

  // ------------------------------------------------------------------ mood (dusk grade, lamp pools, drifting specks)

  private gradeTex(key: string, w: number, h: number, stops: GradeStop[]): string {
    if (!this.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = Math.max(2, Math.round(h));
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 0, c.height);
      for (const [o, col, a] of stops) {
        const r = parseInt(col.slice(1, 3), 16);
        const gr = parseInt(col.slice(3, 5), 16);
        const b = parseInt(col.slice(5, 7), 16);
        g.addColorStop(o, `rgba(${r},${gr},${b},${a})`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, c.height);
      this.textures.addCanvas(key, c);
    }
    void w;
    return key;
  }

  private applyMood(id: string, mood: Mood, w: number, h: number) {
    const day = this.track(this.add.image(0, 0, this.gradeTex(`grade:${id}`, w, h, mood.grade)).setOrigin(0, 0).setDisplaySize(w, h).setDepth(90000));
    let night: Phaser.GameObjects.Image | null = null;
    if (mood.sunset) {
      night = this.track(this.add.image(0, 0, this.gradeTex(`grade:${id}:night`, w, h, mood.sunset.night)).setOrigin(0, 0).setDisplaySize(w, h).setDepth(90000).setAlpha(this.reduce ? 0.35 : 0));
      const stars = Array.from({ length: mood.sunset.stars }, () => {
        const r = this.track(this.add.rectangle(Math.random() * w, Math.random() * h * 0.7, 1, 1, 0xfff4c8, 0).setDepth(90003));
        return { r, ph: Math.random() * 10 };
      });
      const cycle = { t: this.reduce ? 0.35 : 0 };
      if (!this.reduce) this.tweens.add({ targets: cycle, t: 1, duration: 150000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.fx.push((t) => {
        night?.setAlpha(cycle.t);
        day.setAlpha(1 - cycle.t * 0.55);
        for (const s of stars) s.r.setAlpha(cycle.t * (this.reduce ? 0.7 : 0.25 + 0.75 * Math.abs(Math.sin(t / 900 + s.ph))));
      });
    }
    for (const g of mood.glows ?? []) {
      const img = this.track(this.add.image(g.x, g.y, this.lightTex(g.r, g.color)).setBlendMode(Phaser.BlendModes.ADD).setDepth(90001).setAlpha(g.alpha));
      if (g.breathe && !this.reduce) this.tweens.add({ targets: img, alpha: g.alpha * 0.72, duration: 2600 + Math.random() * 1800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
  }

  private addMotes(mood: Mood, W: number, H: number) {
    for (const m of mood.motes ?? []) {
      const col = Phaser.Display.Color.HexStringToColor(m.color).color;
      const n = Math.min(m.count, 40);
      const items = Array.from({ length: n }, () => {
        const size = m.type === 'dust' ? 1 : 2;
        const r = this.track(this.add.rectangle(Math.random() * W, Math.random() * H, size, size, col, 0.5).setDepth(90004));
        return { r, x: r.x, y: r.y, ph: Math.random() * 10, sp: 0.4 + Math.random() };
      });
      if (this.reduce) {
        items.forEach((it) => it.r.setAlpha(m.type === 'dust' ? 0.25 : 0.5));
        continue;
      }
      this.fx.push((t, dt) => {
        const s = dt / 1000;
        for (const it of items) {
          switch (m.type) {
            case 'fireflies':
              it.x += Math.sin(t / 1300 + it.ph) * 7 * s;
              it.y += Math.cos(t / 1700 + it.ph) * 5 * s;
              it.r.setAlpha(0.1 + 0.8 * Math.max(0, Math.sin(t / 700 + it.ph)));
              break;
            case 'embers':
              it.y -= 6 * it.sp * s;
              it.x += Math.sin(t / 900 + it.ph) * 4 * s;
              if (it.y < -4) it.y = H;
              it.r.setAlpha(0.3 + 0.5 * Math.abs(Math.sin(t / 500 + it.ph)));
              break;
            case 'pollen':
              it.x += (3 + Math.sin(t / 2000 + it.ph) * 3) * it.sp * s;
              it.y += Math.cos(t / 1800 + it.ph) * 2.5 * s;
              if (it.x > W + 4) it.x = -4;
              it.r.setAlpha(0.25 + 0.4 * Math.abs(Math.sin(t / 1100 + it.ph)));
              break;
            default:
              it.x += (1.5 + Math.sin(t / 2600 + it.ph) * 2) * it.sp * s;
              it.y += Math.cos(t / 3100 + it.ph) * 1.8 * s;
              if (it.x > W + 4) it.x = -4;
              it.r.setAlpha(0.12 + 0.22 * Math.abs(Math.sin(t / 1500 + it.ph)));
          }
          it.r.setPosition(it.x, it.y);
        }
      });
    }
  }

  /** A few warm specks that drift up around you while you sit. Not made at all when motion is reduced. */
  private addSeatPetals() {
    this.seatPetals = [];
    if (this.reduce) return;
    for (let i = 0; i < 12; i++) {
      const col = Phaser.Display.Color.HexStringToColor(SEAT_PETALS[i % SEAT_PETALS.length]).color;
      const r = this.track(this.add.rectangle(0, 0, i % 3 === 0 ? 1 : 2, i % 3 === 0 ? 1 : 2, col, 0).setDepth(90005).setVisible(false));
      this.seatPetals.push({ r, age: Math.random(), life: 1, ox: (Math.random() - 0.5) * 70, ph: Math.random() * 10 });
    }
    this.fx.push((t, dt) => {
      const me = this.session.me && this.avatars.get(this.session.me.pid);
      const k = this.mySitK;
      for (const p of this.seatPetals) {
        if (!me || k <= 0.02) {
          p.r.setVisible(false);
          continue;
        }
        p.age += (dt / 1000) / (9 + (p.ph % 4));
        if (p.age >= 1) {
          p.age = 0;
          p.ox = (Math.random() - 0.5) * 70;
        }
        const rise = p.age * 46;
        p.r.setVisible(true);
        p.r.setPosition(me.x + p.ox + Math.sin(t / 1700 + p.ph) * 4, me.y - 4 - rise);
        p.r.setAlpha(Math.sin(Math.PI * p.age) * 0.5 * k);
      }
    });
  }

  // ------------------------------------------------------------------ avatars

  /** One texture per distinct look; frames are named like "down-walk2". */
  private avatarFor(p: PublicPlayer): string {
    const key = `av:${hashString(JSON.stringify(p.avatar)).toString(36)}`;
    if (!this.textures.exists(key)) {
      const sheet = bufToCanvas(renderAvatarSheet(p.avatar, registry.avatar));
      const tex = this.textures.addCanvas(key, sheet);
      if (tex) {
        DIRECTIONS.forEach((d, r) => FRAME_NAMES.forEach((n, c) => tex.add(`${d}-${n}`, 0, c * FRAME_W, r * FRAME_H, FRAME_W, FRAME_H)));
      }
    }
    return key;
  }

  /** The lying pictures of one look, made the first time someone lies down. */
  private lieFor(texKey: string, look: unknown): string {
    const key = `lie:${texKey}`;
    if (!this.textures.exists(key)) {
      const tex = this.textures.addCanvas(key, bufToCanvas(renderLyingSheet(look, registry.avatar)));
      if (tex) (['left', 'right'] as const).forEach((d, r) => LIE_NAMES.forEach((n, c) => tex.add(`${d}-${n}`, 0, c * LIE_W, r * LIE_H, LIE_W, LIE_H)));
    }
    return key;
  }

  private addAvatar(p: PublicPlayer, isMe = false) {
    if (this.avatars.has(p.pid) || !this.map) return;
    const texKey = this.avatarFor(p);
    const sprite = this.add.sprite(p.x, p.y, texKey, `${p.dir}-idle0`).setOrigin(0.5, 1 - 1 / FRAME_H);
    if (!isMe) {
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => {
        if (!this.playing()) this.session.select(p.pid);
      });
    }
    const name = this.add
      .text(p.x, p.y - FRAME_H - 1, p.name, { fontFamily: FONT, fontSize: '7px', color: isMe ? '#9dff6a' : '#faf5e8', stroke: '#0b1f15', strokeThickness: 2 })
      .setOrigin(0.5, 1);
    name.setResolution(this.textRes());
    this.roomObjs.push(sprite, name);
    this.avatars.set(p.pid, {
      pid: p.pid,
      sprite,
      name,
      bubbleUntil: 0,
      glyphUntil: 0,
      x: p.x,
      y: p.y,
      moving: false,
      seated: (p.flags & FLAG_SEATED) !== 0,
      sitK: (p.flags & FLAG_SEATED) !== 0 ? 1 : 0,
      seat: (p.flags & FLAG_SEATED) !== 0 ? findSeat(this.map, registry.furniture, p.x, p.y) : null,
      phase: hashString(p.pid) % 9000,
      dir: p.dir,
      texKey,
      role: p.role,
      look: p.avatar,
      act: null,
      actAt: 0,
      lieK: 0,
      lieSide: p.dir === 'right' ? 'right' : 'left',
      lyingShown: false,
    });
  }

  private destroyAvatar(a: Avatar) {
    a.sprite.destroy();
    a.name.destroy();
    a.bubble?.destroy();
    a.glyph?.destroy();
    a.glow?.destroy();
    a.steam?.forEach((r) => r.destroy());
    this.paintFx.forget(a.pid);
  }

  private removeAvatar(pid: string) {
    const a = this.avatars.get(pid);
    if (!a) return;
    this.destroyAvatar(a);
    this.avatars.delete(pid);
  }

  private showBubble(pid: string, text: string) {
    const a = this.avatars.get(pid);
    if (!a) return;
    a.bubble?.destroy();
    const short = text.length > 64 ? text.slice(0, 61) + '...' : text;
    a.bubble = this.add
      .text(a.x, a.y - FRAME_H - 9, short, { fontFamily: FONT, fontSize: '7px', color: '#2a1d1a', backgroundColor: '#faf5e8', padding: { x: 3, y: 2 }, wordWrap: { width: 96 }, align: 'center' })
      .setOrigin(0.5, 1)
      .setDepth(95000);
    a.bubble.setResolution(this.textRes());
    a.bubbleUntil = this.time.now + 4500 + short.length * 40;
  }

  private showGlyph(pid: string, glyph: string) {
    const a = this.avatars.get(pid);
    if (!a) return;
    a.glyph?.destroy();
    a.glyph = this.add.text(a.x, a.y - FRAME_H - 4, glyph, { fontFamily: FONT, fontSize: '12px' }).setOrigin(0.5, 1).setDepth(95001);
    a.glyph.setResolution(this.textRes());
    a.glyphUntil = this.time.now + 2200;
  }

  // ------------------------------------------------------------------ interaction

  private nearestObject(): { index: number; label: string; sit: boolean } | null {
    let best = -1;
    let bestD = REACH;
    let label = '';
    let sit = false;
    this.map.objects.forEach((o, i) => {
      const def = registry.furniture[o.furniture];
      if (!def?.interaction) return;
      const x0 = o.at[0];
      const y0 = o.at[1];
      const dx = Math.max(x0 - this.myX, 0, this.myX - (x0 + def.size[0]));
      const dy = Math.max(y0 - this.myY, 0, this.myY - (y0 + def.size[1]));
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = i;
        sit = def.interaction.kind === 'sit';
        label = o.label ?? def.prompt ?? (sit ? 'Sit' : def.name);
      }
    });
    return best >= 0 ? { index: best, label, sit } : null;
  }

  act() {
    if (!this.ready || !this.map) return;
    if (this.activity === 'lie') {
      this.setMyActivity(null, true);
      return;
    }
    if (this.seated) {
      if (!this.seatGlide) this.standUp(...this.facingVector());
      return;
    }
    if (this.nearPortal) void this.session.usePortal(this.nearPortal);
    else if (this.nearIndex >= 0) void this.session.interact(this.nearIndex);
  }

  // ------------------------------------------------------------------ paint yard

  /** True while you have joined the yard and stand on its boards. */
  private playing(): boolean {
    return !!this.session.me?.paint && inZone(this.zone, this.myX, this.myY);
  }

  async togglePaint() {
    const s = this.session;
    if (s.me?.paint) await s.paintLeave();
    else if (!this.zone) s.toast('There is no paint yard here. Look for the Paint Yard door in the town square.', 'info');
    else if (!inZone(this.zone, this.myX, this.myY)) s.toast('Step onto the yard boards, then press P to join.', 'info');
    else if (this.seated) s.toast('Stand up first.', 'info');
    else await s.paintJoin();
  }

  private fire(angle: number) {
    if (!this.playing()) return;
    const now = this.time.now;
    if (now - this.lastFire < PAINT_FIRE_GAP_MS) return;
    this.lastFire = now;
    void this.session.paintFire(angle);
  }

  /** Aim line, crosshair and the cursor, every frame. */
  private updatePaint(time: number) {
    const inYard = inZone(this.zone, this.myX, this.myY);
    this.session.setInYard(inYard);
    const me = this.session.me;
    const on = !!me?.paint && inYard && !this.seated;
    const ptr = this.input.activePointer;
    const touch = ptr.wasTouch;
    const o = aimFrom(this.myX, this.myY);
    let point: { x: number; y: number } | null = null;
    if (on && (!touch || time - this.lastTap < 2500) && (touch ? true : this.pointerSeen)) {
      const w = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      point = touch ? this.touchPoint : { x: w.x, y: w.y };
      if (!touch) this.aimAngle = Math.atan2(w.y - o.y, w.x - o.x);
    } else if (on && !touch && !this.pointerSeen) {
      this.aimAngle = this.myDir === 'left' ? Math.PI : this.myDir === 'up' ? -Math.PI / 2 : this.myDir === 'down' ? Math.PI / 2 : 0;
    }
    if (on && touch && point === null && time - this.lastTap >= 2500) {
      // nothing tapped lately: keep the line short and quiet by hiding it
    }
    const others: { pid: string; x: number; y: number }[] = [];
    for (const a of this.avatars.values()) if (a.pid !== me?.pid && this.session.players.get(a.pid)?.paint) others.push({ pid: a.pid, x: a.x, y: a.y });
    const show = on && (!touch || time - this.lastTap < 2500);
    if (this.col) this.paintFx.drawAim(show, me?.paint?.c ?? 0, { x: this.myX, y: this.myY }, this.aimAngle, show ? point : null, this.col, others, time);
    this.input.setDefaultCursor(on && !touch ? 'crosshair' : '');
    // the vending menu closes when you walk away from the machine
    if (this.session.getSnapshot().vendOpen && !this.nearVend) this.session.closeVend();
  }

  /** The way you are looking, as a step; getting up goes that way first. */
  private facingVector(): [number, number] {
    return this.myDir === 'left' ? [-1, 0] : this.myDir === 'right' ? [1, 0] : this.myDir === 'up' ? [0, -1] : [0, 1];
  }

  /** Called from the on-screen action button. */
  actionButton() {
    this.act();
  }

  // ------------------------------------------------------------------ frame loop

  update(time: number, delta: number) {
    if (!this.ready || !this.map) return;
    // Movement is integrated in fixed slices from real elapsed time, so speed does not depend on the frame rate
    // (a slow phone covers the same distance per second as a fast desktop; the cap only stops a tab that was asleep from jumping).
    let left = Math.min(delta, 250) / 1000;
    while (left > 0) {
      const slice = Math.min(left, 1 / 60);
      this.stepMe(slice, time);
      left -= slice;
    }
    this.stepAvatars(time, Math.min(delta, 250) / 1000);
    this.fx.forEach((f) => f(time, delta));
    this.updatePaint(time);

    // prompts: doors first, then things
    const portal = portalAt(this.col, this.myX, this.myY);
    const near = this.seated ? null : this.nearestObject();
    this.nearIndex = near?.index ?? -1;
    this.nearVend = !!near && registry.furniture[this.map.objects[near.index].furniture]?.interaction?.kind === 'vend';
    const pad = this.col.portals.find((p) => Math.hypot(p.px.x + p.px.w / 2 - this.myX, p.px.y + p.px.h / 2 - this.myY) < 22);
    this.nearPortal = pad?.id ?? '';
    const lying = this.activity === 'lie';
    const standing = lying || (this.seated && !this.seatGlide && this.mySitK >= 1);
    const label = lying ? 'Get up' : standing ? 'Stand up' : this.seated ? '' : pad ? `Go to ${pad.label}` : near?.label ?? '';
    const kind = standing ? 'stand' : pad ? 'portal' : near?.sit ? 'sit' : 'object';
    this.session.setNearby(label ? { label, kind } : null);
    if (label) {
      const lift = lying ? LIE_H + 10 - FRAME_H : this.seated ? 8 : 14;
      this.prompt.setText(`E  ${label}`).setPosition(Math.round(this.myX + this.offX), Math.round(this.myY + this.offY) - FRAME_H - lift).setVisible(true);
      this.prompt.setAlpha(this.seated ? 0.7 : 1);
    } else this.prompt.setVisible(false);

    // stepping onto a door walks through it
    if (portal && time > this.portalLock) {
      if (!this.portalSince) this.portalSince = time;
      else if (time - this.portalSince > 220) {
        this.portalLock = time + 2500;
        this.portalSince = 0;
        void this.session.usePortal(portal.id);
      }
    } else this.portalSince = 0;
  }

  private stepMe(dt: number, time: number) {
    const v = this.controls.vector();
    let dx = v.x;
    let dy = v.y;
    const wants = dx !== 0 || dy !== 0;
    // walking away ends tea, a stretch or a rest; while getting up from the ground you wait for your feet
    if (wants && this.activity) this.setMyActivity(null, true);
    if (this.myLieK > 0.02) {
      this.moving = false;
      this.syncMe();
      return;
    }
    if (this.seatGlide) {
      if (wants) {
        // you changed your mind on the way: land on the seat and get up from there
        this.myX = this.seatGlide.x;
        this.myY = this.seatGlide.y;
        this.myDir = this.seatGlide.dir;
        this.seatGlide = null;
        this.session.setSeated(true);
      } else {
        const g = this.seatGlide;
        const gx = g.x - this.myX;
        const gy = g.y - this.myY;
        const dist = Math.hypot(gx, gy);
        const step = GLIDE_SPEED * dt;
        if (dist <= step) {
          this.myX = g.x;
          this.myY = g.y;
          this.myDir = g.dir;
          this.seatGlide = null;
          this.moving = false;
          this.session.setSeated(true);
        } else {
          this.myX += (gx / dist) * step;
          this.myY += (gy / dist) * step;
          this.myDir = travelDir(gx, gy, this.myDir);
          this.moving = true;
        }
        this.syncMe();
        return;
      }
    }
    if (this.seated && wants) this.standUp(dx, dy);
    if (!this.seated && wants) {
      const len = Math.hypot(dx, dy) || 1;
      dx = (dx / len) * PLAYER_SPEED * dt;
      dy = (dy / len) * PLAYER_SPEED * dt;
      let moved = false;
      if (dx !== 0 && canStand(this.col, this.myX + dx, this.myY)) {
        this.myX += dx;
        moved = true;
      }
      if (dy !== 0 && canStand(this.col, this.myX, this.myY + dy)) {
        this.myY += dy;
        moved = true;
      }
      if (Math.abs(v.x) >= Math.abs(v.y) && v.x !== 0) this.myDir = v.x > 0 ? 'right' : 'left';
      else if (v.y !== 0) this.myDir = v.y > 0 ? 'down' : 'up';
      this.moving = moved;
    } else if (!this.seated) this.moving = false;

    const changed = this.moving !== this.lastSentMoving;
    if (!this.seated && (this.moving ? time - this.lastSend > 66 : changed)) {
      this.lastSend = time;
      this.lastSentMoving = this.moving;
      this.session.move(this.myX, this.myY, this.myDir, this.moving, ++this.seq);
    }
    this.syncMe();
  }

  private syncMe() {
    const me = this.session.me;
    if (!me) return;
    const a = this.avatars.get(me.pid);
    if (!a) return;
    // the little offset left over from getting up melts away instead of hopping
    if (this.reduce) this.offX = this.offY = 0;
    else {
      const f = Math.exp(-(1 / 60) * 9);
      this.offX *= f;
      this.offY *= f;
      if (Math.hypot(this.offX, this.offY) < 0.3) this.offX = this.offY = 0;
    }
    const sliding = Math.hypot(this.offX, this.offY) > 1.2;
    a.x = this.myX + this.offX;
    a.y = this.myY + this.offY;
    a.dir = this.myDir;
    a.moving = this.moving || sliding;
    a.seated = this.seated;
  }

  private standUp(dx: number, dy: number) {
    const tries: [number, number][] = [];
    for (const dist of [6, 10, 14, 18, 22]) {
      tries.push([Math.sign(dx) * dist, Math.sign(dy) * dist], [Math.sign(dx) * dist, 0], [0, Math.sign(dy) * dist], [0, dist], [dist, 0], [-dist, 0], [0, -dist]);
    }
    for (const [ox, oy] of tries) {
      if ((ox || oy) && canStand(this.col, this.myX + ox, this.myY + oy)) {
        this.myX += ox;
        this.myY += oy;
        this.offX = -ox;
        this.offY = -oy;
        this.seated = false;
        this.session.setSeated(false);
        this.setMyActivity(null);
        this.session.move(this.myX, this.myY, this.myDir, false, ++this.seq);
        return;
      }
    }
  }

  private stepAvatars(time: number, dt: number) {
    // frame-rate independent easing toward the last server position (about 28% per frame at 60 fps)
    const ease = 1 - Math.exp(-dt * 19.7);
    const myPid = this.session.me?.pid;
    for (const a of this.avatars.values()) {
      const mine = a.pid === myPid;
      let gliding = mine && !!this.seatGlide;
      let theirAct: ActivityId | null = null;
      if (!mine) {
        const p = this.session.players.get(a.pid);
        if (p) {
          const seatedNow = (p.flags & FLAG_SEATED) !== 0;
          const dx = p.x - a.x;
          const dy = p.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (seatedNow && dist > 0.5 && dist <= 80 && !this.reduce) {
            // walking over to the seat: a steady glide rather than a snap
            gliding = true;
            const step = approach(0, dist, 0.1, GLIDE_SPEED * dt);
            a.x += (dx / dist) * step;
            a.y += (dy / dist) * step;
            a.dir = travelDir(dx, dy, p.dir);
          } else {
            if (dist > 80 || (seatedNow && this.reduce)) {
              a.x = p.x;
              a.y = p.y;
            } else {
              a.x += dx * ease;
              a.y += dy * ease;
            }
            a.dir = p.dir;
          }
          a.moving = gliding || (p.flags & FLAG_MOVING) !== 0 || dist > 0.6;
          theirAct = activityOf(p.flags);
          if (seatedNow && !a.seated) a.seat = null;
          a.seated = seatedNow;
          a.role = p.role;
          if (seatedNow && !a.seat) a.seat = findSeat(this.map, registry.furniture, p.x, p.y);
        }
      } else if (this.seated && !a.seat) a.seat = findSeat(this.map, registry.furniture, this.seatGlide?.x ?? this.myX, this.seatGlide?.y ?? this.myY);

      // what they are doing: yours is known here, theirs comes with their position
      const act0 = mine ? this.activity : theirAct;
      const act = (this.holdUntil.get(a.pid) ?? 0) > time ? null : act0;
      // a snack or a drink is finished after a while; the server has already put it away
      if (act !== a.act) {
        a.act = act;
        a.actAt = time;
        if (act === 'lie') a.lieSide = a.dir === 'right' ? 'right' : 'left';
      }
      if (mine && act === 'stretch' && time - a.actAt > STRETCH_MS + 150) this.setMyActivity(null);
      if (mine && heldKind(act) && heldKind(act) !== 'tea' && time - a.actAt > (heldKind(act) === 'snack' ? 30_000 : 45_000)) this.setMyActivity(null);
      const wantLie = act === 'lie' && !a.seated && !a.moving && !gliding;
      if (this.reduce) a.lieK = wantLie ? 1 : 0;
      else a.lieK = Math.min(1, Math.max(0, a.lieK + (wantLie ? dt / LIE_IN : -dt / LIE_OUT)));
      if (mine) this.myLieK = a.lieK;
      const lk = smoothstep(a.lieK);
      const lyingNow = a.lieK >= 0.55;

      // sit/stand ramp: slow in, a touch quicker out; nothing eased when motion is reduced
      const want = a.seated && !gliding ? 1 : 0;
      if (this.reduce) a.sitK = want;
      else a.sitK = Math.min(1, Math.max(0, a.sitK + (want ? dt / SIT_IN : -dt / SIT_OUT)));
      if (a.sitK === 0 && !a.seated) a.seat = null;
      if (mine) this.mySitK = a.sitK;
      const e = smoothstep(a.sitK);

      let frame: string;
      if (a.lieK > 0) frame = 'sit0';
      else if (a.sitK >= 0.5) frame = a.sitK >= 1 ? (heldKind(a.act) && !a.moving ? teaFrame(time, a.phase, this.reduce, true, a.act) : seatedFrame(time, a.phase, this.reduce)) : 'sit0';
      else if (a.moving) frame = `walk${Math.floor(time / 125) % 4}`;
      else if (heldKind(a.act)) frame = teaFrame(time, a.phase, this.reduce, false, a.act);
      else if (a.act === 'stretch') frame = stretchFrame(time - a.actAt, this.reduce);
      else frame = `idle${Math.floor(time / 600) % 2}`;
      const x = Math.round(a.x);
      const y = Math.round(a.y);
      // sink onto the cushion; a one pixel dip halfway through gives the settle
      const dip = this.reduce ? 0 : Math.sin(Math.PI * e) * 1.4;
      const sy = y + Math.round(e * SIT_SINK + dip) + Math.round(lk * 2);
      const depth = a.sitK > 0 ? seatedDepth(a.seat, y) : y;
      if (lyingNow) {
        // flat on the ground: the sideways pictures, head toward the side you were facing
        if (!a.lyingShown) {
          a.lyingShown = true;
          a.sprite.setTexture(this.lieFor(a.texKey, a.look)).setOrigin(0.5, 1);
        }
        a.sprite.setFrame(`${a.lieSide}-${lieFrame(time, a.phase, this.reduce)}`).setPosition(x, y + 1).setDepth(depth);
        const hit = a.sprite.input?.hitArea as Phaser.Geom.Rectangle | undefined;
        hit?.setSize(a.sprite.width, a.sprite.height);
      } else {
        if (a.lyingShown) {
          a.lyingShown = false;
          a.sprite.setTexture(a.texKey).setOrigin(0.5, 1 - 1 / FRAME_H);
          const hit = a.sprite.input?.hitArea as Phaser.Geom.Rectangle | undefined;
          hit?.setSize(FRAME_W, FRAME_H);
        }
        a.sprite.setPosition(x, sy).setFrame(`${a.dir}-${frame}`).setDepth(depth);
      }
      this.updateSteam(a, time, x, sy, frame, depth);
      this.updateHeld(a, x, sy, frame, depth);
      const p0 = mine ? this.session.me?.paint : this.session.players.get(a.pid)?.paint;
      this.paintFx.person(a.pid, x, y, depth, a.dir, p0, mine && p0 && this.playing() ? this.aimAngle : null, time);

      // a warm pool of light under whoever is sitting
      if (a.sitK > 0 && !a.glow) {
        a.glow = this.add.image(x, y, this.seatGlowTexture()).setBlendMode(Phaser.BlendModes.ADD);
      }
      if (a.glow) {
        if (a.sitK <= 0) {
          a.glow.destroy();
          a.glow = undefined;
        } else {
          const breathe = this.reduce ? 0 : Math.sin((time + a.phase) / 2600) * 0.04;
          a.glow.setPosition(x, y - 6).setDepth(depth - 0.25).setAlpha((0.2 + breathe) * e);
        }
      }

      // the sitting picture is shorter, so the name and bubbles come down with it
      const standTop = y - FRAME_H + Math.round(e * 5);
      const top = Math.round(standTop + (y - LIE_H - 1 - standTop) * lk);
      a.name.setPosition(x, top - 1).setDepth(a.seat ? Math.max(depth, a.seat.furnitureDepth) + 1 : y + 1);
      if (a.role !== 'player') a.name.setColor(a.role === 'guide' ? '#e8955a' : '#f1e3c1');
      if (a.bubble) {
        if (time > a.bubbleUntil) {
          a.bubble.destroy();
          a.bubble = undefined;
        } else a.bubble.setPosition(x, top - 9);
      }
      if (a.glyph) {
        if (time > a.glyphUntil) {
          a.glyph.destroy();
          a.glyph = undefined;
        } else {
          const rise = (1 - (a.glyphUntil - time) / 2200) * 8;
          a.glyph.setPosition(x, top - 4 - rise);
        }
      }
    }
  }

  /** A snack or a can in someone's hands, where the cup would be. */
  private updateHeld(a: Avatar, x: number, y: number, frame: string, depth: number) {
    const kind = heldKind(a.act);
    let at: { x: number; y: number } | null = null;
    if (kind && kind !== 'tea' && !a.lyingShown && (frame.startsWith('cup') || frame.startsWith('scup'))) {
      const key = `${a.texKey}|${frame}|${a.dir}`;
      if (!this.anchors.has(key)) this.anchors.set(key, cupAnchor(a.look, registry.avatar, frame as FrameName, a.dir));
      const an = this.anchors.get(key);
      if (an) at = { x: Math.round(x - FRAME_W / 2 + an.x), y: Math.round(y - (FRAME_H - 1) + an.y) };
    }
    this.paintFx.holding(a.pid, a.act, at, depth);
  }

  /** Little wisps of steam over a cup, so a sip of tea can be seen from across the room. Still pictures only when motion is reduced. */
  private updateSteam(a: Avatar, time: number, x: number, y: number, frame: string, depth: number) {
    const cup = a.act === 'tea' && !a.lyingShown && !this.reduce && (frame.startsWith('cup') || frame.startsWith('scup'));
    if (!cup) {
      a.steam?.forEach((r) => r.setVisible(false));
      return;
    }
    const key = `${a.texKey}|${frame}|${a.dir}`;
    if (!this.anchors.has(key)) this.anchors.set(key, cupAnchor(a.look, registry.avatar, frame as FrameName, a.dir));
    const at = this.anchors.get(key);
    if (!at) {
      a.steam?.forEach((r) => r.setVisible(false));
      return;
    }
    if (!a.steam) a.steam = [0, 1, 2].map(() => this.add.rectangle(0, 0, 1, 2, 0xfffaf0, 1).setAlpha(0).setVisible(false));
    const left = x - FRAME_W / 2 + at.x;
    const top = y - (FRAME_H - 1) + at.y;
    a.steam.forEach((r, i) => {
      const age = (((time + a.phase) / 2600 + i / 3) % 1 + 1) % 1;
      const rise = age * 10;
      const sway = Math.round(Math.sin(age * 7 + i * 2.1) * 1.3);
      r.setPosition(Math.round(left) + sway + (i - 1), Math.round(top - 2 - rise)).setDepth(depth + 1).setVisible(true);
      r.setAlpha(Math.sin(Math.PI * age) * 0.85);
    });
  }

  /** A soft round glow, drawn once and shared. */
  private seatGlowTexture(): string {
    const key = 'seat-glow';
    if (!this.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      if (g) {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,176,110,1)');
        grad.addColorStop(0.45, 'rgba(255,150,90,0.45)');
        grad.addColorStop(1, 'rgba(255,140,80,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
      }
      this.textures.addCanvas(key, c);
    }
    return key;
  }
}
