import { describe, expect, it } from 'vitest';
import { appendQueuedPlaybackControl, isSubtitleOnlyUpdate, startupTransformedServerSeekTarget, webSeekDeltaForKey, webSeekHasResumed, webTransformedLocalSeekPosition } from './PlayerScreen';
import { nextDesiredSeekPosition, preserveSeekSubtitleState } from '../playback/SeekState';

describe('isSubtitleOnlyUpdate', () => {
  it('recognises subtitle selection and disable patches', () => {
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: 5, subtitleLanguage: '' } })).toBe(true);
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: null, subtitleLanguage: '' } })).toBe(true);
  });

  it('does not classify seeks or other representation changes as subtitle-only', () => {
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: 5 }, seekMs: 12_000 })).toBe(false);
    expect(isSubtitleOnlyUpdate({ preferences: { audioStream: 2 } })).toBe(false);
    expect(isSubtitleOnlyUpdate({ preferences: { mode: 'transcode', subtitleStream: 5 } })).toBe(false);
    expect(isSubtitleOnlyUpdate({ mediaId: 'file:other', preferences: { subtitleStream: 5 } })).toBe(false);
  });
});


describe('queued player controls', () => {
  it('coalesces consecutive seeks so the latest user intent wins', () => {
    let queue = appendQueuedPlaybackControl([], { kind: 'seek', positionMs: 10_000 });
    queue = appendQueuedPlaybackControl(queue, { kind: 'seek', positionMs: 20_000 });
    queue = appendQueuedPlaybackControl(queue, { kind: 'seek', positionMs: 30_000 });
    expect(queue).toEqual([{ kind: 'seek', positionMs: 30_000 }]);
  });

  it('merges consecutive representation changes without crossing a seek boundary', () => {
    let queue = appendQueuedPlaybackControl([], { kind: 'update', update: { preferences: { mode: 'remux' } } });
    queue = appendQueuedPlaybackControl(queue, { kind: 'update', update: { preferences: { audioStream: 2, audioLanguage: '' } } });
    expect(queue).toEqual([{ kind: 'update', update: { preferences: { mode: 'remux', audioStream: 2, audioLanguage: '' } } }]);

    queue = appendQueuedPlaybackControl(queue, { kind: 'seek', positionMs: 42_000 });
    queue = appendQueuedPlaybackControl(queue, { kind: 'update', update: { preferences: { subtitleStream: 5 } } });
    expect(queue.map((item) => item.kind)).toEqual(['update', 'seek', 'update']);
  });
});


describe('Web player seek UX', () => {
  it('maps the left and right arrows to ten-second seeks', () => {
    expect(webSeekDeltaForKey('ArrowLeft')).toBe(-10_000);
    expect(webSeekDeltaForKey('ArrowRight')).toBe(10_000);
    expect(webSeekDeltaForKey('ArrowUp')).toBeUndefined();
  });

  it('does not consider an optimistic seek resumed while the browser is seeking or buffering', () => {
    const base = { positionMs: 42_000, durationMs: 120_000, paused: false, ended: false };
    expect(webSeekHasResumed({ ...base, seeking: true, buffering: true }, 42_000, true)).toBe(false);
    expect(webSeekHasResumed({ ...base, seeking: false, buffering: true }, 42_000, true)).toBe(false);
    expect(webSeekHasResumed({ ...base, seeking: false, buffering: false }, 42_000, true)).toBe(true);
  });

  it('considers a paused seek complete once the browser has resolved the target', () => {
    expect(webSeekHasResumed({
      positionMs: 42_000,
      durationMs: 120_000,
      paused: true,
      ended: false,
      seeking: false,
      buffering: false,
    }, 42_000, false)).toBe(true);
  });


  it('accumulates repeated skip input against the desired position rather than stale player time', () => {
    const actual = 120_000;
    const first = nextDesiredSeekPosition(undefined, actual, -10_000, 600_000);
    const second = nextDesiredSeekPosition(first, actual, -10_000, 600_000);
    const third = nextDesiredSeekPosition(second, actual, -10_000, 600_000);
    expect([first, second, third]).toEqual([110_000, 100_000, 90_000]);
  });

  it('clamps desired skip targets to the media bounds', () => {
    expect(nextDesiredSeekPosition(5_000, 5_000, -10_000, 60_000)).toBe(0);
    expect(nextDesiredSeekPosition(55_000, 55_000, 10_000, 60_000)).toBe(60_000);
  });

  it('maps Web transformed HLS seeks into the current VOD generation', () => {
    const session = { mode: 'transcode', mimeType: 'application/vnd.apple.mpegurl', seekMs: 30_000 } as any;
    expect(webTransformedLocalSeekPosition(session, 30_000)).toBe(0);
    expect(webTransformedLocalSeekPosition(session, 40_000)).toBe(10_000);
    expect(webTransformedLocalSeekPosition(session, 120_000)).toBe(90_000);
  });

  it('accepts the server-aligned generation for the startup request already made', () => {
    const session = { mode: 'transcode', mimeType: 'application/vnd.apple.mpegurl', seekMs: 33_000 } as any;
    expect(startupTransformedServerSeekTarget(session, 30_000, 30_000, true)).toBeUndefined();
  });

  it('only reissues startup seek for a newer target outside the returned generation', () => {
    const session = { mode: 'transcode', mimeType: 'application/vnd.apple.mpegurl', seekMs: 33_000 } as any;
    expect(startupTransformedServerSeekTarget(session, 45_000, 30_000, true)).toBeUndefined();
    expect(startupTransformedServerSeekTarget(session, 20_000, 30_000, true)).toBe(20_000);
  });

  it('requires a new transformed generation only when seeking before its start', () => {
    const session = { mode: 'remux', mimeType: 'application/vnd.apple.mpegurl', seekMs: 30_000 } as any;
    expect(webTransformedLocalSeekPosition(session, 29_999)).toBeUndefined();
    expect(webTransformedLocalSeekPosition({ ...session, mode: 'direct' }, 40_000)).toBeUndefined();
    expect(webTransformedLocalSeekPosition({ ...session, mimeType: 'video/mp4' }, 40_000)).toBeUndefined();
  });
});


describe('seek session state preservation', () => {
  it('keeps selected streams/preferences and an existing subtitle resource across seek-only responses', () => {
    const current = {
      sessionId: 's1', mediaId: 'm1', mode: 'direct', mimeType: 'video/x-matroska', durationMs: 100_000, seekMs: 0,
      source: { mediaId: 'm1', url: '/direct', subtitleUrl: '/subtitle/current', mimeType: 'video/x-matroska', mode: 'direct', durationMs: 100_000 },
      preferences: { mode: 'auto', maxHeight: null, maxBitrate: null, audioStream: 2, subtitleStream: 5, audioLanguage: '', subtitleLanguage: 'eng' },
      selected: { videoStream: 0, audioStream: 2, subtitleStream: 5 },
      sourceInfo: { path: 'x', format: 'matroska', size: 1, bitrate: 1, streams: [] },
      output: {}, transform: { video: 'copy', audio: 'copy' },
      options: { modes: ['direct'], qualityHeights: [], mediaIds: [], audioStreams: [], subtitleStreams: [], canSeek: true, canChangeQuality: false, canSwitchMedia: false },
    } as any;
    const returned = {
      ...current,
      seekMs: 42_000,
      source: { ...current.source, subtitleUrl: undefined },
      preferences: { ...current.preferences, audioStream: null, subtitleStream: null, subtitleLanguage: '' },
      selected: { videoStream: 0, audioStream: 1, subtitleStream: -1 },
    };

    const preserved = preserveSeekSubtitleState(current, returned);
    expect(preserved.seekMs).toBe(42_000);
    expect(preserved.selected.audioStream).toBe(1);
    expect(preserved.selected.subtitleStream).toBe(5);
    expect(preserved.preferences.audioStream).toBeNull();
    expect(preserved.preferences.subtitleStream).toBe(5);
    expect(preserved.preferences.subtitleLanguage).toBe('eng');
    expect(preserved.source.subtitleUrl).toBe('/subtitle/current');
  });

  it('prefers a fresh subtitle resource from a transformed seek generation', () => {
    const current = {
      sessionId: 's1', mediaId: 'm1', mode: 'remux', mimeType: 'application/vnd.apple.mpegurl', durationMs: 100_000, seekMs: 0,
      source: { mediaId: 'm1', url: '/old.m3u8', subtitleUrl: '/subtitle/old', mimeType: 'application/vnd.apple.mpegurl', mode: 'remux', durationMs: 100_000 },
      preferences: { mode: 'remux', maxHeight: null, maxBitrate: null, audioStream: 1, subtitleStream: 5, audioLanguage: '', subtitleLanguage: 'eng' },
      selected: { videoStream: 0, audioStream: 1, subtitleStream: 5 },
      sourceInfo: { path: 'x', format: 'matroska', size: 1, bitrate: 1, streams: [] }, output: {}, transform: { video: 'copy', audio: 'copy' },
      options: { modes: ['remux'], qualityHeights: [], mediaIds: [], audioStreams: [], subtitleStreams: [], canSeek: true, canChangeQuality: false, canSwitchMedia: false },
    } as any;
    const returned = { ...current, seekMs: 42_000, source: { ...current.source, url: '/new.m3u8', subtitleUrl: '/subtitle/new' } };
    expect(preserveSeekSubtitleState(current, returned).source.subtitleUrl).toBe('/subtitle/new');
  });
});
