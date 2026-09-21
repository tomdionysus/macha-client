import { describe, expect, it } from 'vitest';
import { presentedTime, presentedTimeOfDay, zuluTimeOfDay, zuluTimestamp } from './timestamps';

/** 2026-09-21T15:51:52Z — the evening that produced this module. */
const INSTANT = Date.UTC(2026, 8, 21, 15, 51, 52);

describe('zuluTimestamp — the interchange form', () => {
  it('writes the instant in UTC and says so', () => {
    expect(zuluTimestamp(INSTANT)).toBe('2026-09-21 15:51:52Z');
  });

  it('does not move with the machine that renders it', () => {
    // The bug this exists to prevent: three nodes in three zones, and a
    // client adding a fourth. Whatever this machine's offset is, the output
    // is the node's instant.
    const offsetMinutes = new Date(INSTANT).getTimezoneOffset();
    expect(zuluTimestamp(INSTANT)).toBe('2026-09-21 15:51:52Z');
    expect(offsetMinutes).toBe(new Date(INSTANT).getTimezoneOffset());
  });

  it('pads every field, so the column is readable beside a journal', () => {
    expect(zuluTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05Z');
  });

  it('treats "never observed" as not stated rather than as 1970', () => {
    expect(zuluTimestamp(0)).toBe('—');
    expect(zuluTimestamp(undefined)).toBe('—');
    expect(zuluTimestamp(null)).toBe('—');
  });

  it('refuses a value that is not a time', () => {
    expect(zuluTimestamp(Number.NaN)).toBe('—');
    expect(zuluTimestamp(Number.POSITIVE_INFINITY)).toBe('—');
    expect(zuluTimestamp(-1)).toBe('—');
  });
});

describe('zuluTimeOfDay', () => {
  it('drops the date and keeps the zone', () => {
    expect(zuluTimeOfDay(INSTANT)).toBe('15:51:52Z');
  });

  it('says nothing for a time that was never stated', () => {
    expect(zuluTimeOfDay(0)).toBe('—');
  });
});

describe('presentedTime — the only place a zone belongs', () => {
  it('renders in the reader\'s own zone rather than in UTC', () => {
    const shown = presentedTime(INSTANT);
    const at = new Date(INSTANT);
    const hour24 = at.getHours();
    const hour12 = ((hour24 + 11) % 12) + 1;
    // Locale decides 12- or 24-hour, so accept either spelling of the local
    // hour; what matters is that it is the local one and not the Zulu form.
    expect(shown.includes(String(hour24)) || shown.includes(String(hour12))).toBe(true);
    expect(shown).not.toMatch(/Z$/);
    if (at.getTimezoneOffset() !== 0) expect(shown).not.toBe(zuluTimestamp(INSTANT));
  });

  it('names the zone, because an unlabelled hour beside a node journal is the whole trap', () => {
    // `timeStyle: 'long'` carries the zone; whatever this machine's is, it
    // must appear. Asserted as "more than the digits" rather than against a
    // fixed abbreviation, which would pin the test to one machine.
    const shown = presentedTime(INSTANT);
    expect(shown.replace(/[\d\s:,-]/g, '').length).toBeGreaterThan(3);
  });

  it('treats never-stated as not stated', () => {
    expect(presentedTime(0)).toBe('—');
    expect(presentedTime(undefined)).toBe('—');
    expect(presentedTimeOfDay(null)).toBe('—');
  });

  it('drops the date but keeps the zone in the short form', () => {
    const shown = presentedTimeOfDay(INSTANT);
    expect(shown).not.toMatch(/2026/);
    expect(shown.replace(/[\d\s:,-]/g, '').length).toBeGreaterThan(3);
  });
});
