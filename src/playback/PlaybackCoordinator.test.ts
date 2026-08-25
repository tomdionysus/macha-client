import { describe, expect, it, vi } from 'vitest';
import type { Player, PlaybackFailureListener, PlaybackListener } from '../platform/Platform';
import type { MediaSummary, PlaybackCapabilities, PlaybackEvent, PlaybackSource, PlaybackTimeRange } from '../types';
import type { PlaybackResolver, PlaybackSession, PlaybackUpdate } from './PlaybackResolver';
import { generationLocalPosition, PlaybackCoordinator, mergePlaybackUpdate } from './PlaybackCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakePlayer implements Player {
  listener?: PlaybackListener;
  failureListener?: PlaybackFailureListener;
  playCalls: Array<{ source: PlaybackSource; positionMs: number; startPaused: boolean }> = [];
  seekCalls: number[] = [];
  pauseCalls = 0;
  resumeCalls = 0;
  detachCalls = 0;
  stopCalls = 0;
  subtitleCalls: Array<string | undefined> = [];
  playResult: Promise<boolean> = Promise.resolve(true);
  localSeekRanges: PlaybackTimeRange[] = [];

  attach(): void {}
  detach(): void { this.detachCalls += 1; }
  play(source: PlaybackSource, positionMs = 0, startPaused = false): Promise<boolean> {
    this.playCalls.push({ source, positionMs, startPaused });
    return this.playResult;
  }
  pause(): void { this.pauseCalls += 1; }
  resume(): void { this.resumeCalls += 1; }
  seek(positionMs: number): void { this.seekCalls.push(positionMs); }
  localSeekCoverage(): readonly PlaybackTimeRange[] {
    const source = this.playCalls.at(-1)?.source;
    return source?.mode === 'direct'
      ? [{ startMs: 0, endMs: Number.POSITIVE_INFINITY }]
      : this.localSeekRanges;
  }
  setVolume(): void {}
  setSubtitle(subtitleUrl?: string): void { this.subtitleCalls.push(subtitleUrl); }
  stop(): void { this.stopCalls += 1; }
  subscribe(listener: PlaybackListener): () => void {
    this.listener = listener;
    return () => { if (this.listener === listener) this.listener = undefined; };
  }
  subscribeFailure(listener: PlaybackFailureListener): () => void {
    this.failureListener = listener;
    return () => { if (this.failureListener === listener) this.failureListener = undefined; };
  }
  emit(event: PlaybackEvent): void { this.listener?.(event); }
  fail(error: Error): void { this.failureListener?.(error); }
}

function media(): MediaSummary {
  return { id: 'tmdb:movie:1', kind: 'movie', title: 'Movie', mediaIds: ['m1'], durationMs: 600_000 };
}

function capabilities(): PlaybackCapabilities {
  return {
    platform: 'web', videoCodecs: ['h264'], audioCodecs: ['aac'], containers: ['mp4'], hls: true, dash: false, hdr: [],
  };
}

function session(overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  const mode = overrides.mode ?? 'direct';
  const seekMs = overrides.seekMs ?? 0;
  const mimeType = overrides.mimeType ?? (mode === 'direct' ? 'video/mp4' : 'application/vnd.apple.mpegurl');
  const source: PlaybackSource = overrides.source ?? {
    mediaId: 'm1', url: mode === 'direct' ? '/direct' : `/generation-${seekMs}.m3u8`, mimeType, mode, durationMs: 600_000, sizeBytes: 100_000_000,
  };
  return {
    sessionId: 's1', mediaId: 'm1', mode, mimeType, durationMs: 600_000, seekMs,
    preferences: { mode: 'auto', maxHeight: null, maxBitrate: null, audioStream: 1, subtitleStream: null, audioLanguage: '', subtitleLanguage: '' },
    sourceInfo: { path: '/movie', format: 'matroska', size: 100_000_000, bitrate: 10_000_000, streams: [] },
    output: {},
    selected: { videoStream: 0, audioStream: 1, subtitleStream: -1 },
    transform: { video: mode === 'direct' ? 'copy' : 'transcode', audio: 'copy' },
    options: { modes: ['direct', 'remux', 'transcode'], qualityHeights: [1080, 720], mediaIds: ['m1'], audioStreams: [], subtitleStreams: [], canSeek: true, canChangeQuality: true, canSwitchMedia: false },
    ...overrides,
    source,
  };
}

function resolver(initial: PlaybackSession, updateImpl?: (update: PlaybackUpdate) => Promise<PlaybackSession>): PlaybackResolver & { resolve: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  return {
    available: true,
    resolve: vi.fn(async () => initial),
    update: vi.fn(async (_sessionId: string, update: PlaybackUpdate) => updateImpl ? updateImpl(update) : initial),
    stop: vi.fn(async () => undefined),
  } as any;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PlaybackCoordinator transport invariants', () => {
  it('seeks Direct Play locally without synchronising transport state to the server', async () => {
    const player = new FakePlayer();
    const api = resolver(session());
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });
    await coordinator.start();

    expect(coordinator.seek(10_000)).toBe(true);
    expect(player.seekCalls).toEqual([10_000]);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('seeks a buffered point inside an existing transformed generation locally', async () => {
    const player = new FakePlayer();
    player.localSeekRanges = [{ startMs: 5_000, endMs: 75_000 }];
    const initial = session({ mode: 'transcode', seekMs: 30_000 });
    const api = resolver(initial);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 40_000 });
    await coordinator.start();

    coordinator.seek(50_000);
    expect(player.seekCalls).toEqual([20_000]);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('resolves a new generation when a transformed seek target is outside local coverage', async () => {
    const player = new FakePlayer();
    player.localSeekRanges = [{ startMs: 0, endMs: 60_000 }];
    const initial = session({ mode: 'transcode', seekMs: 0 });
    const api = resolver(initial, async (update) => session({
      mode: 'transcode',
      seekMs: update.seekMs ?? 0,
      source: { ...initial.source, url: `/generation-${update.seekMs ?? 0}.m3u8` },
    }));
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });
    await coordinator.start();

    coordinator.seek(240_000);

    expect(player.seekCalls).toEqual([]);
    await vi.waitFor(() => {
      expect(api.update).toHaveBeenCalledWith('s1', expect.objectContaining({ seekMs: 240_000 }));
    });
  });

  it('keeps the old source running while a backwards HLS generation is prepared', async () => {
    const player = new FakePlayer();
    const initial = session({ mode: 'transcode', seekMs: 30_000 });
    const update = deferred<PlaybackSession>();
    const api = resolver(initial, async () => update.promise);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 40_000 });
    await coordinator.start();
    const initialPlays = player.playCalls.length;

    coordinator.seek(10_000);
    expect(player.pauseCalls).toBe(0);
    expect(player.playCalls).toHaveLength(initialPlays);
    expect(api.update).toHaveBeenCalledTimes(1);

    update.resolve(session({ mode: 'transcode', seekMs: 8_000, source: { ...initial.source, url: '/generation-8000.m3u8' } }));
    await vi.waitFor(() => {
      expect(player.playCalls.at(-1)?.positionMs).toBe(2_000);
    });
  });

  it('accepts server keyframe alignment for the generation it explicitly requested without retrying forever', async () => {
    const player = new FakePlayer();
    const aligned = session({ mode: 'transcode', seekMs: 33_000 });
    const api = resolver(aligned);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 30_000 });

    await coordinator.start();
    expect(api.resolve).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(player.playCalls).toEqual([{ source: aligned.source, positionMs: 0, startPaused: false }]);
  });

  it('does not wait for media play readiness before startup orchestration completes', async () => {
    const player = new FakePlayer();
    const pendingPlay = deferred<boolean>();
    player.playResult = pendingPlay.promise;
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: resolver(session()), capabilities: async () => capabilities(), initialPositionMs: 0 });

    await coordinator.start();
    expect(coordinator.getSnapshot().starting).toBe(false);
    expect(player.playCalls).toHaveLength(1);
    pendingPlay.resolve(true);
  });

  it('accepts play/pause intent immediately while server generation work is in flight', async () => {
    const player = new FakePlayer();
    const initial = session({ mode: 'transcode', seekMs: 30_000 });
    const update = deferred<PlaybackSession>();
    const api = resolver(initial, async () => update.promise);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 40_000 });
    await coordinator.start();

    coordinator.seek(10_000);
    coordinator.setPaused(true);
    coordinator.setPaused(false);
    expect(player.pauseCalls).toBe(1);
    expect(player.resumeCalls).toBe(1);
    expect(coordinator.getSnapshot().intent.paused).toBe(false);

    update.resolve(session({ mode: 'transcode', seekMs: 8_000 }));
    await flush();
  });

  it('never lets transient media pause/play events overwrite user transport intent', async () => {
    const player = new FakePlayer();
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: resolver(session()), capabilities: async () => capabilities(), initialPositionMs: 0 });
    await coordinator.start();

    coordinator.setPaused(true);
    player.emit({ positionMs: 0, durationMs: 600_000, paused: false, ended: false });
    expect(coordinator.getSnapshot().intent.paused).toBe(true);

    coordinator.setPaused(false);
    player.emit({ positionMs: 0, durationMs: 600_000, paused: true, ended: false });
    expect(coordinator.getSnapshot().intent.paused).toBe(false);
  });

  it('holds a startup/resume target across transient zero-position source-load events', async () => {
    const player = new FakePlayer();
    const direct = session();
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: resolver(direct), capabilities: async () => capabilities(), initialPositionMs: 120_000 });
    await coordinator.start();

    player.emit({ positionMs: 0, durationMs: 600_000, paused: true, ended: false });
    expect(coordinator.getSnapshot().intent.positionMs).toBe(120_000);
    player.emit({ positionMs: 120_000, durationMs: 600_000, paused: false, ended: false });
    expect(coordinator.getSnapshot().intent.positionMs).toBe(120_000);
    player.emit({ positionMs: 121_000, durationMs: 600_000, paused: false, ended: false });
    expect(coordinator.getSnapshot().intent.positionMs).toBe(121_000);
  });

  it('maps transformed buffered ranges to absolute presentation time', async () => {
    const player = new FakePlayer();
    const transformed = session({ mode: 'transcode', seekMs: 30_000 });
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: resolver(transformed), capabilities: async () => capabilities(), initialPositionMs: 40_000 });
    await coordinator.start();

    player.emit({
      positionMs: 10_000,
      durationMs: 570_000,
      paused: false,
      ended: false,
      bufferedRangesMs: [{ startMs: 5_000, endMs: 75_000 }],
      forwardBufferMs: 65_000,
    });
    expect(coordinator.getSnapshot().event.bufferedRangesMs).toEqual([{ startMs: 35_000, endMs: 105_000 }]);
    expect(coordinator.getSnapshot().event.forwardBufferMs).toBe(65_000);
  });
});


describe('PlaybackCoordinator startup intent', () => {
  it('activates a source paused when pause intent arrives while initial generation is resolving', async () => {
    const player = new FakePlayer();
    const pending = deferred<PlaybackSession>();
    const api = resolver(session());
    api.resolve.mockImplementation(async () => pending.promise);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });

    const starting = coordinator.start();
    await flush();
    coordinator.setPaused(true);
    pending.resolve(session());
    await starting;

    expect(player.playCalls.at(-1)?.startPaused).toBe(true);
    expect(coordinator.getSnapshot().intent.paused).toBe(true);
  });

  it('preserves the latest seek issued while the initial generation is resolving', async () => {
    const player = new FakePlayer();
    const pending = deferred<PlaybackSession>();
    const api = resolver(session());
    api.resolve.mockImplementation(async () => pending.promise);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });

    const starting = coordinator.start();
    await flush();
    coordinator.seek(20_000);
    pending.resolve(session());
    await starting;

    expect(api.update).not.toHaveBeenCalled();
    expect(player.playCalls.at(-1)?.positionMs).toBe(20_000);
    expect(coordinator.getSnapshot().intent.positionMs).toBe(20_000);
  });
});

describe('PlaybackCoordinator coalescence', () => {
  it('coalesces pending representation updates around the latest intent', async () => {
    const player = new FakePlayer();
    player.localSeekRanges = [{ startMs: 0, endMs: 60_000 }];
    const initial = session({ mode: 'transcode', seekMs: 0 });
    const first = deferred<PlaybackSession>();
    const updates: PlaybackUpdate[] = [];
    let count = 0;
    const api = resolver(initial, async (update) => {
      updates.push(update);
      count += 1;
      if (count === 1) return first.promise;
      return session({ mode: 'transcode', seekMs: update.seekMs ?? 0, preferences: { ...initial.preferences, ...update.preferences } });
    });
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });
    await coordinator.start();

    coordinator.update({ preferences: { maxHeight: 720 } });
    coordinator.update({ preferences: { audioStream: 2, audioLanguage: '' } });
    coordinator.seek(50_000); // local in current generation; latest transport intent must survive source prep.

    first.resolve(session({ mode: 'transcode', seekMs: 0, preferences: { ...initial.preferences, maxHeight: 720 } }));
    await vi.waitFor(() => {
      expect(updates.length).toBe(2);
    });

    expect(coordinator.getSnapshot().event.positionMs).toBe(50_000);
    expect(updates.at(-1)?.seekMs).toBe(50_000);
    expect(updates.at(-1)?.preferences).toMatchObject({ audioStream: 2, audioLanguage: '' });
    expect(player.playCalls.at(-1)?.positionMs).toBe(0);
    expect(coordinator.getSnapshot().intent.positionMs).toBe(50_000);
  });

  it('merges playback updates without losing orthogonal preferences', () => {
    expect(mergePlaybackUpdate(
      { preferences: { mode: 'remux', maxHeight: 1080 } },
      { preferences: { audioStream: 2, audioLanguage: '' }, mediaId: 'm2' },
    )).toEqual({ preferences: { mode: 'remux', maxHeight: 1080, audioStream: 2, audioLanguage: '' }, mediaId: 'm2' });
  });
});

describe('generationLocalPosition', () => {
  it('maps transformed Web VOD time through the generation origin', () => {
    const transformed = session({ mode: 'remux', seekMs: 30_000 });
    expect(generationLocalPosition(transformed, 40_000)).toBe(10_000);
    expect(generationLocalPosition(transformed, 29_999)).toBeUndefined();
  });
});


describe('PlaybackCoordinator player failures', () => {
  it('promotes a terminal platform-source failure into coordinator fatal state', async () => {
    const player = new FakePlayer();
    const api = resolver(session({ mode: 'transcode' }));
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });
    await coordinator.start();

    player.fail(new Error('Web HLS media recovery exhausted'));

    expect(coordinator.getSnapshot().fatalError?.message).toBe('Web HLS media recovery exhausted');
    expect(coordinator.getSnapshot().starting).toBe(false);
  });
});


describe('PlaybackCoordinator lease teardown', () => {
  it('waits for an in-flight session create and deletes the late lease before close resolves', async () => {
    const player = new FakePlayer();
    const pending = deferred<PlaybackSession>();
    const api = resolver(session());
    api.resolve.mockImplementationOnce(async () => pending.promise);
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });

    const starting = coordinator.start();
    await vi.waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));
    const closing = coordinator.close();
    pending.resolve(session());
    await Promise.all([starting, closing]);

    expect(api.stop).toHaveBeenCalledWith('s1', {});
    expect(player.playCalls).toHaveLength(0);
    expect(player.stopCalls).toBe(1);
    expect(player.detachCalls).toBe(0);
  });

  it('propagates keepalive to the owned lease teardown', async () => {
    const player = new FakePlayer();
    const api = resolver(session());
    const coordinator = new PlaybackCoordinator({ media: media(), player, resolver: api, capabilities: async () => capabilities(), initialPositionMs: 0 });
    await coordinator.start();

    await coordinator.close({ keepalive: true });

    expect(api.stop).toHaveBeenCalledWith('s1', { keepalive: true });
  });
});
