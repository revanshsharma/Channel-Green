import { describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { createVoice, livekitRoomName } from '../src/voice';

const cfg = { livekit: { url: 'ws://127.0.0.1:7880', apiKey: 'testkey', apiSecret: 'testsecret-testsecret-testsecret-1234' } };

describe('voice tokens', () => {
  it('is honestly disabled without keys', async () => {
    const v = createVoice({ livekit: null });
    expect(v.enabled).toBe(false);
    await expect(v.token('r', 'id', 'n')).rejects.toThrow('voice disabled');
    await expect(v.remove('r', 'id')).resolves.toBeUndefined();
  });

  it('issues a short-lived token for one room and one identity', async () => {
    const v = createVoice(cfg);
    expect(v.enabled).toBe(true);
    const jwt = await v.token('cg-town-square_1', 'pid-1', 'Fern');
    const c = decodeJwt(jwt) as Record<string, any>;
    expect(c.iss).toBe('testkey');
    expect(c.sub).toBe('pid-1');
    expect(c.name).toBe('Fern');
    expect(c.exp - c.nbf).toBeLessThanOrEqual(2 * 3600 + 5);
    expect(c.video.room).toBe('cg-town-square_1');
    expect(c.video.roomJoin).toBe(true);
    expect(c.video.roomAdmin).toBeUndefined();
    expect(c.video.canPublishData).toBe(false);
    expect([...c.video.canPublishSources].sort()).toEqual(['camera', 'microphone']);
  });

  it('never puts the secret in the token', async () => {
    const jwt = await createVoice(cfg).token('r', 'i', 'n');
    expect(jwt).not.toContain(cfg.livekit.apiSecret);
    expect(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).not.toContain(cfg.livekit.apiSecret);
  });

  it('builds safe room names', () => {
    expect(livekitRoomName('town-square:1')).toBe('cg-town-square_1');
    expect(livekitRoomName('a b/c')).toBe('cg-a_b_c');
  });
});
