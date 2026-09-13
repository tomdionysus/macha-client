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
