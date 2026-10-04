/**
 * The step ladder for a held D-pad seek: a tap nudges by a second, a sustained
 * hold moves minutes. Hold time picks the rung, not the event count, because
 * auto-repeat rates differ between devices.
 */
export const SEEK_LADDER_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 300_000] as const;

/** Hold time per rung. */
export const SEEK_RUNG_ADVANCE_MS = 600;

/** A gap longer than this ends the hold, so a missed keyup (a TV does this) cannot leave the ladder at the top. */
export const SEEK_HOLD_RELEASE_MS = 350;

export type SeekDirection = -1 | 1;

export interface SeekHold {
  direction: SeekDirection;
  startedAtMs: number;
  lastEventAtMs: number;
}

export function seekLadderStepMs(heldMs: number): number {
  const rung = Math.min(SEEK_LADDER_MS.length - 1, Math.max(0, Math.floor(heldMs / SEEK_RUNG_ADVANCE_MS)));
  return SEEK_LADDER_MS[rung];
}

export function seekDirectionForKey(key: string, keyCode: number): SeekDirection | undefined {
  if (key === 'ArrowLeft' || key === 'Left' || keyCode === 37) return -1;
  if (key === 'ArrowRight' || key === 'Right' || keyCode === 39) return 1;
  return undefined;
}

/**
 * Keys a focused range input moves its thumb on. Each release must commit the
 * seek, or the playhead shows the new position while playback stays put until blur.
 */
export function committingScrubberKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight'
    || key === 'ArrowUp' || key === 'ArrowDown'
    || key === 'Left' || key === 'Right' || key === 'Up' || key === 'Down'
    || key === 'PageUp' || key === 'PageDown'
    || key === 'Home' || key === 'End';
}

/**
 * Advances a hold by one key event, returning the signed distance and the hold
 * to carry forward. Reversing direction restarts the ladder.
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
