/**
 * Little things a person can do where they stand: sip tea, lie down, stretch. The server decides who may start one;
 * every client turns the same few bits in the `flags` of a position update into the same pictures.
 */

/** What a person can ask for themselves. */
export const OWN_ACTIVITIES = ['tea', 'lie', 'stretch'] as const;
/** Things from the vending machine; they are only ever handed out by the server after a pick at the machine. */
export const VENDED = ['chips', 'choc', 'cookie', 'cola', 'lemon', 'orange', 'icetea'] as const;
export const ACTIVITIES = [...OWN_ACTIVITIES, ...VENDED] as const;
export type ActivityId = (typeof ACTIVITIES)[number];
export type VendedId = (typeof VENDED)[number];

/** The first two bits of `flags` are moving and seated; the next four hold the activity number. */
export const ACTIVITY_SHIFT = 2;
export const ACTIVITY_MASK = 0b1111 << ACTIVITY_SHIFT;
/** A stretch ends by itself after this long (ms). */
export const STRETCH_MS = 3200;

/** Name and key shown to people. */
export const ACTIVITY_INFO: Record<ActivityId, { label: string; stop: string; key: string }> = {
  tea: { label: 'Tea', stop: 'Put the cup down', key: 'T' },
  lie: { label: 'Lie down', stop: 'Get up', key: 'L' },
  stretch: { label: 'Stretch', stop: 'Stop stretching', key: 'X' },
  chips: { label: 'Chips', stop: 'Put the chips away', key: '' },
  choc: { label: 'Chocolate bar', stop: 'Put the chocolate away', key: '' },
  cookie: { label: 'Cookies', stop: 'Put the cookies away', key: '' },
  cola: { label: 'Cola', stop: 'Put the can down', key: '' },
  lemon: { label: 'Lemon soda', stop: 'Put the can down', key: '' },
  orange: { label: 'Orange soda', stop: 'Put the can down', key: '' },
  icetea: { label: 'Iced tea', stop: 'Put the bottle down', key: '' },
};

export function isVended(id: ActivityId | string | null): id is VendedId {
  return !!id && (VENDED as readonly string[]).includes(id);
}

/** What kind of thing is in your hands: a cup of tea, a snack being eaten, or a soda being sipped. */
export function heldKind(id: ActivityId | null): 'tea' | 'snack' | 'soda' | null {
  if (id === 'tea') return 'tea';
  if (id === 'chips' || id === 'choc' || id === 'cookie') return 'snack';
  if (isVended(id)) return 'soda';
  return null;
}

export function activityOf(flags: number): ActivityId | null {
  const n = (flags & ACTIVITY_MASK) >> ACTIVITY_SHIFT;
  return n >= 1 && n <= ACTIVITIES.length ? ACTIVITIES[n - 1] : null;
}

/** The bits for an activity, ready to be added to the other flags. */
export function activityBits(id: ActivityId | null): number {
  return id ? (ACTIVITIES.indexOf(id) + 1) << ACTIVITY_SHIFT : 0;
}

export function withoutActivity(flags: number): number {
  return flags & ~ACTIVITY_MASK;
}

/** Tea can be had standing or seated, lying down and stretching need you on your feet. Returns a short reason when it is not possible. */
export function activityBlocked(id: ActivityId, seated: boolean): string | null {
  if (isVended(id)) return 'Get that from the vending machine.';
  if (seated && id !== 'tea') return id === 'lie' ? 'Stand up first, then lie down.' : 'Stand up first, then stretch.';
  return null;
}

// ------------------------------------------------------------------ pictures

export type TeaFrame = 'cup0' | 'cup1' | 'cup2' | 'scup0' | 'scup1' | 'scup2';
export type StretchFrame = 'str0' | 'str1';
export type LieFrame = 'lie0' | 'lie1' | 'lie2';

/**
 * The slow sip loop: hold the cup, lift it, a sip with closed eyes, lower it again, a long rest, steam rising the whole time.
 * `phase` keeps neighbours out of step. Reduced motion holds the cup still. 0 is the cup low, 1 lifted, 2 lifted with eyes closed.
 */
export function teaStep(t: number, phase: number, reduce: boolean): 0 | 1 | 2 {
  if (reduce) return 0;
  const u = (t + phase) % 7600;
  if (u < 3800) return 0;
  if (u < 4500) return 1;
  if (u < 5700) return 2;
  if (u < 6400) return 1;
  return 0;
}

/** Snacks: bring it up, chew with eyes closed, a pause, another bite. Faster than tea. */
export function biteStep(t: number, phase: number, reduce: boolean): 0 | 1 | 2 {
  if (reduce) return 0;
  const u = (t + phase) % 4200;
  if (u < 1300) return 0;
  if (u < 1800) return 1;
  if (u < 2900) return 2;
  if (u < 3300) return 1;
  return 0;
}

/** Soda: a good long swig now and then. */
export function sodaStep(t: number, phase: number, reduce: boolean): 0 | 1 | 2 {
  if (reduce) return 0;
  const u = (t + phase) % 6000;
  if (u < 2800) return 0;
  if (u < 3300) return 1;
  if (u < 4300) return 2;
  if (u < 4800) return 1;
  return 0;
}

export function teaFrame(t: number, phase: number, reduce: boolean, seated: boolean, id: ActivityId | null = 'tea'): TeaFrame {
  const kind = heldKind(id);
  const n = kind === 'snack' ? biteStep(t, phase, reduce) : kind === 'soda' ? sodaStep(t, phase, reduce) : teaStep(t, phase, reduce);
  return `${seated ? 's' : ''}cup${n}` as TeaFrame;
}

/** Arms rise, hold with a yawn, and come back down. `elapsed` is ms since the stretch began. */
export function stretchFrame(elapsed: number, reduce: boolean): StretchFrame {
  if (reduce) return 'str1';
  if (elapsed < 450 || elapsed > STRETCH_MS - 500) return 'str0';
  return 'str1';
}

/**
 * Lying down: a slow breath, and the eyes are closed apart from a long open spell now and then.
 * Reduced motion gets one still picture with eyes closed.
 */
export function lieFrame(t: number, phase: number, reduce: boolean): LieFrame {
  if (reduce) return 'lie2';
  const u = t + phase;
  if (u % 14000 > 11800 && u % 14000 < 13800) return 'lie0';
  return Math.floor(u / 2100) % 2 === 0 ? 'lie2' : 'lie1';
}
