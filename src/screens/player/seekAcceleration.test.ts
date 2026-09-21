import { describe, expect, it } from 'vitest';
import {
  accelerateSeek,
  committingScrubberKey,
  SEEK_HOLD_RELEASE_MS,
  SEEK_LADDER_MS,
  SEEK_RUNG_ADVANCE_MS,
  seekDirectionForKey,
  seekLadderStepMs,
  type SeekHold,
} from './seekAcceleration';

describe('seek acceleration', () => {
  it('reads direction from both key names and the legacy keyCode a TV sends', () => {
    expect(seekDirectionForKey('ArrowLeft', 37)).toBe(-1);
    expect(seekDirectionForKey('Left', 0)).toBe(-1);
    expect(seekDirectionForKey('', 37)).toBe(-1);
    expect(seekDirectionForKey('ArrowRight', 39)).toBe(1);
    expect(seekDirectionForKey('Right', 0)).toBe(1);
    expect(seekDirectionForKey('', 39)).toBe(1);
    expect(seekDirectionForKey('ArrowUp', 38)).toBeUndefined();
  });

  it('starts at one second so a single tap is a nudge, not a jump', () => {
    expect(seekLadderStepMs(0)).toBe(1_000);
    expect(accelerateSeek(undefined, 1, 1_000).deltaMs).toBe(1_000);
    expect(accelerateSeek(undefined, -1, 1_000).deltaMs).toBe(-1_000);
  });

  it('climbs one rung per hold interval and stops at the top of the ladder', () => {
    for (const [rung, step] of SEEK_LADDER_MS.entries()) {
      expect(seekLadderStepMs(rung * SEEK_RUNG_ADVANCE_MS)).toBe(step);
    }
    // Held far beyond the ladder: the largest step, not an ever-growing one.
    expect(seekLadderStepMs(SEEK_RUNG_ADVANCE_MS * 500)).toBe(SEEK_LADDER_MS[SEEK_LADDER_MS.length - 1]);
  });

  it('accelerates across a sustained hold, measuring elapsed time not event count', () => {
    let hold: SeekHold | undefined;
    const steps: number[] = [];
    // A TV repeating every 100ms: the ladder must still climb on the clock.
    for (let now = 0; now <= 1_800; now += 100) {
      const result = accelerateSeek(hold, 1, now);
      hold = result.hold;
      steps.push(result.deltaMs);
    }
    expect(steps[0]).toBe(1_000);
    expect(steps[steps.length - 1]).toBe(seekLadderStepMs(1_800));
    expect(steps[steps.length - 1]).toBeGreaterThan(steps[0]);
    // Monotonic: a hold never gets slower while it is being held.
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeGreaterThanOrEqual(steps[index - 1]);
    }
  });

  /** Auto-repeat: events every 100ms, as a held remote key actually delivers them. */
  function hold(direction: 1 | -1, durationMs: number, from: SeekHold | undefined = undefined, startAtMs = 0) {
    let current = from;
    let deltaMs = 0;
    for (let now = startAtMs; now <= startAtMs + durationMs; now += 100) {
      const result = accelerateSeek(current, direction, now);
      current = result.hold;
      deltaMs = result.deltaMs;
    }
    return { hold: current as SeekHold, deltaMs };
  }

  it('restarts at one second after a real pause between presses', () => {
    const held = hold(1, SEEK_RUNG_ADVANCE_MS * 4);
    expect(held.deltaMs).toBeGreaterThan(1_000);

    // Released and pressed again: a fresh search, not a continuation.
    const afterRelease = accelerateSeek(held.hold, 1, held.hold.lastEventAtMs + SEEK_HOLD_RELEASE_MS + 1);
    expect(afterRelease.deltaMs).toBe(1_000);
  });

  it('treats auto-repeat as one continuous hold across the release threshold', () => {
    const first = accelerateSeek(undefined, 1, 0);
    const repeated = accelerateSeek(first.hold, 1, SEEK_HOLD_RELEASE_MS);
    expect(repeated.hold.startedAtMs).toBe(0);
  });

  it('restarts the ladder when the viewer reverses direction', () => {
    const fast = hold(1, SEEK_RUNG_ADVANCE_MS * 5);
    expect(fast.deltaMs).toBeGreaterThan(10_000);

    // Overshot and coming back: at minutes per press this would be unusable.
    const reversed = accelerateSeek(fast.hold, -1, fast.hold.lastEventAtMs + 100);
    expect(reversed.deltaMs).toBe(-1_000);
    expect(reversed.hold.startedAtMs).toBe(fast.hold.lastEventAtMs + 100);
  });
});

describe('committingScrubberKey', () => {
  it('commits every key a range input moves itself on', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(committingScrubberKey(key)).toBe(true);
    }
  });

  it('commits the older key names a television sends', () => {
    for (const key of ['Left', 'Right', 'Up', 'Down']) expect(committingScrubberKey(key)).toBe(true);
  });

  it('leaves keys the scrubber does not move on alone', () => {
    for (const key of ['Enter', ' ', 'Escape', 'Tab', 'a', 'F5']) {
      expect(committingScrubberKey(key)).toBe(false);
    }
  });
});
