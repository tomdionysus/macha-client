import { describe, expect, it } from 'vitest';
import { boundedPlayerSeekTarget, modesToOffer, firstUsableDurationMs, preparingStreamText, startWaitNotice, playerBackAction, playerBufferedTimelineEnabled, playerControlShowsPlay, playerMediaSubtitle, samsungTransportSeekDirection, webSeekDeltaForKey } from './PlayerScreen';
import type { MediaSummary, OfferedMode, PlaybackCapabilities, PlaybackSession } from '@machafoundation/core';

describe('player UI transport bindings', () => {
  it('maps Web left/right arrows to ten-second seeks', () => {
    expect(webSeekDeltaForKey('ArrowLeft')).toBe(-10_000);
    expect(webSeekDeltaForKey('ArrowRight')).toBe(10_000);
    expect(webSeekDeltaForKey('ArrowUp')).toBeUndefined();
  });

  it('reads transport direction from both key names and the legacy keyCode', () => {
    expect(samsungTransportSeekDirection('ArrowLeft', 37, true)).toBe(-1);
    expect(samsungTransportSeekDirection('Left', 0, true)).toBe(-1);
    expect(samsungTransportSeekDirection('', 37, true)).toBe(-1);
    expect(samsungTransportSeekDirection('ArrowRight', 39, true)).toBe(1);
    expect(samsungTransportSeekDirection('Right', 0, true)).toBe(1);
    expect(samsungTransportSeekDirection('', 39, true)).toBe(1);
    expect(samsungTransportSeekDirection('ArrowUp', 38, true)).toBeUndefined();
  });

  it('yields left/right to control-row navigation when transport is not active', () => {
    expect(samsungTransportSeekDirection('ArrowLeft', 37, false)).toBeUndefined();
    expect(samsungTransportSeekDirection('ArrowRight', 39, false)).toBeUndefined();
  });

  it('bounds repeated Samsung slider seeks at both ends of the media', () => {
    let forward = 35_000;
    for (let press = 0; press < 20; press += 1) forward = boundedPlayerSeekTarget(forward, 10_000, 60_000);
    expect(forward).toBe(60_000);

    let backward = 25_000;
    for (let press = 0; press < 20; press += 1) backward = boundedPlayerSeekTarget(backward, -10_000, 60_000);
    expect(backward).toBe(0);
  });

  it('does not render buffered timeline ranges in the Samsung build', () => {
    expect(playerBufferedTimelineEnabled(true)).toBe(false);
    expect(playerBufferedTimelineEnabled(false)).toBe(true);
  });

  it('presents Play after terminal failure so the failed intent can be retried', () => {
    expect(playerControlShowsPlay(false, true)).toBe(true);
    expect(playerControlShowsPlay(false, false)).toBe(false);
    expect(playerControlShowsPlay(true, false)).toBe(true);
  });

  it('minimizes on back only where a pointer can reach a mini player, closes everywhere else', () => {
    expect(playerBackAction(true)).toBe('minimize');
    expect(playerBackAction(false)).toBe('stop');
  });

  describe('player bar subtitle', () => {
    function movie(fields: Partial<MediaSummary> = {}): MediaSummary {
      return { id: 'm1', kind: 'movie', title: 'Ratatouille', mediaIds: ['file:m1'], ...fields };
    }

    it('shows the year under a movie title, where the catalogue supplies one', () => {
      expect(playerMediaSubtitle(movie({ year: 2007 }))).toBe('2007');
    });

    it('shows nothing rather than an empty line when a movie has no year', () => {
      expect(playerMediaSubtitle(movie())).toBeUndefined();
    });

    it('leaves the episode line as series plus episode number', () => {
      const episode: MediaSummary = {
        id: 'e1',
        kind: 'episode',
        title: 'Pilot',
        seasonNumber: 1,
        episodeNumber: 1,
        year: 2005,
        mediaIds: ['file:e1'],
        playbackContext: { series: { id: 's1', title: 'The Show' }, season: { id: 'se1', title: 'Season 1', seasonNumber: 1 } },
      };
      // The episode's year stays out.
      expect(playerMediaSubtitle(episode)).toBe('The Show S01E01');
    });

    it('leaves a track showing its track number, not its year', () => {
      expect(playerMediaSubtitle({ id: 't1', kind: 'track', title: 'Song', trackNumber: 3, year: 1999, mediaIds: ['file:t1'] })).toBe('Track 3');
    });
  });
});

describe('the duration the scrubber renders and divides by', () => {
  it('takes the first stated duration in preference order', () => {
    expect(firstUsableDurationMs(5_025_000, 1_000, 2_000)).toBe(5_025_000);
    expect(firstUsableDurationMs(undefined, 1_000, 2_000)).toBe(1_000);
    expect(firstUsableDurationMs(undefined, undefined, 2_000)).toBe(2_000);
  });

  it('refuses a duration that cannot be rendered or divided by', () => {
    // `Infinity` is truthy, so a plain `a || b || 1` would pass it to the formatter.
    expect(firstUsableDurationMs(Number.NaN, 90_000)).toBe(90_000);
    expect(firstUsableDurationMs(Number.POSITIVE_INFINITY, 90_000)).toBe(90_000);
    expect(firstUsableDurationMs(0, 90_000)).toBe(90_000);
    expect(firstUsableDurationMs(-1, 90_000)).toBe(90_000);
  });

  it('falls back to a divisible one rather than to nothing', () => {
    // `playedPercent` divides by this, and no reported duration is the ordinary state before the first event.
    expect(firstUsableDurationMs(undefined, Number.NaN, Number.POSITIVE_INFINITY)).toBe(1);
    expect(firstUsableDurationMs()).toBe(1);
  });
});

describe('what to tell a viewer whose title has not started yet', () => {
  it('says nothing while a start is still ordinary', () => {
    // Most starts take a second or two; a message that flashes up reads as a fault.
    expect(startWaitNotice(true, 0)).toBeUndefined();
    expect(startWaitNotice(true, 4_999)).toBeUndefined();
  });

  it('names what is being waited for, and how long it has been', () => {
    // Nothing bounds the sum of the three start phases, so a cold node can legitimately take most of a minute.
    expect(startWaitNotice(true, 5_000)).toBe('Waiting for the node to start the stream — 5s');
    expect(startWaitNotice(true, 12_400)).toBe('Waiting for the node to start the stream — 12s');
  });

  it('says nothing about a rebuffer', () => {
    // A rebuffer has the picture behind it; a timer would announce every brief hesitation.
    expect(startWaitNotice(false, 30_000)).toBeUndefined();
  });

  it('says what the node reports it is doing, when it reports that, after the same delay', () => {
    expect(startWaitNotice(true, 4_999, 'Starting the stream: 60%')).toBeUndefined();
    expect(startWaitNotice(true, 9_200, 'Starting the stream: 60%')).toBe('Starting the stream: 60% — 9s');
  });
});

describe('the modes the player offers', () => {
  // An HEVC file in MP4, on a device that decodes only H.264.
  const session = {
    mediaId: 'macha:hevc', mode: 'transcode', mimeType: 'application/vnd.apple.mpegurl', durationMs: 60_000,
    sourceInfo: { path: '', format: 'mov,mp4,m4a,3gp,3g2,mj2', container: 'mp4', size: 1, bitrate: 1, streams: [
      { index: 0, type: 'video', codec: 'hevc', profile: 'Main', language: 'und', default: true, forced: false, width: 1920, height: 1080 },
      { index: 1, type: 'audio', codec: 'aac', profile: 'LC', language: 'eng', default: true, forced: false, channels: 2 },
    ] },
    output: {},
  } as unknown as PlaybackSession;
  const h264Only = {
    platform: 'web', videoCodecs: ['h264'], audioCodecs: ['aac'], hlsVideoCodecs: ['h264'], hlsAudioCodecs: ['aac'],
    containers: ['mp4'], hlsFmp4: true, hlsTs: true, dash: false, videoBitDepth: 8, hdr: [], dolbyVision: [],
  } as PlaybackCapabilities;
  const offeredOf = (modes: readonly OfferedMode[] | undefined) => modes?.filter((mode) => mode.offered).map((mode) => mode.mode);

  it('takes core\'s answer, which knows the node\'s operations, over its own', () => {
    const fromCore: OfferedMode[] = [{ mode: 'direct', offered: false, reasons: [] }, { mode: 'remux', offered: false, reasons: [] }, { mode: 'transcode', offered: true, reasons: [] }];
    expect(modesToOffer(fromCore, session, h264Only, undefined, false)).toBe(fromCore);
  });

  it('answers from the session until core\'s facts arrive, hiding what the device cannot play unless asked for everything', () => {
    expect(offeredOf(modesToOffer(undefined, session, h264Only, undefined, false))).toEqual(['transcode']);
    expect(offeredOf(modesToOffer(undefined, session, h264Only, undefined, true))).toEqual(['direct', 'remux', 'transcode']);
    expect(modesToOffer(undefined, undefined, h264Only, undefined, false)).toBeUndefined();
  });
});

describe('the status line while a new stream is prepared behind the one playing', () => {
  const progress = { progressSeq: 1, elapsedMs: 0 };

  it('names the node serving a change, which is where the new stream is built', () => {
    expect(preparingStreamText({ ...progress, kind: 'change', stage: 'encoding', outputMediaMs: 600, firstFragmentMs: 2_000 }, 'fi-1'))
      .toBe('Starting the new stream on fi-1: 30%');
  });

  it('names no node for a failover, since the one this line holds is the one being replaced', () => {
    expect(preparingStreamText({ ...progress, kind: 'start', stage: 'planning' }, 'gbni-1')).toBe('Preparing new stream…');
    expect(preparingStreamText({ ...progress, kind: 'start', stage: 'preroll', prerollDecodedMs: 1, prerollTotalMs: 2 }, 'gbni-1'))
      .toBe('Finding the start point: 50%');
    expect(preparingStreamText({ ...progress, kind: 'start', stage: 'encoding' }, 'gbni-1')).toBe('Starting the new stream…');
  });

  it('keeps the sentence it always had for a node that reports no progress', () => {
    expect(preparingStreamText(undefined, 'fi-1')).toBe('Preparing new stream on fi-1…');
    expect(preparingStreamText(undefined, undefined)).toBe('Preparing new stream…');
  });
});
