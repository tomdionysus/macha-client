import { describe, expect, it } from 'vitest';
import { formatAge, formatEta } from './format';

describe('how long, in the largest units that fit', () => {
  it('gives an ETA in weeks, days, hours and minutes, two units at most, rounding up', () => {
    expect(formatEta(45)).toBe('45s');
    expect(formatEta(30 * 60)).toBe('30m');
    expect(formatEta(2.5 * 3600)).toBe('2h 30m');
    expect(formatEta(25 * 3600)).toBe('1d 1h');
    expect(formatEta(48 * 3600)).toBe('2d');
    expect(formatEta(24 * 3600 + 1)).toBe('1d 1h');
    expect(formatEta(10 * 86_400)).toBe('1w 3d');
    expect(formatEta(null)).toBe('-');
  });

  it('gives an age the same way, counting only what has gone by', () => {
    const now = 1_000_000_000_000;
    const ago = (seconds: number) => formatAge(now - seconds * 1000, now);
    expect(ago(25 * 3600 + 59 * 60)).toBe('1d 1h ago');
    expect(ago(3 * 3600 + 30 * 60)).toBe('3h 30m ago');
    expect(ago(15 * 86_400)).toBe('2w 1d ago');
    expect(ago(30)).toBe('just now');
  });
});
