import type { Profile, ReportRecord, Store, StoredConfession } from './types';

const MAX_REPORTS = 2000;

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private profiles = new Map<string, Profile>();
  private bans = new Map<string, string>();
  private blocks = new Map<string, Set<string>>();
  private reports: ReportRecord[] = [];
  private confessions = new Map<string, StoredConfession>();
  private hearts = new Map<string, Set<string>>();
  private confReports = new Map<string, Set<string>>();

  async getProfile(sub: string) {
    return this.profiles.get(sub) ?? null;
  }
  async saveProfile(sub: string, p: Profile) {
    this.profiles.set(sub, p);
  }

  async isBanned(uid: string) {
    return this.bans.has(uid);
  }
  async ban(uid: string, reason: string) {
    this.bans.set(uid, reason);
  }

  async getBlocks(owner: string) {
    return [...(this.blocks.get(owner) ?? [])];
  }
  async addBlock(owner: string, blocked: string) {
    const s = this.blocks.get(owner) ?? new Set<string>();
    s.add(blocked);
    this.blocks.set(owner, s);
  }
  async removeBlock(owner: string, blocked: string) {
    this.blocks.get(owner)?.delete(blocked);
  }

  async addReport(r: ReportRecord) {
    this.reports.push(r);
    if (this.reports.length > MAX_REPORTS) this.reports.shift();
  }
  /** test/inspection helper */
  allReports(): readonly ReportRecord[] {
    return this.reports;
  }

  async listConfessions(limit: number) {
    return [...this.confessions.values()]
      .filter((c) => !c.hidden)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }
  async getConfession(id: string) {
    return this.confessions.get(id) ?? null;
  }
  async addConfession(c: StoredConfession) {
    this.confessions.set(c.id, c);
  }
  async hideConfession(id: string) {
    const c = this.confessions.get(id);
    if (c) c.hidden = true;
  }
  async heartConfession(id: string, uid: string) {
    const c = this.confessions.get(id);
    if (!c || c.hidden) return null;
    const s = this.hearts.get(id) ?? new Set<string>();
    if (s.has(uid)) return null;
    s.add(uid);
    this.hearts.set(id, s);
    c.hearts = s.size;
    return c.hearts;
  }
  async reportConfession(id: string, reporter: string) {
    const s = this.confReports.get(id) ?? new Set<string>();
    s.add(reporter);
    this.confReports.set(id, s);
    return s.size;
  }
  async purgeExpired(olderThanMs: number) {
    const cutoff = Date.now() - olderThanMs;
    let n = 0;
    for (const [id, c] of this.confessions) {
      if (c.ts < cutoff) {
        this.confessions.delete(id);
        this.hearts.delete(id);
        this.confReports.delete(id);
        n++;
      }
    }
    return n;
  }
}
