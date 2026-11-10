import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { Config } from './config';

export interface Identity {
  /** account id: "guest:<uuid>" or a Supabase user id */
  sub: string;
  guest: boolean;
  /** anonymous stable pseudonym: safe to show other players, used for blocking */
  uid: string;
}

const ISSUER = 'channel-green';
const GUEST_TTL_SECONDS = 60 * 60 * 24 * 60;

/**
 * Two ways in:
 *  - guest tokens, minted by this server (HS256), so the game works with no accounts configured
 *  - Supabase access tokens, verified here (HS256 secret for legacy projects, JWKS for newer ones)
 */
export class Auth {
  private key: Uint8Array;
  private jwks: JWTVerifyGetKey | null = null;
  private supaSecret: Uint8Array | null = null;

  constructor(private cfg: Pick<Config, 'serverSecret' | 'supabase'>) {
    this.key = new TextEncoder().encode(cfg.serverSecret);
    if (cfg.supabase?.jwtSecret) this.supaSecret = new TextEncoder().encode(cfg.supabase.jwtSecret);
    else if (cfg.supabase) this.jwks = createRemoteJWKSet(new URL(`${cfg.supabase.url}/auth/v1/.well-known/jwks.json`));
  }

  uidFor(sub: string): string {
    return createHmac('sha256', this.cfg.serverSecret).update(`uid:${sub}`).digest('base64url').slice(0, 16);
  }

  async issueGuest(): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({ kind: 'guest' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(`guest:${randomUUID()}`)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${GUEST_TTL_SECONDS}s`)
      .sign(this.key);
    return { token, expiresIn: GUEST_TTL_SECONDS };
  }

  async verify(token: string | undefined | null): Promise<Identity | null> {
    if (!token || token.length > 2000) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      if (payload.kind === 'guest' && typeof payload.sub === 'string' && payload.sub.startsWith('guest:')) {
        return { sub: payload.sub, guest: true, uid: this.uidFor(payload.sub) };
      }
    } catch {
      /* not one of ours - try Supabase next */
    }
    if (!this.cfg.supabase) return null;
    try {
      const { payload } = this.supaSecret
        ? await jwtVerify(token, this.supaSecret, { audience: 'authenticated', algorithms: ['HS256'] })
        : await jwtVerify(token, this.jwks as JWTVerifyGetKey, { audience: 'authenticated' });
      if (typeof payload.sub === 'string' && payload.sub) return { sub: payload.sub, guest: false, uid: this.uidFor(payload.sub) };
    } catch {
      /* invalid */
    }
    return null;
  }
}
