import type { Config } from '../config';
import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

export function createStore(cfg: Pick<Config, 'supabase'>): Store {
  return cfg.supabase ? new SupabaseStore(cfg.supabase.url, cfg.supabase.serviceRoleKey) : new MemoryStore();
}
export * from './types';
export { MemoryStore } from './memory';
