import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile, ReportRecord, Store, StoredConfession } from './types';

/**
 * Postgres-backed store. Uses the service-role key, so it must only ever run on the realtime server.
 * Table definitions live in supabase/migrations. Errors are logged and swallowed for writes so a
 * database hiccup never takes the world down; reads fall back to empty results.
 */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private fail(where: string, error: { message: string } | null): boolean {
    if (error) console.warn(`[store] ${where} failed: ${error.message}`);
    return !!error;
  }

  async getProfile(sub: string): Promise<Profile | null> {
    if (sub.startsWith('guest:')) return null;
    const { data, error } = await this.db.from('profiles').select('name, avatar').eq('id', sub).maybeSingle();
    if (this.fail('getProfile', error) || !data) return null;
    return { name: data.name as string, avatar: data.avatar as Profile['avatar'] };
  }
  async saveProfile(sub: string, p: Profile) {
    if (sub.startsWith('guest:')) return;
    const { error } = await this.db.from('profiles').upsert({ id: sub, name: p.name, avatar: p.avatar, updated_at: new Date().toISOString() });
    this.fail('saveProfile', error);
  }

  async isBanned(uid: string) {
    const { data, error } = await this.db.from('bans').select('uid').eq('uid', uid).maybeSingle();
    this.fail('isBanned', error);
    return !!data;
  }
  async ban(uid: string, reason: string) {
    const { error } = await this.db.from('bans').upsert({ uid, reason: reason.slice(0, 200) });
    this.fail('ban', error);
  }

  async getBlocks(owner: string) {
    const { data, error } = await this.db.from('blocks').select('blocked_uid').eq('owner_uid', owner).limit(500);
    this.fail('getBlocks', error);
    return (data ?? []).map((r) => r.blocked_uid as string);
  }
  async addBlock(owner: string, blocked: string) {
    const { error } = await this.db.from('blocks').upsert({ owner_uid: owner, blocked_uid: blocked });
    this.fail('addBlock', error);
  }
  async removeBlock(owner: string, blocked: string) {
    const { error } = await this.db.from('blocks').delete().eq('owner_uid', owner).eq('blocked_uid', blocked);
    this.fail('removeBlock', error);
  }

  async addReport(r: ReportRecord) {
    const { error } = await this.db.from('reports').insert({
      id: r.id,
      reporter_uid: r.reporterUid,
      target_uid: r.targetUid,
      confession_id: r.confessionId,
      reason: r.reason,
      details: r.details,
      map_id: r.mapId,
      context: r.context,
      created_at: new Date(r.ts).toISOString(),
    });
    this.fail('addReport', error);
  }

  private row(r: Record<string, unknown>): StoredConfession {
    return {
      id: r.id as string,
      text: r.body as string,
      ts: new Date(r.created_at as string).getTime(),
      hearts: (r.hearts as number) ?? 0,
      hidden: !!r.hidden,
      authorUid: r.author_uid as string,
    };
  }
  async listConfessions(limit: number) {
    const { data, error } = await this.db.from('confessions').select('*').eq('hidden', false).order('created_at', { ascending: false }).limit(limit);
    this.fail('listConfessions', error);
    return (data ?? []).map((r) => this.row(r));
  }
  async getConfession(id: string) {
    const { data, error } = await this.db.from('confessions').select('*').eq('id', id).maybeSingle();
    this.fail('getConfession', error);
    return data ? this.row(data) : null;
  }
  async addConfession(c: StoredConfession) {
    const { error } = await this.db.from('confessions').insert({
      id: c.id,
      body: c.text,
      author_uid: c.authorUid,
      hearts: 0,
      hidden: false,
      created_at: new Date(c.ts).toISOString(),
    });
    this.fail('addConfession', error);
  }
  async hideConfession(id: string) {
    const { error } = await this.db.from('confessions').update({ hidden: true }).eq('id', id);
    this.fail('hideConfession', error);
  }
  async heartConfession(id: string, uid: string) {
    const { error } = await this.db.from('confession_hearts').insert({ confession_id: id, uid });
    if (error) return null; // duplicate heart (primary key) or unknown confession
    const { count } = await this.db.from('confession_hearts').select('*', { count: 'exact', head: true }).eq('confession_id', id);
    const hearts = count ?? 0;
    await this.db.from('confessions').update({ hearts }).eq('id', id);
    return hearts;
  }
  async reportConfession(id: string, reporter: string) {
    await this.db.from('confession_reports').upsert({ confession_id: id, reporter_uid: reporter });
    const { count, error } = await this.db.from('confession_reports').select('*', { count: 'exact', head: true }).eq('confession_id', id);
    this.fail('reportConfession', error);
    return count ?? 1;
  }
  async purgeExpired(olderThanMs: number) {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data, error } = await this.db.from('confessions').delete().lt('created_at', cutoff).select('id');
    this.fail('purgeExpired', error);
    return data?.length ?? 0;
  }
}
