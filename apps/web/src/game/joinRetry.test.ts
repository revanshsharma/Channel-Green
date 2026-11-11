import { describe, expect, it } from 'vitest';
import { GUEST_SIGN_IN_FAILED, isAuthFailure, isGuestToken, joinErrorMessage, shouldRemintGuest } from './joinRetry';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: object) => `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
const guest = jwt({ kind: 'guest', sub: 'guest:abc' });
const user = jwt({ sub: '6f1c0f3e-0000-0000-0000-000000000000', aud: 'authenticated' });

describe('join retry decision', () => {
  it('recognises auth failures', () => {
    expect(isAuthFailure('auth')).toBe(true);
    expect(isAuthFailure('Invalid token')).toBe(true);
    expect(isAuthFailure('Could not sign you in. Please reload.')).toBe(true);
    expect(isAuthFailure('Too many tries. Wait a minute.')).toBe(false);
    expect(isAuthFailure('That name is not available.')).toBe(false);
  });
  it('tells guest tokens from account tokens', () => {
    expect(isGuestToken(guest)).toBe(true);
    expect(isGuestToken(user)).toBe(false);
    expect(isGuestToken('garbage')).toBe(false);
    expect(isGuestToken('')).toBe(false);
    expect(isGuestToken(null)).toBe(false);
  });
  it('re-mints once, only for guests', () => {
    expect(shouldRemintGuest('auth', guest, false)).toBe(true);
    expect(shouldRemintGuest('auth', guest, true)).toBe(false);
    expect(shouldRemintGuest('auth', user, false)).toBe(false);
    expect(shouldRemintGuest('Too many tries. Wait a minute.', guest, false)).toBe(false);
  });
  it('shows plain messages', () => {
    expect(joinErrorMessage('auth', true)).toBe(GUEST_SIGN_IN_FAILED);
    expect(joinErrorMessage('auth', false)).not.toBe('auth');
    expect(joinErrorMessage('That name is not available.', true)).toBe('That name is not available.');
  });
});
