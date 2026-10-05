import { describe, expect, it } from 'vitest';
import { filesMark } from './Availability';

describe('the mark on a line of files core combined', () => {
  it('is unavailable only when none of them can be played', () => {
    expect(filesMark(['unavailable', 'unavailable'])).toBe('unavailable');
    expect(filesMark(['unavailable', 'complete'])).toBe('partial');
  });

  it('is partial when any of them is short, else unknown, else nothing', () => {
    expect(filesMark(['complete', 'partial'])).toBe('partial');
    expect(filesMark(['complete', 'unknown'])).toBe('unknown');
    expect(filesMark(['complete', undefined])).toBeUndefined();
    expect(filesMark([])).toBeUndefined();
  });
});
