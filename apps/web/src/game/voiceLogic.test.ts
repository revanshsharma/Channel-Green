import { describe, expect, it } from 'vitest';
import {
  PROXIMITY_FAR,
  PROXIMITY_NEAR,
  classifyMediaError,
  connectErrorMessage,
  disconnectMessage,
  joinNames,
  liveBanner,
  permissionText,
  proximityVolume,
  shouldReceive,
} from './voiceLogic';

describe('proximityVolume', () => {
  it('is full close by, silent far away, and fades in between', () => {
    expect(proximityVolume(0)).toBe(1);
    expect(proximityVolume(PROXIMITY_NEAR)).toBe(1);
    expect(proximityVolume(PROXIMITY_FAR)).toBe(0);
    expect(proximityVolume(PROXIMITY_FAR + 500)).toBe(0);
    const mid = proximityVolume((PROXIMITY_NEAR + PROXIMITY_FAR) / 2);
    expect(mid).toBeCloseTo(0.5, 5);
  });
  it('never increases with distance', () => {
    let prev = 1;
    for (let d = 0; d < 300; d += 7) {
      const v = proximityVolume(d);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
  });
  it('treats nonsense distances as silent', () => {
    expect(proximityVolume(NaN)).toBe(0);
    expect(proximityVolume(Infinity)).toBe(0);
  });
});

describe('shouldReceive', () => {
  it('receives ordinary players', () => expect(shouldReceive('u1', [], [])).toBe(true));
  it('never receives blocked players', () => expect(shouldReceive('u1', ['u1'], [])).toBe(false));
  it('never receives muted players', () => expect(shouldReceive('u1', [], ['u1'])).toBe(false));
  it('does not receive someone it cannot identify yet', () => expect(shouldReceive(undefined, [], [])).toBe(false));
  it('is not confused by other ids in the lists', () => expect(shouldReceive('u1', ['u2'], ['u3'])).toBe(true));
});

describe('classifyMediaError', () => {
  const e = (name: string, message = '') => Object.assign(new Error(message), { name });
  it('recognises a denied permission', () => {
    expect(classifyMediaError(e('NotAllowedError'), 'microphone').code).toBe('denied');
    expect(classifyMediaError(e('Error', 'Permission denied'), 'camera').code).toBe('denied');
  });
  it('recognises a missing device', () => {
    const f = classifyMediaError(e('NotFoundError'), 'camera');
    expect(f.code).toBe('no-device');
    expect(f.message).toMatch(/camera/);
  });
  it('recognises a device that is busy', () => expect(classifyMediaError(e('NotReadableError'), 'microphone').code).toBe('in-use'));
  it('recognises an unsupported or insecure page', () => expect(classifyMediaError(new TypeError('x'), 'camera').code).toBe('unsupported'));
  it('falls back to a calm generic message', () => {
    expect(classifyMediaError('weird', 'microphone').code).toBe('unknown');
    expect(classifyMediaError(null, 'camera').message).toMatch(/could not be turned on/);
  });
  it('never leaks raw error text', () => {
    expect(classifyMediaError(e('Error', 'secret-internal-detail'), 'camera').message).not.toMatch(/secret-internal-detail/);
  });
});

describe('connectErrorMessage and disconnectMessage', () => {
  it('maps a network failure', () => expect(connectErrorMessage(new Error('websocket closed'))).toMatch(/reach the voice service/));
  it('maps a refused token', () => expect(connectErrorMessage(new Error('401 unauthorized'))).toMatch(/would not let you in/));
  it('has a generic fallback', () => expect(connectErrorMessage(undefined)).toMatch(/Could not connect/));
  it('says nothing when we hung up ourselves', () => expect(disconnectMessage(1)).toBe(''));
  it('explains a duplicate join and a removal', () => {
    expect(disconnectMessage(2)).toMatch(/another tab/);
    expect(disconnectMessage(4)).toMatch(/removed/);
  });
  it('explains a dropped connection', () => expect(disconnectMessage(14)).toMatch(/dropped/));
  it('has a default for anything else', () => expect(disconnectMessage(undefined)).toMatch(/disconnected/));
});

describe('indicators', () => {
  it('shows nothing when nothing is live', () => expect(liveBanner({ mic: false, camera: false })).toBe(''));
  it('says what is live', () => {
    expect(liveBanner({ mic: true, camera: false })).toMatch(/microphone is live/);
    expect(liveBanner({ mic: false, camera: true })).toMatch(/camera is live/);
    expect(liveBanner({ mic: true, camera: true })).toMatch(/microphone and camera/);
  });
  it('describes permission states', () => {
    expect(permissionText('microphone', 'denied')).toMatch(/blocked/);
    expect(permissionText('camera', 'prompt')).toMatch(/will ask/);
    expect(permissionText('camera', 'unknown')).toMatch(/unknown/);
  });
  it('joins names', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Ada'])).toBe('Ada');
    expect(joinNames(['Ada', 'Bo'])).toBe('Ada and Bo');
    expect(joinNames(['Ada', 'Bo', 'Cy'])).toBe('Ada, Bo and Cy');
  });
});
