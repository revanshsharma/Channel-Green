import { describe, expect, it } from 'vitest';
import { expandShortcodes } from './emoji';

describe('emoji shortcodes', () => {
  it('expands known codes and leaves the rest alone', () => {
    expect(expandShortcodes('hi :heart: :nope:')).toBe('hi 💚 :nope:');
  });
});
