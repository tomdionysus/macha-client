import { describe, expect, it } from 'vitest';
import { availabilityMark, filesMark } from './Availability';

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

describe('the mark on a set', () => {
  const members = (complete: number) => ({ total: 4, complete, partial: 4 - complete, unavailable: 0, unknown: 0 });

  it('is left off when any member is held in full, whatever the server calls the set', () => {
    expect(availabilityMark('partial', members(1))).toBeUndefined();
    expect(availabilityMark('unknown', { total: 2, complete: 1, partial: 0, unavailable: 0, unknown: 1 })).toBeUndefined();
  });

  it('stays when no member is held in full, or the counts are not given', () => {
    expect(availabilityMark('partial', members(0))).toBe('partial');
    expect(availabilityMark('unavailable', { total: 2, complete: 0, partial: 0, unavailable: 2, unknown: 0 })).toBe('unavailable');
    expect(availabilityMark('partial')).toBe('partial');
  });
});
