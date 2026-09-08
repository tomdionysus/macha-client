import { describe, expect, it, vi } from 'vitest';
import { MediaStallWatchdog, MediaStartWatchdog, type MediaWatchdogEnvironment } from './MediaWatchdog';

/**
 * A fully driven environment: no real timers and no DOM, so every test states
 * the exact clock and visibility sequence it means rather than approximating
 * one. The watchdog's whole contract is about elapsed *visible* time, which is
 * unreadable from a test that cannot separate the two.
 */
function controllable(): {
  environment: MediaWatchdogEnvironment;
  advance(ms: number): void;
  setVisible(visible: boolean): void;
  readonly armed: boolean;
  readonly visibilityListeners: number;
} {
  let now = 0;
  let visible = true;
  const listeners = new Set<() => void>();
  let pending: { callback: () => void; dueAt: number } | undefined;
  return {
    environment: {
      now: () => now,
      visible: () => visible,
      onVisibilityChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      schedule: (callback, delayMs) => {
        const entry = { callback, dueAt: now + delayMs };
        pending = entry;
        return () => { if (pending === entry) pending = undefined; };
      },
    },
    advance(ms) {
      now += ms;
      while (pending && pending.dueAt <= now) {
        const due = pending;
        pending = undefined;
        due.callback();
      }
    },
    setVisible(next) {
      visible = next;
      for (const listener of [...listeners]) listener();
    },
    get armed() { return pending !== undefined; },
    get visibilityListeners() { return listeners.size; },
  };
}

describe('media start watchdog', () => {
  it('reports a source that has delivered nothing by the deadline', () => {
    const host = controllable();
    const starved = vi.fn();
    new MediaStartWatchdog(20_000, host.environment).start(starved);

    host.advance(19_999);
    expect(starved).not.toHaveBeenCalled();
    host.advance(1);
    expect(starved).toHaveBeenCalledWith(20_000);
  });

  it('never reports a source that delivered any bytes at all', () => {
    const host = controllable();
    const starved = vi.fn();
    const watchdog = new MediaStartWatchdog(20_000, host.environment);
    watchdog.start(starved);

    // One `progress` event is the whole discriminator: a merely slow link
    // still produces these long before readyState leaves HAVE_NOTHING, so it
    // must never be judged however long it then takes.
    host.advance(5_000);
    watchdog.noteProgress();
    host.advance(600_000);

    expect(starved).not.toHaveBeenCalled();
    expect(host.armed).toBe(false);
    expect(host.visibilityListeners).toBe(0);
  });

  it('does not count time while the page is hidden', () => {
    const host = controllable();
    const starved = vi.fn();
    new MediaStartWatchdog(20_000, host.environment).start(starved);

    host.advance(8_000);
    host.setVisible(false);
    // Chromium throttles media loading in a backgrounded or occluded tab, so
    // this span is the browser working correctly rather than a node failing.
    // Counting it would condemn a healthy node for a tab nobody was looking
    // at — the exact confound that invalidated an evening of investigation.
    host.advance(3_600_000);
    expect(starved).not.toHaveBeenCalled();

    host.setVisible(true);
    host.advance(11_999);
    expect(starved).not.toHaveBeenCalled();
    host.advance(1);
    expect(starved).toHaveBeenCalledTimes(1);
    expect(starved).toHaveBeenCalledWith(20_000);
  });

  it('stays disarmed while the page has never been visible', () => {
    const host = controllable();
    const starved = vi.fn();
    host.setVisible(false);
    new MediaStartWatchdog(20_000, host.environment).start(starved);

    host.advance(600_000);
    expect(starved).not.toHaveBeenCalled();
    expect(host.armed).toBe(false);
  });

  it('reports once and releases everything it held', () => {
    const host = controllable();
    const starved = vi.fn();
    new MediaStartWatchdog(20_000, host.environment).start(starved);

    host.advance(20_000);
    host.advance(600_000);

    expect(starved).toHaveBeenCalledTimes(1);
    expect(host.armed).toBe(false);
    expect(host.visibilityListeners).toBe(0);
  });

  it('gives each source generation a fresh deadline', () => {
    const host = controllable();
    const first = vi.fn();
    const second = vi.fn();
    const watchdog = new MediaStartWatchdog(20_000, host.environment);

    watchdog.start(first);
    host.advance(19_000);
    watchdog.start(second);
    // The replaced watch is fully released rather than left subscribed
    // alongside its successor.
    expect(host.visibilityListeners).toBe(1);
    host.advance(19_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    host.advance(1_000);
    expect(second).toHaveBeenCalledWith(20_000);
    expect(first).not.toHaveBeenCalled();
  });

  it('stops cleanly without reporting', () => {
    const host = controllable();
    const starved = vi.fn();
    const watchdog = new MediaStartWatchdog(20_000, host.environment);

    watchdog.start(starved);
    watchdog.stop();
    host.advance(600_000);

    expect(starved).not.toHaveBeenCalled();
    expect(host.visibilityListeners).toBe(0);
  });
});

describe('media stall watchdog', () => {
  it('reports a frozen picture with nothing arriving', () => {
    const host = controllable();
    const stalled = vi.fn();
    const watchdog = new MediaStallWatchdog(15_000, host.environment);
    watchdog.watch(stalled);

    watchdog.note(30_000, 45_000);
    host.advance(14_999);
    expect(stalled).not.toHaveBeenCalled();
    host.advance(1);

    expect(stalled).toHaveBeenCalledTimes(1);
    expect(stalled.mock.calls[0][0]).toMatchObject({ visibleMs: 15_000, positionMs: 30_000, bufferedEndMs: 45_000 });
  });

  it('does not judge a node that is merely slow', () => {
    const host = controllable();
    const stalled = vi.fn();
    const watchdog = new MediaStallWatchdog(15_000, host.environment);
    watchdog.watch(stalled);

    // Measured on 2026-09-08: a healthy node producing a transcode below
    // realtime delivered in bursts separated by seven seconds of no progress
    // at all. The picture freezes; the buffer keeps growing. Judging on the
    // stopped clock alone would evict the node doing the work.
    let buffered = 20_000;
    for (let burst = 0; burst < 6; burst += 1) {
      watchdog.note(10_000, buffered);   // playback frozen at the same position
      host.advance(7_000);
      buffered += 11_700;                 // ...but bytes keep landing
      watchdog.note(10_000, buffered);
    }

    expect(stalled).not.toHaveBeenCalled();
  });

  it('fires when the buffer stops growing even though it grew before', () => {
    const host = controllable();
    const stalled = vi.fn();
    const watchdog = new MediaStallWatchdog(15_000, host.environment);
    watchdog.watch(stalled);

    watchdog.note(10_000, 20_000);
    host.advance(5_000);
    watchdog.note(10_000, 31_000);   // still arriving: countdown restarts
    host.advance(14_999);
    expect(stalled).not.toHaveBeenCalled();
    host.advance(1);                  // now neither has moved for the full window

    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('does not count time while the app is not on screen', () => {
    const host = controllable();
    const stalled = vi.fn();
    const watchdog = new MediaStallWatchdog(15_000, host.environment);
    watchdog.watch(stalled);

    watchdog.note(10_000, 20_000);
    host.advance(5_000);
    host.setVisible(false);
    host.advance(3_600_000);
    expect(stalled).not.toHaveBeenCalled();
    host.setVisible(true);
    host.advance(10_000);

    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('treats a paused viewer as not stalled', () => {
    const host = controllable();
    const stalled = vi.fn();
    const watchdog = new MediaStallWatchdog(15_000, host.environment);
    watchdog.watch(stalled);

    watchdog.note(10_000, 20_000);
    watchdog.suspend();
    host.advance(600_000);

    expect(stalled).not.toHaveBeenCalled();
  });

  it('arms nothing until playback has actually reported once', () => {
    const host = controllable();
    const stalled = vi.fn();
    new MediaStallWatchdog(15_000, host.environment).watch(stalled);

    // A source still loading belongs to the start watchdog; judging it here
    // too would fail the same generation twice on different deadlines.
    host.advance(600_000);
    expect(stalled).not.toHaveBeenCalled();
  });
});
