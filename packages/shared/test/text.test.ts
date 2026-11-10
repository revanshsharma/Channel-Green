import { describe, expect, it } from 'vitest';
import { matchesBlocklist, normalizeForFilter, sanitizeName, sanitizeText, spamScore } from '../src/text';

describe('sanitizeText', () => {
  it('rejects non-strings', () => {
    expect(sanitizeText(42, 10)).toBe('');
    expect(sanitizeText(null, 10)).toBe('');
    expect(sanitizeText({ a: 1 }, 10)).toBe('');
  });
  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeText('  hi \n\n\t there\u0000 ', 50)).toBe('hi there');
  });
  it('removes invisible and direction-override characters', () => {
    expect(sanitizeText('ab​c‮d﻿e', 50)).toBe('abcde');
  });
  it('limits stacked combining marks', () => {
    const zalgo = 'a' + '̀́̂̃̄̅';
    expect((sanitizeText(zalgo, 50).match(/\p{M}/gu) ?? []).length).toBeLessThanOrEqual(2);
  });
  it('truncates by characters, not UTF-16 units', () => {
    expect(Array.from(sanitizeText('🌿'.repeat(10), 4))).toHaveLength(4);
  });
  it('leaves markup alone as text (the clients render it as text, never HTML)', () => {
    expect(sanitizeText('<b>hi</b>', 50)).toBe('<b>hi</b>');
  });
});

describe('sanitizeName', () => {
  it('accepts ordinary names', () => {
    expect(sanitizeName('  Mossy.Fern_1 ')).toBe('Mossy.Fern_1');
  });
  it('drops symbols and markup', () => {
    expect(sanitizeName('<img src=x>Ana')).toBe('img srcxAna');
  });
  it('rejects too short or empty', () => {
    expect(sanitizeName('a')).toBeNull();
    expect(sanitizeName('!!!')).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
  });
  it('caps the length at 20', () => {
    expect(Array.from(sanitizeName('x'.repeat(100)) ?? '')).toHaveLength(20);
  });
  it('keeps non-latin letters', () => {
    expect(sanitizeName('Ñandú')).toBe('Ñandú');
  });
});

describe('spamScore', () => {
  it('is zero for ordinary chat', () => {
    expect(spamScore('hey, anyone up for tea?')).toBe(0);
  });
  it('counts links, repeats and shouting', () => {
    expect(spamScore('buy at http://x.example now www.y.example')).toBeGreaterThanOrEqual(4);
    expect(spamScore('aaaaaaaaaaaaaaa')).toBeGreaterThanOrEqual(2);
    expect(spamScore('THIS IS A VERY LOUD MESSAGE')).toBeGreaterThanOrEqual(1);
  });
});

describe('blocklist', () => {
  it('normalises common obfuscation', () => {
    expect(normalizeForFilter('B@dW0rd!')).toBe('badword i'.replace(' i', 'i'));
  });
  it('matches whole words', () => {
    expect(matchesBlocklist('you are a badword', ['badword'])).toBe(true);
    expect(matchesBlocklist('classic', ['ass'])).toBe(false);
  });
  it('catches spaced-out long terms', () => {
    expect(matchesBlocklist('b a d w o r d', ['badword'])).toBe(true);
  });
  it('ignores empty terms', () => {
    expect(matchesBlocklist('hello', [''])).toBe(false);
  });
});
