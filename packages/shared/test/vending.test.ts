import { describe, expect, it } from 'vitest';
import { VENDED, VEND_GAP_MS, VEND_ITEMS, VEND_LIST, vendBlocked, vendItem } from '../src';

describe('vending machine', () => {
  it('stocks snacks and sodas, all free and all distinct', () => {
    expect(VEND_LIST.map((i) => i.id)).toEqual([...VENDED]);
    expect(VEND_LIST.filter((i) => i.kind === 'snack').length).toBeGreaterThanOrEqual(3);
    expect(VEND_LIST.filter((i) => i.kind === 'soda').length).toBeGreaterThanOrEqual(4);
    expect(new Set(VEND_LIST.map((i) => i.color + i.accent)).size).toBe(VEND_LIST.length);
    for (const i of VEND_LIST) expect(Object.keys(i)).not.toContain('price');
  });

  it('only knows its own items', () => {
    expect(vendItem('cola')).toBe(VEND_ITEMS.cola);
    expect(vendItem('tea')).toBeNull();
    expect(vendItem('rocket')).toBeNull();
  });

  it('refuses a pick when seated, too soon, or not on the menu', () => {
    const now = 100_000;
    expect(vendBlocked('chips', false, 0, now)).toBeNull();
    expect(vendBlocked('chips', true, 0, now)).toMatch(/Stand up/);
    expect(vendBlocked('chips', false, now - VEND_GAP_MS + 10, now)).toMatch(/moment/);
    expect(vendBlocked('chips', false, now - VEND_GAP_MS - 10, now)).toBeNull();
    expect(vendBlocked('gold', false, 0, now)).toMatch(/does not have/);
  });
});
