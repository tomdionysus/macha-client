/**
 * An accelerating seek "finder" for held D-pad presses.
 *
 * A remote has no scrub wheel, so a fixed step is always wrong somewhere: 10s
 * is tedious across a film, 30s overshoots the moment you were looking for.
 * Holding the key therefore climbs a ladder — a tap nudges by a second, a
 * sustained hold ends up moving minutes.
 *
 * Time drives the rung rather than the number of key events, because auto-
 * repeat rates differ between a TV remote and a desktop keyboard; counting
 * events would accelerate at whatever speed the platform happens to repeat at.
 */
export const SEEK_LADDER_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 300_000] as const;

/** How long the key must be held at each rung before the next one is reached. */
export const SEEK_RUNG_ADVANCE_MS = 600;

/**
 * A gap longer than this ends the hold. Auto-repeat fires far faster than
 * this, so any real pause between presses starts again at one second — and a
 * missed keyup (which a TV will do) cannot leave the ladder stuck at the top.
 */
export const SEEK_HOLD_RELEASE_MS = 350;

export type SeekDirection = -1 | 1;

export interface SeekHold {
  direction: SeekDirection;
  startedAtMs: number;
  lastEventAtMs: number;
}

/** The step for a key that has been held this long, in milliseconds. */
export function seekLadderStepMs(heldMs: number): number {
  const rung = Math.min(SEEK_LADDER_MS.length - 1, Math.max(0, Math.floor(heldMs / SEEK_RUNG_ADVANCE_MS)));
  return SEEK_LADDER_MS[rung];
}

/** Which way a D-pad key seeks, or undefined when it is not a seek key. */
export function seekDirectionForKey(key: string, keyCode: number): SeekDirection | undefined {
  if (key === 'ArrowLeft' || key === 'Left' || keyCode === 37) return -1;
  if (key === 'ArrowRight' || key === 'Right' || keyCode === 39) return 1;
  return undefined;
}

/**
 * Advance a hold by one key event, returning the signed distance to move and
 * the hold to carry into the next event. Reversing direction restarts the
 * ladder: changing your mind is a new search, not a continuation of the old
 * one at minutes per press.
 */
export function accelerateSeek(
  previous: SeekHold | undefined,
  direction: SeekDirection,
  nowMs: number,
): { hold: SeekHold; deltaMs: number } {
  const continuing = previous !== undefined
    && previous.direction === direction
    && nowMs - previous.lastEventAtMs <= SEEK_HOLD_RELEASE_MS;
  const startedAtMs = continuing ? previous.startedAtMs : nowMs;
  return {
    hold: { direction, startedAtMs, lastEventAtMs: nowMs },
    deltaMs: direction * seekLadderStepMs(nowMs - startedAtMs),
  };
}
