import { describe, expect, it } from 'vitest';
import { registry } from '@channel-green/content';
import { scaleMidi, tapeLength, tapeNotesForStep } from './audio';

describe('tape generator', () => {
  const tape = Object.values(registry.tapes)[0];
  it('is deterministic', () => {
    expect(tapeNotesForStep(tape, 13)).toEqual(tapeNotesForStep(tape, 13));
  });
  it('loops at the end of the tape', () => {
    const steps = tape.bars * 8;
    expect(tapeNotesForStep(tape, 3).map((n) => n.midi)).toEqual(tapeNotesForStep(tape, 3 + steps).map((n) => n.midi));
  });
  it('plays a chord at the start of every bar', () => {
    expect(tapeNotesForStep(tape, 0).filter((n) => n.voice === 'pad')).toHaveLength(3);
  });
  it('has a sensible length', () => {
    expect(tapeLength(tape)).toBeGreaterThan(30);
  });
  it('maps scale degrees across octaves', () => {
    expect(scaleMidi('major', 48, 7)).toBe(60);
    expect(scaleMidi('major', 48, -1)).toBe(47);
  });
});
