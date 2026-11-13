import { describe, expect, it } from 'vitest';
import { ACTIVITIES, VENDED, biteStep, heldKind, sodaStep, FLAG_MOVING, FLAG_SEATED, STRETCH_MS, activityBits, activityBlocked, activityOf, lieFrame, stretchFrame, teaFrame, withoutActivity } from '../src';

describe('activities', () => {
  it('round-trips every activity through the flag bits without touching moving or seated', () => {
    for (const id of ACTIVITIES) {
      const flags = FLAG_SEATED | activityBits(id);
      expect(activityOf(flags)).toBe(id);
      expect(flags & FLAG_SEATED).toBe(FLAG_SEATED);
      expect(withoutActivity(flags)).toBe(FLAG_SEATED);
    }
    expect(activityOf(FLAG_MOVING)).toBeNull();
    expect(activityOf(0b1111 << 2)).toBeNull();
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

  it('keeps the vending machine items out of the hands of anyone who just asks', () => {
    for (const id of VENDED) expect(activityBlocked(id, false)).toMatch(/vending machine/);
    expect(ACTIVITIES.length).toBeLessThanOrEqual(15);
  });

  it('knows what is in your hands and animates snacks and sodas with their own rhythm', () => {
    expect(heldKind('tea')).toBe('tea');
    expect(heldKind('chips')).toBe('snack');
    expect(heldKind('cola')).toBe('soda');
    expect(heldKind('lie')).toBeNull();
    expect(teaFrame(2000, 0, false, false, 'chips')).toBe('cup2');
    expect(teaFrame(2000, 0, false, false, 'cola')).toBe('cup0');
    expect(biteStep(2000, 0, true)).toBe(0);
    expect(sodaStep(3500, 0, true)).toBe(0);
  });
});
