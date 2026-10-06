/**
 * Instants are held, compared and exchanged as epoch milliseconds or Zulu. Only the screen
 * shows local time, labelled with its zone because nodes run in different zones.
 */

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function stated(unixMs: number | undefined | null): number | undefined {
  if (unixMs === undefined || unixMs === null || !Number.isFinite(unixMs) || unixMs <= 0) return undefined;
  const at = new Date(unixMs);
  return Number.isNaN(at.getTime()) ? undefined : unixMs;
}

/** Local time with its zone, as `21 Sep 2026, 18:51:52 GMT+3`. Zero and absent are `-`: a never-observed node reports 0. */
export function presentedTime(unixMs: number | undefined | null): string {
  const value = stated(unixMs);
  if (value === undefined) return '-';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(value));
}

/** As `presentedTime`, without the date. */
export function presentedTimeOfDay(unixMs: number | undefined | null): string {
  const value = stated(unixMs);
  if (value === undefined) return '-';
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'long' }).format(new Date(value));
}

/** `2026-09-21 15:51:52Z`: the interchange form, for logs and reports, never the screen. */
export function zuluTimestamp(unixMs: number | undefined | null): string {
  const value = stated(unixMs);
  if (value === undefined) return '-';
  const at = new Date(value);
  return `${at.getUTCFullYear()}-${twoDigits(at.getUTCMonth() + 1)}-${twoDigits(at.getUTCDate())}`
    + ` ${twoDigits(at.getUTCHours())}:${twoDigits(at.getUTCMinutes())}:${twoDigits(at.getUTCSeconds())}Z`;
}
