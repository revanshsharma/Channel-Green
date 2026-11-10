import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  production: boolean;
  serverSecret: string;
  secretGenerated: boolean;
  allowedOrigins: string[];
  trustProxy: boolean;
  supabase: { url: string; serviceRoleKey: string; jwtSecret?: string } | null;
  livekit: { url: string; apiKey: string; apiSecret: string } | null;
  moderatorUserIds: Set<string>;
  extraBlockedTerms: string[];
  maxConnectionsPerIp: number;
  confessionTtlDays: number;
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const int = (v: string | undefined, d: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, Math.trunc(n))) : d;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  let serverSecret = env.SERVER_SECRET ?? '';
  let secretGenerated = false;
  if (serverSecret.length < 32) {
    if (production) throw new Error('SERVER_SECRET must be set to a random string of at least 32 characters in production.');
    serverSecret = randomBytes(48).toString('base64url');
    secretGenerated = true;
  }
  const supabase =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? { url: env.SUPABASE_URL.replace(/\/+$/, ''), serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, jwtSecret: env.SUPABASE_JWT_SECRET || undefined }
      : null;
  const livekit =
    env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
      ? { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET }
      : null;
  return {
    port: int(env.PORT, 4001, 1, 65535),
    production,
    serverSecret,
    secretGenerated,
    allowedOrigins: list(env.ALLOWED_ORIGINS ?? 'http://localhost:3000'),
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? ''),
    supabase,
    livekit,
    moderatorUserIds: new Set(list(env.MODERATOR_USER_IDS)),
    extraBlockedTerms: list(env.EXTRA_BLOCKED_TERMS),
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 8, 1, 200),
    confessionTtlDays: int(env.CONFESSION_TTL_DAYS, 7, 1, 365),
  };
}
