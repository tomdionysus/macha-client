/**
 * Times in, times out: **UTC everywhere except the last inch.**
 *
 * Tom, 2026-09-21: *"times should be presented in local, but backend we
 * always deal in UTC. Timezones are a presentation problem."* So every
 * instant this client holds, compares, logs or hands to another machine is
 * epoch milliseconds or Zulu, and the only place a zone appears is the pixel
 * a person reads.
 *
 * **Why the presented form still names its zone.** Macha deploys across
 * sites and the nodes tonight ran EEST, CEST and BST. A viewer reading
 * `18:51:52` on a screen in one zone, beside a journal written in another,
 * cannot tell a correct reading from an hour's error — which is exactly what
 * happened when a session timeline went to the server session stamped from
 * this machine's clock. Local answers "when was that, for me"; the zone
 * label is what stops it being mistaken for the node's own time. Presented
 * local, labelled, and never used as the interchange format.
 */

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function stated(unixMs: number | undefined | null): number | undefined {
  if (unixMs === undefined || unixMs === null || !Number.isFinite(unixMs) || unixMs <= 0) return undefined;
  const at = new Date(unixMs);
  return Number.isNaN(at.getTime()) ? undefined : unixMs;
}

/**
 * What a person reads: their own clock, with the zone said out loud.
 *
 * `21 Sep 2026, 18:51:52 GMT+3`. Zero and absent are `—` rather than 1970,
 * because a node that has never been observed reports `0` and every system
 * that has rendered that as an epoch date has fooled somebody.
 */
export function presentedTime(unixMs: number | undefined | null): string {
  const value = stated(unixMs);
  if (value === undefined) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(value));
}

/** The same instant with the date left off, for a line where the date is established. */
export function presentedTimeOfDay(unixMs: number | undefined | null): string {
  const value = stated(unixMs);
  if (value === undefined) return '—';
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'long' }).format(new Date(value));
}

/**
 * `2026-09-21 15:51:52Z` — the interchange form.
 *
 * For anything that leaves this client for another machine or another
 * person's terminal: log lines, bug reports, a timeline handed to whoever is
 * reading a node's journal. Never for the screen, which is what
 * `presentedTime` is for.
 */
export function zuluTimestamp(unixMs: number | undefined | null): string {
  const value = stated(unixMs);
  if (value === undefined) return '—';
  const at = new Date(value);
  return `${at.getUTCFullYear()}-${twoDigits(at.getUTCMonth() + 1)}-${twoDigits(at.getUTCDate())}`
    + ` ${twoDigits(at.getUTCHours())}:${twoDigits(at.getUTCMinutes())}:${twoDigits(at.getUTCSeconds())}Z`;
}

/** `15:51:52Z`, for an interchange line where the date is already established. */
export function zuluTimeOfDay(unixMs: number | undefined | null): string {
  const full = zuluTimestamp(unixMs);
  return full === '—' ? full : full.slice(11);
}
