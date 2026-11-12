import { z } from 'zod';
import { PixelBuffer, shade, mix, mulberry32 } from './pixel';
import type { Art, AvatarPart, AvatarSlot, Registry, Swatch } from './content';

export type AvatarRegistry = Registry['avatar'];

export const NONE = 'none';

export const AvatarConfigSchema = z.object({
  body: z.string().max(48),
  skin: z.string().max(48),
  hair: z.string().max(48),
  hairColor: z.string().max(48),
  hat: z.string().max(48),
  hatColor: z.string().max(48),
  face: z.string().max(48),
  neck: z.string().max(48),
  neckColor: z.string().max(48),
  top: z.string().max(48),
  topColor: z.string().max(48),
  bottom: z.string().max(48),
  bottomColor: z.string().max(48),
  shoes: z.string().max(48),
  shoesColor: z.string().max(48),
});
export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const SPRITE_W = 16;
export const SPRITE_H = 28;
/** Frames include a 1px outline on every side. */
export const FRAME_W = SPRITE_W + 2;
export const FRAME_H = SPRITE_H + 2;
/** idle and walk come first (the avatar editor and the landing scene read the first columns); sit0..sit3 are the seated pictures:
 * resting, breathing in, eyes closed, head tilted. cup0..2 hold a cup of tea standing (cup low, lifted, lifted with eyes closed),
 * scup0..2 the same seated, str0 and str1 are a stretch (arms rising, arms up with a yawn). */
export const FRAME_NAMES = [
  'idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'sit0', 'sit1', 'sit2', 'sit3',
  'cup0', 'cup1', 'cup2', 'scup0', 'scup1', 'scup2', 'str0', 'str1',
] as const;
export type FrameName = (typeof FRAME_NAMES)[number];

const OPTIONAL_SLOTS: AvatarSlot[] = ['hair', 'hat', 'face', 'neck'];

export function partsFor(reg: AvatarRegistry, slot: AvatarSlot): AvatarPart[] {
  return reg.parts.filter((p) => p.slot === slot);
}

function pick<T extends { id: string }>(list: T[], id: string, fallback?: string): T | undefined {
  return list.find((x) => x.id === id) ?? list.find((x) => x.id === fallback) ?? list[0];
}

/** Returns a config in which every field is a real id from the registry. Unknown ids are replaced, never trusted. */
export function sanitizeAvatar(input: unknown, reg: AvatarRegistry): AvatarConfig {
  const raw = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  const swatch = (k: string, list: Swatch[]) => pick(list, str(k))?.id ?? '';
  const part = (slot: AvatarSlot, k: string) => {
    const v = str(k);
    const list = partsFor(reg, slot);
    if (OPTIONAL_SLOTS.includes(slot) && (v === NONE || v === '')) return NONE;
    return pick(list, v)?.id ?? (OPTIONAL_SLOTS.includes(slot) ? NONE : '');
  };
  return {
    body: pick(reg.bodies, str('body'), 'regular')?.id ?? '',
    skin: swatch('skin', reg.skins),
    hair: part('hair', 'hair'),
    hairColor: swatch('hairColor', reg.hairColors),
    hat: part('hat', 'hat'),
    hatColor: swatch('hatColor', reg.clothColors),
    face: part('face', 'face'),
    neck: part('neck', 'neck'),
    neckColor: swatch('neckColor', reg.clothColors),
    top: part('top', 'top'),
    topColor: swatch('topColor', reg.clothColors),
    bottom: part('bottom', 'bottom'),
    bottomColor: swatch('bottomColor', reg.clothColors),
    shoes: part('shoes', 'shoes'),
    shoesColor: swatch('shoesColor', reg.clothColors),
  };
}

export function randomAvatar(reg: AvatarRegistry, seed = Date.now()): AvatarConfig {
  const r = mulberry32(seed);
  const one = <T,>(l: T[]): T => l[Math.floor(r() * l.length)];
  const opt = (slot: AvatarSlot) => (r() < 0.45 && slot !== 'hair' ? NONE : one(partsFor(reg, slot)).id);
  return sanitizeAvatar(
    {
      body: one(reg.bodies).id,
      skin: one(reg.skins).id,
      hair: opt('hair'),
      hairColor: one(reg.hairColors).id,
      hat: r() < 0.7 ? NONE : one(partsFor(reg, 'hat')).id,
      hatColor: one(reg.clothColors).id,
      face: opt('face'),
      neck: r() < 0.7 ? NONE : one(partsFor(reg, 'neck')).id,
      neckColor: one(reg.clothColors).id,
      top: one(partsFor(reg, 'top')).id,
      topColor: one(reg.clothColors).id,
      bottom: one(partsFor(reg, 'bottom')).id,
      bottomColor: one(reg.clothColors).id,
      shoes: one(partsFor(reg, 'shoes')).id,
      shoesColor: one(reg.clothColors).id,
    },
    reg,
  );
}

// ---------------------------------------------------------------- rendering

type Palette = Record<string, string>;
const FIXED: Palette = {
  K: '#2a1d1a', W: '#faf6ec', A: '#f3e6c8', a: '#c9b894', B: '#e07a5f', O: '#e8955a', G: '#2f6b47', N: '#9dff6a',
  Y: '#e8c15a', R: '#b5483a', P: '#e8a0b0', D: '#5a3a2a', L: '#8e7cc3', U: '#4a78a0',
};

function swatchColors(list: Swatch[], id: string): { main: string; shade: string } {
  const s = pick(list, id);
  const main = s?.main ?? '#888888';
  return { main, shade: s?.shade ?? shade(main, -0.18) };
}

function resolver(base: Palette, main: string, sh: string, extra?: Record<string, string>) {
  const pal: Palette = { ...FIXED, ...base, C: main, c: sh, ...extra };
  return (t: string): string => (t.startsWith('#') ? t : (pal[t] ?? '#ff00ff'));
}

function drawArt(buf: PixelBuffer, art: Art | undefined, ox: number, oy: number, res: (t: string) => string): void {
  if (!art) return;
  const [ax, ay] = art.at ?? [0, 0];
  for (const [x, y, w, h, c] of art.rects ?? []) buf.rect(ox + ax + x, oy + ay + y, w, h, res(c));
  (art.rows ?? []).forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      buf.set(ox + ax + i, oy + ay + j, art.palette?.[ch] ?? res(ch));
    }
  });
}

type View = 'down' | 'up' | 'side';

interface FramePose {
  bob: number;
  /** -1 left leg lifted, 1 right leg lifted, 0 flat (down/up views); for side view: stride -1..1 */
  stride: number;
  armSwing: number;
  /** seated: knees bent, body lowered */
  sit?: boolean;
  /** eyes closed */
  blink?: boolean;
  /** head leans this many pixels sideways */
  tilt?: number;
  /** what the arms are doing: holding a cup low, lifting it to the lips, rising halfway, or all the way up */
  arms?: 'cup' | 'sip' | 'half' | 'up';
  /** mouth open in a yawn */
  yawn?: boolean;
}

const POSES: Record<FrameName, FramePose> = {
  idle0: { bob: 0, stride: 0, armSwing: 0 },
  idle1: { bob: 1, stride: 0, armSwing: 0 },
  walk0: { bob: 1, stride: -1, armSwing: -1 },
  walk1: { bob: 0, stride: 0, armSwing: 0 },
  walk2: { bob: 1, stride: 1, armSwing: 1 },
  walk3: { bob: 0, stride: 0, armSwing: 0 },
  sit0: { bob: 0, stride: 0, armSwing: 0, sit: true },
  sit1: { bob: -1, stride: 0, armSwing: 0, sit: true },
  sit2: { bob: 0, stride: 0, armSwing: 0, sit: true, blink: true },
  sit3: { bob: 0, stride: 0, armSwing: 0, sit: true, tilt: 1 },
  cup0: { bob: 0, stride: 0, armSwing: 0, arms: 'cup' },
  cup1: { bob: 0, stride: 0, armSwing: 0, arms: 'sip' },
  cup2: { bob: 0, stride: 0, armSwing: 0, arms: 'sip', blink: true },
  scup0: { bob: 0, stride: 0, armSwing: 0, sit: true, arms: 'cup' },
  scup1: { bob: 0, stride: 0, armSwing: 0, sit: true, arms: 'sip' },
  scup2: { bob: 0, stride: 0, armSwing: 0, sit: true, arms: 'sip', blink: true },
  str0: { bob: 0, stride: 0, armSwing: 0, arms: 'half' },
  str1: { bob: 0, stride: 0, armSwing: 0, arms: 'up', blink: true, yawn: true },
};

/** Where the legs, torso and head start (row numbers inside the 16x28 picture). */
function layout(L: number, view: View, pose: FramePose): { legsTop: number; torsoTop: number; headTop: number } {
  const sit = !!pose.sit;
  const sideSit = sit && view === 'side';
  const legsTop = sit ? SPRITE_H - (sideSit ? 4 : 3) : SPRITE_H - L;
  const torsoTop = sit ? legsTop - (sideSit ? 7 : 5) + pose.bob : legsTop - 7 + pose.bob;
  return { legsTop, torsoTop, headTop: torsoTop - 9 };
}

function renderView(cfg: AvatarConfig, reg: AvatarRegistry, view: View, pose: FramePose): PixelBuffer {
  const buf = new PixelBuffer(SPRITE_W, SPRITE_H);
  const body = pick(reg.bodies, cfg.body, 'regular');
  const L = body?.legLength ?? 6;
  const T = body?.torsoWidth ?? 8;
  const skin = swatchColors(reg.skins, cfg.skin);
  const hairC = swatchColors(reg.hairColors, cfg.hairColor);
  const topC = swatchColors(reg.clothColors, cfg.topColor);
  const botC = swatchColors(reg.clothColors, cfg.bottomColor);
  const shoeC = swatchColors(reg.clothColors, cfg.shoesColor);
  const hatC = swatchColors(reg.clothColors, cfg.hatColor);
  const neckC = swatchColors(reg.clothColors, cfg.neckColor);
  const base: Palette = { S: skin.main, s: skin.shade, H: hairC.main, h: hairC.shade };

  const sit = !!pose.sit;
  const sideSit = sit && view === 'side';
  const { legsTop, torsoTop, headTop } = layout(L, view, pose);
  const tilt = pose.tilt ?? 0;
  const originHead = headTop - 4;
  const torsoX = view === 'side' ? 5 : Math.floor((SPRITE_W - T) / 2);
  const torsoW = view === 'side' ? Math.max(6, T - 2) : T;

  const top = partOf(reg, cfg.top);
  const bottom = partOf(reg, cfg.bottom);
  const shoes = partOf(reg, cfg.shoes);

  const bottomRes = resolver(base, botC.main, botC.shade);
  const shoeRes = resolver(base, shoeC.main, shoeC.shade);
  const topRes = resolver(base, topC.main, topC.shade);

  // legs
  const coverage = bottom?.coverage ?? 1;
  const shoeH = shoes?.height ?? 2;
  const drawLeg = (x: number, w: number, lift: number) => {
    const len = sit ? (sideSit ? 4 : 3) : L - lift;
    for (let j = 0; j < len; j++) {
      const y = legsTop + j;
      const fromBottom = len - j;
      let col: string;
      if (fromBottom <= shoeH && shoes && shoes.id !== 'barefoot') col = shoeRes(j === len - 1 && shoes.sole ? shoes.sole : 'C');
      else col = sit ? (coverage > 0.35 ? bottomRes('C') : skin.main) : j < Math.round(L * coverage) ? bottomRes('C') : skin.main;
      buf.rect(x, y, w, 1, col);
    }
    if (len > 1) buf.rect(x + w - 1, legsTop, 1, Math.max(0, len - shoeH), j2(bottomRes, skin, coverage));
  };
  // seated: the thigh runs forward from the hip (side view); from the front the knees are drawn after the torso
  if (sideSit) {
    const thigh = coverage > 0.35 ? botC.main : skin.main;
    buf.rect(2, torsoTop + 4, 8, 3, thigh);
    buf.rect(2, torsoTop + 6, 8, 1, coverage > 0.35 ? botC.shade : skin.shade);
    drawLeg(2, 3, 0);
  } else if (sit) {
    // legs for the front view are drawn later, over the torso; the back view hides them behind it
    if (view === 'up') {
      drawLeg(4, 3, 0);
      drawLeg(9, 3, 0);
    }
  } else if (view === 'side') {
    if (pose.stride === 0) {
      drawLeg(6, 4, 0);
    } else {
      const a = pose.stride === -1 ? 4 : 9;
      const b = pose.stride === -1 ? 9 : 4;
      drawLeg(b, 3, 1);
      drawLeg(a, 3, 0);
    }
  } else {
    drawLeg(4, 3, pose.stride === -1 ? 1 : 0);
    drawLeg(9, 3, pose.stride === 1 ? 1 : 0);
  }

  // arms (behind the torso in side view is the far arm; near arm drawn after torso)
  const sleeves = top?.sleeves ?? 'short';
  const armLen = 6;
  const drawArm = (x: number, y: number, w: number, len = armLen) => {
    for (let j = 0; j < len; j++) {
      const covered = sleeves === 'long' ? j < armLen - 1 : sleeves === 'short' ? j < 2 : false;
      buf.rect(x, y + j, w, 1, covered ? topC.main : skin.main);
    }
    if (sleeves !== 'none') buf.rect(x, y + (sleeves === 'long' ? armLen - 2 : 1), w, 1, topC.shade);
  };
  const arms = pose.arms;
  const raised = arms === 'up' || arms === 'half';
  // an arm held out or up: sleeve near the shoulder, skin for the hand at the top
  const drawRaisedArm = (x: number, bottom: number, len: number) => {
    for (let j = 0; j < len; j++) {
      const fromShoulder = j;
      const covered = sleeves === 'long' ? fromShoulder < len - 2 : sleeves === 'short' ? fromShoulder < 2 : false;
      buf.rect(x, bottom - j, 2, 1, covered ? topC.main : skin.main);
    }
  };
  if (raised && view !== 'side') {
    const len = arms === 'up' ? 9 : 5;
    drawRaisedArm(torsoX - 3, torsoTop + 1, len);
    drawRaisedArm(torsoX + torsoW + 1, torsoTop + 1, len);
    buf.rect(torsoX - 1, torsoTop + 1, 1, 2, topC.main);
    buf.rect(torsoX + torsoW, torsoTop + 1, 1, 2, topC.main);
  } else if ((arms === 'cup' || arms === 'sip') && view !== 'side') {
    drawArm(torsoX - 2, torsoTop + 1, 2, 3);
    drawArm(torsoX + torsoW, torsoTop + 1, 2, 3);
  } else if (view !== 'side') {
    drawArm(torsoX - 2, torsoTop + 1 + (pose.armSwing === -1 ? 1 : pose.armSwing === 1 ? -1 : 0), 2);
    drawArm(torsoX + torsoW, torsoTop + 1 + (pose.armSwing === 1 ? 1 : pose.armSwing === -1 ? -1 : 0), 2);
  }

  // torso
  buf.rect(torsoX, torsoTop, torsoW, 7, topC.main);
  buf.rect(torsoX, torsoTop + 6, torsoW, 1, topC.shade);
  buf.rect(torsoX, torsoTop, 1, 6, topC.shade);
  drawArt(buf, top?.views?.[view], 0, torsoTop, topRes);

  if (view === 'side') {
    if (arms === 'cup' || arms === 'sip') drawArm(7, torsoTop + 1, 2, 3);
    else if (raised) drawRaisedArm(7, torsoTop + 1, arms === 'up' ? 9 : 5);
    else drawArm(7 + pose.armSwing * 2, torsoTop + 1, 2);
  }

  // seated, front view: the knees come forward over the lap
  if (sit && view === 'down') {
    drawLeg(4, 3, 0);
    drawLeg(9, 3, 0);
  }

  // bottom flare (skirt)
  if (bottom?.flare) {
    buf.rect(torsoX - 1, torsoTop + 6, torsoW + 2, 3, botC.main);
    buf.rect(torsoX - 1, torsoTop + 8, torsoW + 2, 1, botC.shade);
  }

  // head
  const hx = 3 + tilt;
  const headRows: [number, number][] = [[1, 8], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10], [1, 8]];
  headRows.forEach(([off, w], j) => buf.rect(hx + off, headTop + j, w, 1, j === 8 ? skin.shade : skin.main));
  if (view === 'down') {
    const eyeH = pose.blink ? 1 : 2;
    const eyeY = headTop + (pose.blink ? 6 : 5);
    buf.rect(5 + tilt, eyeY, 1, eyeH, FIXED.K);
    buf.rect(10 + tilt, eyeY, 1, eyeH, FIXED.K);
    const blush = mix(skin.main, FIXED.B, 0.55);
    buf.set(4 + tilt, headTop + 7, blush);
    buf.set(11 + tilt, headTop + 7, blush);
  } else if (view === 'side') {
    buf.set(2 + tilt, headTop + 5, skin.main);
    buf.set(2 + tilt, headTop + 6, skin.shade);
    buf.rect(4 + tilt, headTop + (pose.blink ? 6 : 5), 1, pose.blink ? 1 : 2, FIXED.K);
    buf.set(5 + tilt, headTop + 7, mix(skin.main, FIXED.B, 0.55));
  }

  // neck, hair, face, hat
  const neck = partOf(reg, cfg.neck);
  if (neck) drawArt(buf, neck.views?.[view], tilt, originHead, resolver(base, neckC.main, neckC.shade));
  const hat = partOf(reg, cfg.hat);
  const hair = partOf(reg, cfg.hair);
  if (hair && !(hat?.hidesHair)) drawArt(buf, hair.views?.[view], tilt, originHead, resolver(base, hairC.main, hairC.shade));
  const face = partOf(reg, cfg.face);
  if (face && view !== 'up') drawArt(buf, face.views?.[view], tilt, originHead, resolver(base, '#2a1d1a', '#000000'));
  if (hat) drawArt(buf, hat.views?.[view], tilt, originHead, resolver(base, hatC.main, hatC.shade));
  if (pose.yawn && view === 'down') buf.rect(7 + tilt, headTop + 7, 2, 2, '#7a3a3a');
  if (pose.yawn && view === 'side') buf.rect(2 + tilt, headTop + 7, 2, 2, '#7a3a3a');
  if (arms === 'cup' || arms === 'sip') drawCup(buf, view, arms === 'sip', torsoTop, headTop, torsoX, torsoW, skin.main, topC, sleeves);
  return buf;
}

const TEA = '#b8743f';
const TEA_LIGHT = '#d9a066';

/** The cup and the hands around it, drawn last so it sits in front of the chest or the chin. */
function drawCup(
  buf: PixelBuffer,
  view: View,
  lifted: boolean,
  torsoTop: number,
  headTop: number,
  torsoX: number,
  torsoW: number,
  skin: string,
  topC: { main: string; shade: string },
  sleeves: string,
): void {
  const sleeve = sleeves === 'none' ? skin : topC.main;
  const cup = FIXED.W;
  const cupShade = FIXED.a;
  if (view === 'down') {
    const cx = 7;
    const cy = lifted ? headTop + 7 : torsoTop + 3;
    buf.rect(cx, cy, 3, 1, TEA);
    buf.rect(cx, cy + 1, 3, 2, cup);
    buf.rect(cx, cy + 2, 3, 1, cupShade);
    buf.set(cx + 1, cy, TEA_LIGHT);
    // forearms come in from both sides to cradle it
    const hy = cy + 1;
    buf.rect(cx - 1, hy, 1, 1, skin);
    buf.rect(cx + 3, hy, 1, 1, skin);
    if (lifted) {
      buf.rect(cx - 3, hy + 1, 3, 1, sleeve);
      buf.rect(cx + 3, hy + 1, 3, 1, sleeve);
      buf.set(cx - 2, hy + 1, topC.shade);
    } else {
      buf.rect(torsoX, hy, cx - 1 - torsoX, 1, sleeve);
      buf.rect(cx + 4, hy, torsoX + torsoW - cx - 4, 1, sleeve);
    }
  } else if (view === 'side') {
    const cx = 1;
    const cy = lifted ? headTop + 6 : torsoTop + 3;
    buf.rect(cx, cy, 3, 1, TEA);
    buf.rect(cx, cy + 1, 3, 2, cup);
    buf.rect(cx, cy + 2, 3, 1, cupShade);
    buf.set(cx + 1, cy, TEA_LIGHT);
    const hy = cy + 1;
    buf.set(cx + 3, hy, skin);
    buf.rect(cx + 4, hy, 3, 1, sleeve);
    if (lifted) buf.rect(cx + 5, hy + 1, 2, 1, sleeve);
  }
}

function j2(res: (t: string) => string, skin: { main: string }, coverage: number): string {
  // dark inner-edge of the leg: shaded cloth when covered, shaded skin otherwise
  return coverage > 0.5 ? shade(res('C'), -0.14) : shade(skin.main, -0.14);
}

function partOf(reg: AvatarRegistry, id: string): AvatarPart | undefined {
  if (!id || id === NONE) return undefined;
  return reg.parts.find((p) => p.id === id);
}

export type AvatarFrames = Record<`${Direction}-${FrameName}`, PixelBuffer>;

/** Renders every frame (4 directions x 10 poses) of an avatar, each with a dark outline. */
export function renderAvatarFrames(input: unknown, reg: AvatarRegistry): AvatarFrames {
  const cfg = sanitizeAvatar(input, reg);
  const out = {} as AvatarFrames;
  for (const name of FRAME_NAMES) {
    const pose = POSES[name];
    const down = renderView(cfg, reg, 'down', pose).outlined('#2a1d1a');
    const up = renderView(cfg, reg, 'up', pose).outlined('#2a1d1a');
    const left = renderView(cfg, reg, 'side', pose).outlined('#2a1d1a');
    out[`down-${name}`] = down;
    out[`up-${name}`] = up;
    out[`left-${name}`] = left;
    out[`right-${name}`] = left.flippedX();
  }
  return out;
}

/** Packs all frames into one horizontal-grid sheet: columns = FRAME_NAMES, rows = DIRECTIONS. */
export function renderAvatarSheet(input: unknown, reg: AvatarRegistry): PixelBuffer {
  const frames = renderAvatarFrames(input, reg);
  const sheet = new PixelBuffer(FRAME_W * FRAME_NAMES.length, FRAME_H * DIRECTIONS.length);
  DIRECTIONS.forEach((d, r) => FRAME_NAMES.forEach((n, c) => sheet.blit(frames[`${d}-${n}`], c * FRAME_W, r * FRAME_H)));
  return sheet;
}

/** Where the top of a held cup is inside a frame (outline included), so a scene can let steam rise from it. Null when no cup shows. */
export function cupAnchor(input: unknown, reg: AvatarRegistry, frame: FrameName, dir: Direction): { x: number; y: number } | null {
  const pose = POSES[frame];
  if (pose.arms !== 'cup' && pose.arms !== 'sip') return null;
  if (dir === 'up') return null;
  const cfg = sanitizeAvatar(input, reg);
  const L = pick(reg.bodies, cfg.body, 'regular')?.legLength ?? 6;
  const view: View = dir === 'down' ? 'down' : 'side';
  const { torsoTop, headTop } = layout(L, view, pose);
  const lifted = pose.arms === 'sip';
  const y = (lifted ? (view === 'down' ? headTop + 7 : headTop + 6) : torsoTop + 3) + 1;
  const x = view === 'down' ? 8 : dir === 'right' ? SPRITE_W - 1 - 2 : 2;
  return { x: x + 1, y };
}

// ---------------------------------------------------------------- lying down

export const LIE_NAMES = ['lie0', 'lie1', 'lie2'] as const;
export type LieName = (typeof LIE_NAMES)[number];
/** Lying frames are wider than tall, so they live in their own small sheet. Head on the left, or mirrored. */
export const LIE_W = SPRITE_H + 2;
export const LIE_H = SPRITE_W + 1 + 2;
export type LyingFrames = Record<`${'left' | 'right'}-${LieName}`, PixelBuffer>;

/**
 * Lying on your back, face toward the sky. The standing side picture is turned a quarter round, so every look,
 * hat and hairstyle carries over. lie0 eyes open, lie1 chest raised (a breath in), lie2 eyes closed.
 */
export function renderLyingFrames(input: unknown, reg: AvatarRegistry): LyingFrames {
  const cfg = sanitizeAvatar(input, reg);
  const L = pick(reg.bodies, cfg.body, 'regular')?.legLength ?? 6;
  const out = {} as LyingFrames;
  for (const name of LIE_NAMES) {
    const pose: FramePose = { bob: 0, stride: 0, armSwing: 0, blink: name !== 'lie0' };
    const src = renderView(cfg, reg, 'side', pose);
    const { torsoTop } = layout(L, 'side', pose);
    const turned = new PixelBuffer(SPRITE_H, SPRITE_W + 1);
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        const c = src.get(x, y);
        if (c[3] === 0) continue;
        // a quarter turn: the top of the head goes left and the face looks up at the sky; a breath in lifts the chest a pixel
        const chest = name === 'lie1' && y >= torsoTop && y < torsoTop + 7 ? 1 : 0;
        turned.set(y, x + 1 - chest, c);
      }
    }
    const left = turned.outlined('#2a1d1a');
    out[`left-${name}`] = left;
    out[`right-${name}`] = left.flippedX();
  }
  return out;
}

/** The lying frames of one look, side by side: columns = LIE_NAMES, rows = left then right. */
export function renderLyingSheet(input: unknown, reg: AvatarRegistry): PixelBuffer {
  const frames = renderLyingFrames(input, reg);
  const sheet = new PixelBuffer(LIE_W * LIE_NAMES.length, LIE_H * 2);
  (['left', 'right'] as const).forEach((d, r) => LIE_NAMES.forEach((n, c) => sheet.blit(frames[`${d}-${n}`], c * LIE_W, r * LIE_H)));
  return sheet;
}
