import * as Phaser from 'phaser';
import {
  PAINT_COLORS,
  PAINT_SHOT_SPEED,
  VEND_DROP_MS,
  VEND_ITEMS,
  aimFrom,
  heldKind,
  type ActivityId,
  type CollisionMap,
  type MapDef,
  type Splat,
  paintTargets,
  traceShot,
  type TargetBox,
} from '@channel-green/shared';
import type { ShotEvent } from './session';

const FONT = '"Pixelify Sans", "Jost", system-ui, sans-serif';
/** above furniture and people, below the HUD text */
const TOP = 87000;
const MAX_WALL_SPLATS = 36;

export const hex = (c: number) => Phaser.Display.Color.HexStringToColor(PAINT_COLORS[c % PAINT_COLORS.length]).color;

/** A small ragged blob, the same every time for the same seed. */
export function blobRects(seed: number, size = 3): [number, number, number, number][] {
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const out: [number, number, number, number][] = [[-1, -1, size, size]];
  out.push([-2, 0, 1, 1], [size - 1, 1, 1, 1]);
  if (r(1) > 0.3) out.push([0, -2, 1, 1]);
  if (r(2) > 0.3) out.push([1, size - 1, 1, 1]);
  if (r(3) > 0.5) out.push([-3, 1, 1, 1]);
  return out;
}

/**
 * Everything the vending machine and the paint yard draw, apart from the people themselves:
 * the aim line, shots in the air, splats on walls and targets, the snack falling in the tray.
 * Kept out of the main scene so that stays readable.
 */
export class PaintFx {
  private aim: Phaser.GameObjects.Graphics | null = null;
  private owned: Phaser.GameObjects.GameObject[] = [];
  private wallSplats: Phaser.GameObjects.Graphics[] = [];
  private overlays = new Map<string, Phaser.GameObjects.Graphics>();
  private held = new Map<string, Phaser.GameObjects.Graphics>();
  private images = new Map<number, Phaser.GameObjects.Image>();
  private lastAim = new Map<string, { a: number; until: number }>();
  private map: MapDef | null = null;
  private targets: TargetBox[] = [];

  constructor(
    private scene: Phaser.Scene,
    private reduce: () => boolean,
    private textRes: () => number,
  ) {}

  reset(map: MapDef | null) {
    this.owned.forEach((o) => o.destroy());
    this.owned = [];
    this.wallSplats = [];
    this.overlays.forEach((g) => g.destroy());
    this.overlays.clear();
    this.held.forEach((g) => g.destroy());
    this.held.clear();
    this.images.clear();
    this.lastAim.clear();
    this.aim = null;
    this.map = map;
    this.targets = map ? paintTargets(map) : [];
  }

  forget(pid: string) {
    this.overlays.get(pid)?.destroy();
    this.overlays.delete(pid);
    this.held.get(pid)?.destroy();
    this.held.delete(pid);
  }

  registerObject(index: number, img: Phaser.GameObjects.Image) {
    this.images.set(index, img);
  }

  private own<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.owned.push(o);
    return o;
  }

  // ------------------------------------------------------------------ aiming

  /** The laser sight: a thin line with small ticks, and a crosshair where you point. Same trace the server uses. */
  drawAim(
    on: boolean,
    c: number,
    me: { x: number; y: number },
    angle: number,
    point: { x: number; y: number } | null,
    col: CollisionMap,
    others: { pid: string; x: number; y: number }[],
    time: number,
  ) {
    if (!this.aim) this.aim = this.own(this.scene.add.graphics().setDepth(TOP + 10));
    const g = this.aim;
    g.clear();
    if (!on) return;
    const color = hex(c);
    const o = aimFrom(me.x, me.y);
    const shot = traceShot({ map: col, targets: this.targets, players: others }, 'me', me.x, me.y, angle);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const pulse = this.reduce() ? 0.8 : 0.65 + 0.2 * Math.sin(time / 260);
    // dark edge first so the line reads on grass and on boards
    g.lineStyle(3, 0x0b1f15, 0.25).lineBetween(o.x, o.y, shot.x, shot.y);
    g.lineStyle(1, color, pulse).lineBetween(o.x, o.y, shot.x, shot.y);
    // tick marks every 15 px, like a ruler
    for (let d = 15; d < shot.length; d += 15) {
      const x = o.x + dx * d;
      const y = o.y + dy * d;
      const len = d % 45 === 0 ? 3 : 2;
      g.lineStyle(1, color, pulse).lineBetween(x - dy * len, y + dx * len, x + dy * len, y - dx * len);
    }
    // the dot where it ends; red-hot when it would hit a target or a player
    const live = shot.hit.kind === 'target' || shot.hit.kind === 'player';
    g.fillStyle(live ? 0xffffff : color, 1).fillRect(Math.round(shot.x) - 1, Math.round(shot.y) - 1, 3, 3);
    g.fillStyle(live ? color : 0x0b1f15, 0.9).fillRect(Math.round(shot.x), Math.round(shot.y), 1, 1);
    // crosshair where the pointer is
    if (point) {
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      for (const [w, col2, a] of [[3, 0x0b1f15, 0.55], [1, color, 1]] as const) {
        g.lineStyle(w, col2, a);
        g.lineBetween(px - 5, py, px - 2, py).lineBetween(px + 2, py, px + 5, py).lineBetween(px, py - 5, px, py - 2).lineBetween(px, py + 2, px, py + 5);
      }
    }
  }

  // ------------------------------------------------------------------ shots

  shot(e: ShotEvent, victim: { sprite: Phaser.GameObjects.Sprite; x: number; y: number } | null) {
    const color = hex(e.c);
    const s = this.scene;
    this.lastAim.set(e.pid, { a: Math.atan2(e.ey - e.y, e.ex - e.x), until: s.time.now + 2500 });
    const dist = Math.hypot(e.ex - e.x, e.ey - e.y);
    const land = () => this.impact(e, color, victim);
    if (this.reduce() || dist < 4) {
      land();
      return;
    }
    const ball = this.own(s.add.rectangle(e.x, e.y, 3, 3, color).setStrokeStyle(1, 0xffffff, 0.8).setDepth(TOP + 5));
    s.tweens.add({
      targets: ball,
      x: e.ex,
      y: e.ey,
      duration: Math.max(40, (dist / PAINT_SHOT_SPEED) * 1000),
      onComplete: () => {
        ball.destroy();
        land();
      },
    });
  }

  private impact(e: ShotEvent, color: number, victim: { sprite: Phaser.GameObjects.Sprite; x: number; y: number } | null) {
    const s = this.scene;
    const reduce = this.reduce();
    if (e.hit === 'target' && e.target !== undefined) {
      const t = this.targets.find((x) => x.index === e.target);
      if (t) {
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        this.splat(e.ex, e.ey, color, e.pid.length * 7 + Math.round(e.ex), 9000, 7000);
        // ding: a bright ring that opens and fades, and a little word
        const ring = this.own(s.add.rectangle(cx, cy, 12, 12).setStrokeStyle(1, 0xffffff, 1).setDepth(TOP + 6));
        const word = this.own(s.add.text(cx, cy - 12, 'ding!', { fontFamily: FONT, fontSize: '8px', color: '#fff6c8', stroke: '#0b1f15', strokeThickness: 2 }).setOrigin(0.5, 1).setDepth(TOP + 7));
        word.setResolution(this.textRes());
        if (reduce) {
          s.time.delayedCall(700, () => {
            ring.destroy();
            word.destroy();
          });
        } else {
          s.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
          s.tweens.add({ targets: word, y: cy - 20, alpha: 0, duration: 800, delay: 150, onComplete: () => word.destroy() });
          const img = this.images.get(e.target);
          if (img) {
            const x0 = img.x;
            s.tweens.add({ targets: img, x: x0 + 1, duration: 40, yoyo: true, repeat: 2, onComplete: () => img.setX(x0) });
          }
        }
      }
    } else if (e.hit === 'wall' || e.hit === 'none') {
      if (e.hit === 'wall') this.splat(e.ex, e.ey, color, Math.round(e.ex * 3 + e.ey), 14000, 6000);
    } else if (e.hit === 'player' && victim) {
      if (!reduce) {
        victim.sprite.setTintFill(color);
        s.time.delayedCall(90, () => victim.sprite.clearTint());
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + e.ex;
          const d = this.own(s.add.rectangle(e.ex, e.ey, 2, 2, color).setDepth(TOP + 5));
          s.tweens.add({ targets: d, x: e.ex + Math.cos(a) * 9, y: e.ey + Math.sin(a) * 9, alpha: 0, duration: 380, onComplete: () => d.destroy() });
        }
      }
    }
  }

  /** A splat of colour that stays a while and then fades. */
  private splat(x: number, y: number, color: number, seed: number, stay: number, fade: number) {
    const s = this.scene;
    const g = this.own(s.add.graphics().setDepth(TOP + 1).setPosition(Math.round(x), Math.round(y)));
    const blobs = blobRects(seed, 4);
    g.fillStyle(0x0b1f15, 0.4);
    for (const [rx, ry, w, h] of blobs) g.fillRect(rx - 1, ry - 1, w + 2, h + 2);
    g.fillStyle(color, 0.95);
    for (const [rx, ry, w, h] of blobs) g.fillRect(rx, ry, w, h);
    g.fillStyle(0xffffff, 0.5).fillRect(-1, -1, 1, 1);
    this.wallSplats.push(g);
    if (this.wallSplats.length > MAX_WALL_SPLATS) this.wallSplats.shift()?.destroy();
    const done = () => {
      g.destroy();
      this.wallSplats = this.wallSplats.filter((v) => v !== g);
    };
    if (this.reduce()) s.time.delayedCall(stay, done);
    else s.tweens.add({ targets: g, alpha: 0, delay: stay, duration: fade, onComplete: done });
  }

  // ------------------------------------------------------------------ vending

  /** The snack or can dropping into the tray of the machine, seen by everyone in the room. */
  drop(item: string, at: [number, number], size: [number, number]) {
    const it = VEND_ITEMS[item as keyof typeof VEND_ITEMS];
    if (!it) return;
    const s = this.scene;
    const kind = heldKind(item as ActivityId);
    const w = kind === 'snack' ? 5 : 4;
    const h = kind === 'snack' ? 4 : 6;
    const trayY = at[1] + 33 - h;
    const x = at[0] + size[0] / 2 - w / 2 - 1;
    const g = this.own(s.add.graphics().setDepth(at[1] + size[1] + 1));
    g.fillStyle(0x0b1316, 1).fillRect(0, 0, w + 2, h + 2);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(it.color).color, 1).fillRect(1, 1, w, h);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(it.accent).color, 1).fillRect(1, 2, w, 1);
    if (this.reduce()) {
      g.setPosition(x, trayY);
      s.time.delayedCall(VEND_DROP_MS, () => g.destroy());
      return;
    }
    g.setPosition(x, at[1] + 6);
    s.tweens.add({ targets: g, y: trayY, duration: 380, ease: 'Quad.in' });
    s.tweens.add({ targets: g, y: trayY - 2, duration: 90, delay: 380, yoyo: true });
    s.tweens.add({ targets: g, alpha: 0, duration: 160, delay: VEND_DROP_MS - 160, onComplete: () => g.destroy() });
  }

  // ------------------------------------------------------------------ people

  /** The ring under someone who has joined the yard, their marker, colour tags on them, and the snack or can in their hands. */
  person(
    pid: string,
    x: number,
    y: number,
    depth: number,
    dir: string,
    paint: { c: number; splats: Splat[] } | undefined,
    aimAngle: number | null,
    time: number,
  ) {
    let g = this.overlays.get(pid);
    if (!paint) {
      if (g) {
        g.destroy();
        this.overlays.delete(pid);
      }
      return;
    }
    if (!g) {
      g = this.scene.add.graphics();
      this.overlays.set(pid, g);
    }
    g.clear().setDepth(depth + 0.5);
    const color = hex(paint.c);
    // a ring of their colour on the boards
    g.fillStyle(color, 0.85).fillRect(x - 5, y, 10, 1).fillRect(x - 3, y + 1, 6, 1);
    // the marker, pointing where they last aimed (or the way they face)
    const rec = this.lastAim.get(pid);
    const a = aimAngle ?? (rec && rec.until > time ? rec.a : dir === 'left' ? Math.PI : dir === 'up' ? -Math.PI / 2 : dir === 'down' ? Math.PI / 2 : 0);
    const mx = x;
    const my = y - 9;
    g.lineStyle(3, 0x23282b, 1).lineBetween(mx, my, mx + Math.cos(a) * 5, my + Math.sin(a) * 5);
    g.lineStyle(1, color, 1).lineBetween(mx + Math.cos(a) * 5, my + Math.sin(a) * 5, mx + Math.cos(a) * 7, my + Math.sin(a) * 7);
    paint.splats.forEach((sp, i) => {
      g.fillStyle(hex(sp[0]), 0.95);
      for (const [rx, ry, w, h] of blobRects(i * 17 + sp[1] * 5 + sp[2], 3)) g.fillRect(x + sp[1] + rx, y + sp[2] + ry, w, h);
      g.fillStyle(0xffffff, 0.45).fillRect(x + sp[1] - 1, y + sp[2] - 1, 1, 1);
    });
  }

  /** The thing in someone's hands, drawn over the cup pictures at the spot where the cup is. */
  holding(pid: string, id: ActivityId | null, at: { x: number; y: number } | null, depth: number) {
    const kind = heldKind(id);
    let g = this.held.get(pid);
    if (!at || !id || (kind !== 'snack' && kind !== 'soda')) {
      g?.setVisible(false);
      return;
    }
    const it = VEND_ITEMS[id as keyof typeof VEND_ITEMS];
    if (!it) return;
    if (!g) {
      g = this.scene.add.graphics();
      this.held.set(pid, g);
    }
    g.clear().setVisible(true).setDepth(depth + 1);
    const col = Phaser.Display.Color.HexStringToColor(it.color).color;
    const acc = Phaser.Display.Color.HexStringToColor(it.accent).color;
    if (kind === 'soda') {
      g.fillStyle(0x23282b, 1).fillRect(at.x - 2, at.y - 3, 4, 6);
      g.fillStyle(col, 1).fillRect(at.x - 1, at.y - 2, 2, 4);
      g.fillStyle(acc, 1).fillRect(at.x - 1, at.y - 1, 2, 1);
      g.fillStyle(0xd7dde0, 1).fillRect(at.x - 1, at.y - 3, 2, 1);
    } else {
      g.fillStyle(0x23282b, 1).fillRect(at.x - 3, at.y - 2, 6, 5);
      g.fillStyle(col, 1).fillRect(at.x - 2, at.y - 1, 4, 3);
      g.fillStyle(acc, 1).fillRect(at.x - 2, at.y, 4, 1);
    }
  }

  destroy() {
    this.reset(null);
  }
}
