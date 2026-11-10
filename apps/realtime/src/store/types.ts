import type { AvatarConfig } from '@channel-green/shared';

export interface Profile {
  name: string;
  avatar: AvatarConfig;
}

export interface StoredConfession {
  id: string;
  text: string;
  ts: number;
  hearts: number;
  hidden: boolean;
  /** pseudonymous uid of the author. Server-side only; never sent to any client. */
  authorUid: string;
}

export interface ReportRecord {
  id: string;
  ts: number;
  reporterUid: string;
  targetUid: string | null;
  confessionId: string | null;
  reason: string;
  details: string | null;
  mapId: string;
  /** the last few lines the reported player wrote in that room (only kept because a report was made) */
  context: string[];
}

/**
 * Everything that has to outlive a connection. Two implementations:
 *  - MemoryStore (default): nothing survives a restart. Honest local mode.
 *  - SupabaseStore: Postgres through the service role.
 */
export interface Store {
  readonly kind: 'memory' | 'supabase';

  getProfile(sub: string): Promise<Profile | null>;
  saveProfile(sub: string, profile: Profile): Promise<void>;

  isBanned(uid: string): Promise<boolean>;
  ban(uid: string, reason: string): Promise<void>;

  getBlocks(ownerUid: string): Promise<string[]>;
  addBlock(ownerUid: string, blockedUid: string): Promise<void>;
  removeBlock(ownerUid: string, blockedUid: string): Promise<void>;

  addReport(r: ReportRecord): Promise<void>;

  listConfessions(limit: number): Promise<StoredConfession[]>;
  getConfession(id: string): Promise<StoredConfession | null>;
  addConfession(c: StoredConfession): Promise<void>;
  hideConfession(id: string): Promise<void>;
  /** returns the new heart count, or null when this uid already hearted it */
  heartConfession(id: string, uid: string): Promise<number | null>;
  /** confession ids reported by distinct people so far (kept for the auto-hide threshold) */
  reportConfession(id: string, reporterUid: string): Promise<number>;
  purgeExpired(olderThanMs: number): Promise<number>;
}
