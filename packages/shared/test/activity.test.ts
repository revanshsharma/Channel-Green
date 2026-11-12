import { describe, expect, it } from 'vitest';
import { ACTIVITIES, FLAG_MOVING, FLAG_SEATED, STRETCH_MS, activityBits, activityBlocked, activityOf, lieFrame, stretchFrame, teaFrame, withoutActivity } from '../src';

describe('activities', () => {
  it('round-trips every activity through the flag bits without touching moving or seated', () => {
    for (const id of ACTIVITIES) {
      const flags = FLAG_SEATED | activityBits(id);
      expect(activityOf(flags)).toBe(id);
      expect(flags & FLAG_SEATED).toBe(FLAG_SEATED);
      expect(withoutActivity(flags)).toBe(FLAG_SEATED);
    }
    expect(activityOf(FLAG_MOVING)).toBeNull();
    expect(activityOf(0b111 << 2)).toBeNull();
    expect(activityBits(null)).toBe(0);
  });

  it('only lets tea happen while seated', () => {
    expect(activityBlocked('tea', true)).toBeNull();
    expect(activityBlocked('lie', true)).toMatch(/Stand up/);
    expect(activityBlocked('stretch', true)).toMatch(/Stand up/);
    expect(activityBlocked('lie', false)).toBeNull();
  });

  it('picks the right pictures, and holds still for reduced motion', () => {
    expect(teaFrame(0, 0, false, false)).toBe('cup0');
    expect(teaFrame(5000, 0, false, true)).toBe('scup2');
    expect(teaFrame(5000, 0, true, false)).toBe('cup0');
    expect(stretchFrame(1000, false)).toBe('str1');
    expect(stretchFrame(STRETCH_MS - 100, false)).toBe('str0');
    expect(lieFrame(5000, 0, true)).toBe('lie2');
  });
});
