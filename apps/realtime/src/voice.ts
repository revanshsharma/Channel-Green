import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { Config } from './config';

export interface VoiceService {
  readonly enabled: boolean;
  token(roomName: string, identity: string, name: string): Promise<string>;
  /** best-effort removal when someone is kicked or banned */
  remove(roomName: string, identity: string): Promise<void>;
}

/**
 * LiveKit credentials stay on this server. The browser only ever receives a short-lived token
 * for one room. The token allows publishing, but the client never publishes until the member says so.
 */
export function createVoice(cfg: Pick<Config, 'livekit'>): VoiceService {
  const lk = cfg.livekit;
  if (!lk) {
    return {
      enabled: false,
      async token() {
        throw new Error('voice disabled');
      },
      async remove() {},
    };
  }
  const http = lk.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const svc = new RoomServiceClient(http, lk.apiKey, lk.apiSecret);
  return {
    enabled: true,
    async token(roomName, identity, name) {
      const at = new AccessToken(lk.apiKey, lk.apiSecret, { identity, name, ttl: '2h' });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canSubscribe: true,
        canPublish: true,
        canPublishData: false,
        canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
      });
      return at.toJwt();
    },
    async remove(roomName, identity) {
      try {
        await svc.removeParticipant(roomName, identity);
      } catch {
        /* the participant may never have connected */
      }
    },
  };
}

export function livekitRoomName(instanceId: string): string {
  return `cg-${instanceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}
