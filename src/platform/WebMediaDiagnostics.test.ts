import { describe, expect, it, vi } from 'vitest';
import { WebMediaDiagnostics } from './WebMediaDiagnostics';
import type { ClientLogger } from '@machafoundation/core';

function recorder() {
  const warnings: Array<{ event: string; data?: unknown }> = [];
  const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event: string, data?: unknown) => { warnings.push({ event, data }); },
    error: () => undefined,
  } as unknown as ClientLogger;
  return { warnings, log };
}

function fakeVideo() {
  const listeners = new Map<string, Array<() => void>>();
  const emptyRanges = { length: 0, start: () => 0, end: () => 0 } as unknown as TimeRanges;
  const video = {
    addEventListener: (name: string, handler: () => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), handler]);
    },
    emit: (name: string) => { for (const handler of listeners.get(name) ?? []) handler(); },
    webkitAudioDecodedByteCount: 0,
    webkitVideoDecodedByteCount: 0,
    currentTime: 0, duration: 600, paused: false, ended: false, seeking: false,
    readyState: 4, networkState: 2, buffered: emptyRanges, seekable: emptyRanges,
    playbackRate: 1, currentSrc: 'http://node.test/media.m3u8', error: null,
  };
  return video as typeof video & HTMLVideoElement;
}

describe('sound stopping while the picture carries on', () => {
  /** The one fault no other channel can see: nothing is emitted and nothing stalls. */
  function play(video: ReturnType<typeof fakeVideo>, audioBytes: number, videoBytes: number, atMs: number) {
    vi.spyOn(performance, 'now').mockReturnValue(atMs);
    video.webkitAudioDecodedByteCount = audioBytes;
    video.webkitVideoDecodedByteCount = videoBytes;
    video.emit('timeupdate');
  }

  it('reports audio bytes frozen while video bytes climb, once, after real evidence', () => {
    const { warnings, log } = recorder();
    const video = fakeVideo();
    new WebMediaDiagnostics(log).attach(video, () => undefined);

    play(video, 1_000, 10_000, 0);
    play(video, 2_000, 20_000, 1_000);
    // Audio stops here; the picture keeps decoding.
    play(video, 2_000, 30_000, 2_000);
    play(video, 2_000, 40_000, 5_000);
    expect(warnings.filter((entry) => entry.event === 'media-audio-decode-stopped')).toHaveLength(0);

    // Six seconds after the audio stopped, which is the first sample past the
    // evidence threshold — not the first sample after it stopped.
    play(video, 2_000, 50_000, 8_000);
    play(video, 2_000, 60_000, 11_000);
    const reported = warnings.filter((entry) => entry.event === 'media-audio-decode-stopped');
    expect(reported).toHaveLength(1);
    expect(reported[0].data).toMatchObject({
      decodedBytes: { audio: 2_000, video: 50_000 },
      silentForMs: 6_000,
    });
  });

  it('says nothing while both pipelines are moving, however quiet the film is', () => {
    // Encoded silence is still decoded bytes, so a quiet passage never looks
    // like a stopped decoder.
    const { warnings, log } = recorder();
    const video = fakeVideo();
    new WebMediaDiagnostics(log).attach(video, () => undefined);

    for (let step = 0; step < 12; step += 1) play(video, 1_000 * step, 10_000 * step, step * 2_000);

    expect(warnings.filter((entry) => entry.event === 'media-audio-decode-stopped')).toHaveLength(0);
  });

  it('never judges a paused or seeking element, and forgets the first source on the next', () => {
    const { warnings, log } = recorder();
    const video = fakeVideo();
    new WebMediaDiagnostics(log).attach(video, () => undefined);

    play(video, 1_000, 10_000, 0);
    video.paused = true;
    play(video, 1_000, 20_000, 3_000);
    play(video, 1_000, 30_000, 20_000);
    expect(warnings.filter((entry) => entry.event === 'media-audio-decode-stopped')).toHaveLength(0);

    // A new source resets the element's counters; the comparison must reset too.
    video.paused = false;
    video.emit('emptied');
    play(video, 0, 0, 30_000);
    play(video, 500, 5_000, 32_000);
    expect(warnings.filter((entry) => entry.event === 'media-audio-decode-stopped')).toHaveLength(0);
  });

  it('says nothing at all on an engine that does not expose the counters', () => {
    const { warnings, log } = recorder();
    const video = fakeVideo();
    delete (video as { webkitAudioDecodedByteCount?: unknown }).webkitAudioDecodedByteCount;
    new WebMediaDiagnostics(log).attach(video, () => undefined);

    for (let step = 0; step < 12; step += 1) {
      vi.spyOn(performance, 'now').mockReturnValue(step * 2_000);
      video.webkitVideoDecodedByteCount = 10_000 * step;
      video.emit('timeupdate');
    }

    expect(warnings.filter((entry) => entry.event === 'media-audio-decode-stopped')).toHaveLength(0);
  });
});

describe('the picture holding while the clock runs on', () => {
  /** The seek P0's freeze: sound continuing, picture still, nothing emitted. */
  function withFrames(video: ReturnType<typeof fakeVideo>) {
    const quality = { totalVideoFrames: 0, droppedVideoFrames: 0 };
    Object.assign(video, { getVideoPlaybackQuality: () => ({ ...quality }) });
    return quality;
  }

  function tick(video: ReturnType<typeof fakeVideo>, quality: { totalVideoFrames: number }, frames: number, clockS: number, atMs: number) {
    vi.spyOn(performance, 'now').mockReturnValue(atMs);
    quality.totalVideoFrames = frames;
    video.currentTime = clockS;
    video.emit('timeupdate');
  }

  function rangesOf(pairs: Array<[number, number]>): TimeRanges {
    return { length: pairs.length, start: (index: number) => pairs[index][0], end: (index: number) => pairs[index][1] } as unknown as TimeRanges;
  }

  it('reports frames frozen while the clock advances, with each track, and again when it ends', () => {
    const { warnings, log } = recorder();
    const video = fakeVideo();
    const quality = withFrames(video);
    const tracks = { audio: { buffered: rangesOf([[10, 70]]) }, video: { buffered: rangesOf([[10, 12.5]]) } };
    new WebMediaDiagnostics(log).attach(video, () => undefined, () => tracks);

    tick(video, quality, 100, 10, 0);
    tick(video, quality, 106, 10.25, 250);
    // The picture stops at 106 frames; the clock does not.
    tick(video, quality, 106, 10.5, 500);
    tick(video, quality, 106, 11.5, 1_500);
    expect(warnings.filter((entry) => entry.event === 'media-picture-stopped')).toHaveLength(0);

    tick(video, quality, 106, 12.25, 2_250);
    tick(video, quality, 106, 13, 3_000);
    const stopped = warnings.filter((entry) => entry.event === 'media-picture-stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].data).toMatchObject({
      frozenForMs: 1_750,
      clockAdvancedMs: 2_000,
      frames: { total: 106, dropped: 0 },
      trackBuffered: { audio: [{ start: 10, end: 70 }], video: [{ start: 10, end: 12.5 }] },
    });

    tick(video, quality, 112, 13.25, 3_250);
    const resumed = warnings.filter((entry) => entry.event === 'media-picture-resumed');
    expect(resumed).toHaveLength(1);
    expect(resumed[0].data).toMatchObject({ frozenForMs: 2_750, frames: { total: 112 } });
  });

  it('leaves a clock that stopped to the stall watchdog, and never judges a paused or hidden page', () => {
    const { warnings, log } = recorder();
    const video = fakeVideo();
    const quality = withFrames(video);
    new WebMediaDiagnostics(log).attach(video, () => undefined);

    tick(video, quality, 100, 10, 0);
    for (let step = 1; step < 10; step += 1) tick(video, quality, 100, 10, step * 1_000);
    video.paused = true;
    for (let step = 10; step < 20; step += 1) tick(video, quality, 100, step, step * 1_000);
    video.paused = false;
    vi.stubGlobal('document', { hidden: true });
    for (let step = 20; step < 30; step += 1) tick(video, quality, 100, step, step * 1_000);
    vi.unstubAllGlobals();

    expect(warnings.filter((entry) => entry.event.startsWith('media-picture-'))).toHaveLength(0);
  });

  it('sees a freeze on one element while another, which a handover has live at once, plays', () => {
    const { warnings, log } = recorder();
    const outgoing = fakeVideo();
    const incoming = fakeVideo();
    const outgoingFrames = withFrames(outgoing);
    const incomingFrames = withFrames(incoming);
    const diagnostics = new WebMediaDiagnostics(log);
    diagnostics.attach(outgoing, () => undefined);
    diagnostics.attach(incoming, () => undefined);

    // The outgoing picture holds at 106 frames while its clock runs; the
    // incoming element decodes normally. Sampled interleaved, a shared
    // previous sample makes every outgoing sample look like progress.
    for (let step = 0; step < 12; step += 1) {
      tick(outgoing, outgoingFrames, 106, 100 + step * 0.25, step * 250);
      tick(incoming, incomingFrames, step * 6, step * 0.25, step * 250 + 1);
    }

    expect(warnings.filter((entry) => entry.event === 'media-picture-stopped')).toHaveLength(1);
    expect(warnings.filter((entry) => entry.event.startsWith('media-picture-'))).toHaveLength(1);
  });

  it('says a track whose buffer has gone is gone, rather than throwing', () => {
    const { warnings, log } = recorder();
    const video = fakeVideo();
    const quality = withFrames(video);
    const removed = { get buffered(): TimeRanges { throw new DOMException('removed', 'InvalidStateError'); } };
    new WebMediaDiagnostics(log).attach(video, () => undefined, () => ({ video: removed }));

    tick(video, quality, 100, 10, 0);
    tick(video, quality, 100, 10.5, 500);
    tick(video, quality, 100, 11, 1_000);
    tick(video, quality, 100, 12, 2_000);

    expect(warnings.find((entry) => entry.event === 'media-picture-stopped')?.data).toMatchObject({ trackBuffered: { video: 'removed' } });
  });
});
