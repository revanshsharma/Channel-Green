import { matchesBlocklist, spamScore } from '@channel-green/shared';
import { STARTER_BLOCKLIST } from './blocklist';

export type TextVerdict = { ok: true } | { ok: false; reason: 'blocked' | 'spam' };

export interface ModerationOptions {
  extraTerms?: string[];
  now?: () => number;
  /** strikes inside `strikeWindowMs` that trigger an automatic mute */
  strikeLimit?: number;
  strikeWindowMs?: number;
  muteMs?: number;
  /** distinct reporters inside `reportWindowMs` that trigger an automatic mute */
  reportLimit?: number;
  reportWindowMs?: number;
  reportMuteMs?: number;
}

/**
 * Everything the server decides about text and behaviour, kept free of sockets so it can be unit tested.
 * State is in memory on purpose: nothing about who said what is kept beyond short windows.
 */
export class Moderation {
  private terms: string[];
  private now: () => number;
  private strikes = new Map<string, number[]>();
  private mutes = new Map<string, number>();
  private reports = new Map<string, Map<string, number>>();
  private lastText = new Map<string, { text: string; at: number }>();
  private o: Required<Omit<ModerationOptions, 'extraTerms' | 'now'>>;

  constructor(opts: ModerationOptions = {}) {
    this.terms = [...STARTER_BLOCKLIST, ...(opts.extraTerms ?? [])];
    this.now = opts.now ?? Date.now;
    this.o = {
      strikeLimit: opts.strikeLimit ?? 4,
      strikeWindowMs: opts.strikeWindowMs ?? 5 * 60_000,
      muteMs: opts.muteMs ?? 5 * 60_000,
      reportLimit: opts.reportLimit ?? 3,
      reportWindowMs: opts.reportWindowMs ?? 10 * 60_000,
      reportMuteMs: opts.reportMuteMs ?? 10 * 60_000,
    };
  }

  checkText(text: string, { allowLinks = false }: { allowLinks?: boolean } = {}): TextVerdict {
    if (matchesBlocklist(text, this.terms)) return { ok: false, reason: 'blocked' };
    const score = spamScore(text);
    if (score >= 3 || (!allowLinks && /https?:\/\/|www\./i.test(text) && score >= 2)) return { ok: false, reason: 'spam' };
    return { ok: true };
  }

  /** Names get the same word list but no spam rules. */
  nameAllowed(name: string): boolean {
    return !matchesBlocklist(name, this.terms);
  }

  /** The same line twice inside a short window is dropped. */
  isRepeat(uid: string, text: string, windowMs = 8000): boolean {
    const t = this.now();
    const prev = this.lastText.get(uid);
    this.lastText.set(uid, { text, at: t });
    return !!prev && prev.text === text && t - prev.at < windowMs;
  }

  /** Records a strike. Returns the time (ms epoch) the player is muted until, or 0. */
  strike(uid: string): number {
    const t = this.now();
    const list = (this.strikes.get(uid) ?? []).filter((x) => t - x < this.o.strikeWindowMs);
    list.push(t);
    this.strikes.set(uid, list);
    if (list.length >= this.o.strikeLimit) {
      this.strikes.delete(uid);
      return this.mute(uid, this.o.muteMs);
    }
    return 0;
  }

  mute(uid: string, ms: number): number {
    const until = this.now() + ms;
    this.mutes.set(uid, until);
    return until;
  }

  mutedUntil(uid: string): number {
    const u = this.mutes.get(uid) ?? 0;
    if (u <= this.now()) {
      this.mutes.delete(uid);
      return 0;
    }
    return u;
  }

  /**
   * A report against `target` from `reporter`. Returns how many different people reported inside the window
   * and whether that tripped the automatic mute. One person reporting many times counts once.
   */
  report(target: string, reporter: string): { distinct: number; tripped: boolean } {
    const t = this.now();
    const m = this.reports.get(target) ?? new Map<string, number>();
    for (const [r, at] of m) if (t - at >= this.o.reportWindowMs) m.delete(r);
    m.set(reporter, t);
    this.reports.set(target, m);
    const distinct = m.size;
    const tripped = distinct >= this.o.reportLimit;
    if (tripped) {
      m.clear();
      this.mute(target, this.o.reportMuteMs);
    }
    return { distinct, tripped };
  }

  sweep(): void {
    const t = this.now();
    for (const [k, v] of this.mutes) if (v <= t) this.mutes.delete(k);
    for (const [k, v] of this.lastText) if (t - v.at > 60_000) this.lastText.delete(k);
    for (const [k, list] of this.strikes) {
      const kept = list.filter((x) => t - x < this.o.strikeWindowMs);
      if (kept.length) this.strikes.set(k, kept);
      else this.strikes.delete(k);
    }
    for (const [k, m] of this.reports) {
      for (const [r, at] of m) if (t - at >= this.o.reportWindowMs) m.delete(r);
      if (!m.size) this.reports.delete(k);
    }
  }
}
