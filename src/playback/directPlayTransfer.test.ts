import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  directPlayReadAheadUrl,
  releaseDirectPlayReadAhead,
  setDirectPlayTransferListener,
  type DirectPlayReadAheadMetrics,
} from './directPlayReadAhead';

/**
 * The worker posts cumulative counters, so the interesting behaviour is
 * entirely in what the page does *between* two messages. These drive the
 * message listener the way the Service Worker does.
 */
function metrics(over: Partial<DirectPlayReadAheadMetrics> = {}): DirectPlayReadAheadMetrics {
  return {
    sourceOrigin: 'http://node-a.test:7438',
    fetchedBytes: 0, servedBytes: 0, cacheHitBytes: 0, residentBytes: 0, aheadBytes: 0,
    activeFetches: 0, peakFetches: 0, lastFetchMbps: 0, fetchActiveMs: 0,
    demandWaitCount: 0, demandWaitMs: 0, demandFetches: 0, demandBytes: 0,
    demandFirstByteMs: 0, demandBlockedByPrefetchMs: 0,
    prefetchFetches: 0, prefetchBytes: 0, prefetchAbortsForDemand: 0,
    generation: 1, mode: 'playing',
    ...over,
  };
}

/**
 * Stand in for the Service Worker so the real listener wiring is exercised.
 *
 * Installed once for the file, deliberately: the module registers its
 * `message` listener behind a one-shot guard, so a per-test stub would leave
 * every test after the first talking to a `navigator` the module never
 * subscribed to — and passing, silently, for the cases that assert nothing
 * happens.
 */
function workerHost() {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const controller = { postMessage: vi.fn() };
  vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'http://localhost:5173' } });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      controller,
      addEventListener: (_: string, listener: (event: MessageEvent<unknown>) => void) => listeners.add(listener),
      register: vi.fn(),
    },
  });
  return {
    post(sourceKey: string, value: DirectPlayReadAheadMetrics) {
      for (const listener of listeners) {
        listener({ data: { type: 'macha-direct-read-ahead-metrics', sourceKey, metrics: value } } as MessageEvent<unknown>);
      }
    },
  };
}

let host: ReturnType<typeof workerHost>;
beforeAll(() => { host = workerHost(); });
afterEach(() => setDirectPlayTransferListener(undefined));

describe('direct play media throughput reporting', () => {
  it('reports only the bytes and transfer time added since the last message', () => {
    const seen: Array<[string, number, number]> = [];
    setDirectPlayTransferListener((origin, bytes, durationMs) => seen.push([origin, bytes, durationMs]));
    const source = subscribedSource();

    host.post(source, metrics({ fetchedBytes: 4_000_000, fetchActiveMs: 1_000 }));
    host.post(source, metrics({ fetchedBytes: 10_000_000, fetchActiveMs: 3_000 }));

    // The first message establishes a baseline and reports nothing: its
    // counters describe transfers that happened before anyone was listening.
    expect(seen).toEqual([['http://node-a.test:7438', 6_000_000, 2_000]]);
  });

  it('divides by transfer time, not wall time', () => {
    const seen: Array<[string, number, number]> = [];
    setDirectPlayTransferListener((origin, bytes, durationMs) => seen.push([origin, bytes, durationMs]));
    const source = subscribedSource();

    host.post(source, metrics({ fetchedBytes: 1_000_000, fetchActiveMs: 500 }));
    // Two minutes of wall clock pass with the buffer full and nothing fetched,
    // then 8 MB arrives in a second. Wall time would call this ~0.07 MB/s; the
    // link actually carried 8 MB/s and that is what ranking must be told.
    host.post(source, metrics({ fetchedBytes: 9_000_000, fetchActiveMs: 1_500 }));

    expect(seen).toEqual([['http://node-a.test:7438', 8_000_000, 1_000]]);
  });

  it('ignores an idle window that moved no bytes', () => {
    const seen: unknown[] = [];
    setDirectPlayTransferListener((...args) => seen.push(args));
    const source = subscribedSource();

    host.post(source, metrics({ fetchedBytes: 5_000_000, fetchActiveMs: 1_000 }));
    host.post(source, metrics({ fetchedBytes: 5_000_000, fetchActiveMs: 1_000 }));

    expect(seen).toHaveLength(0);
  });

  it('does not report negative traffic when the worker resets its counters', () => {
    const seen: unknown[] = [];
    setDirectPlayTransferListener((...args) => seen.push(args));
    const source = subscribedSource();

    host.post(source, metrics({ fetchedBytes: 9_000_000, fetchActiveMs: 3_000 }));
    // A new generation for the same source restarts the counters. Treating the
    // decrease as a delta would report a negative transfer; treating it as a
    // new baseline is the only reading that is ever true.
    host.post(source, metrics({ fetchedBytes: 1_000_000, fetchActiveMs: 400 }));
    host.post(source, metrics({ fetchedBytes: 3_000_000, fetchActiveMs: 900 }));

    expect(seen).toEqual([[ 'http://node-a.test:7438', 2_000_000, 500 ]]);
  });

  it('says nothing when the worker cannot name the node it fetched from', () => {
    const seen: unknown[] = [];
    setDirectPlayTransferListener((...args) => seen.push(args));
    const source = subscribedSource();

    host.post(source, metrics({ sourceOrigin: '', fetchedBytes: 1_000_000, fetchActiveMs: 100 }));
    host.post(source, metrics({ sourceOrigin: '', fetchedBytes: 9_000_000, fetchActiveMs: 1_100 }));

    // Throughput with no endpoint to attribute it to is not evidence about any
    // endpoint, and guessing would credit whichever node happened to be first.
    expect(seen).toHaveLength(0);
  });
});

/**
 * Register a source through the module's real entry point, so posted metrics
 * resolve to a URL the same way they do in production. The key is opaque; only
 * the module's own mapping matters.
 */
let sourceSequence = 0;
function subscribedSource(): string {
  const sourceUrl = `http://node-a.test:7438/api/v1/playback/stream/s${sourceSequence += 1}/direct`;
  releaseDirectPlayReadAhead(sourceUrl);
  directPlayReadAheadUrl({
    mediaId: 'm1', url: sourceUrl, isManifest: false, mimeType: 'video/mp4',
    mode: 'direct', sizeBytes: 1_000_000_000,
  });
  const controller = (navigator as unknown as {
    serviceWorker: { controller: { postMessage: { mock: { calls: Array<[{ sourceKey: string }]> } } } };
  }).serviceWorker.controller;
  const calls = controller.postMessage.mock.calls;
  return calls[calls.length - 1][0].sourceKey;
}
