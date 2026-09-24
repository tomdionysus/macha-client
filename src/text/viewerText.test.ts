import { describe, expect, it } from 'vitest';
import { MachaConnectionError, NOT_PLAYABLE_CODE, SESSION_PROVENANCE_UNKNOWN_CODE, type MediaSummary, type PlaybackStatusDescription, type PlaybackStreamInfo } from '@machafoundation/core';
import {
  albumLabel, alphabetIndexKeyText, cardSubtitle, episodeCode, episodeLabel, playbackFailureCodeText, playbackNoticeText,
  playbackTimeText, SERVER_UNREACHABLE_TEXT, sortChoiceLabel, streamStatusText, trackNumberLabel, viewerErrorText,
} from './viewerText';

const item = (overrides: Partial<MediaSummary>) => ({ id: 'i', kind: 'movie', title: 'T', mediaIds: [], ...overrides }) as MediaSummary;

describe('media wording, now this client\'s', () => {
  it('names an episode compactly inside its season, and in full away from it', () => {
    expect(episodeCode(item({ kind: 'episode', seasonNumber: 1, episodeNumber: 4 }))).toBe('S01E04');
    expect(episodeLabel(item({ kind: 'episode', seasonNumber: 1, episodeNumber: 4 }))).toBe('Season 1 Episode 4');
    expect(episodeLabel(item({ kind: 'episode', episodeNumber: 4 }))).toBe('Episode 4');
  });

  it('numbers a track, and its disc past the first', () => {
    expect(trackNumberLabel(item({ kind: 'track', trackNumber: 9 }))).toBe('Track 9');
    expect(trackNumberLabel(item({ kind: 'track', discNumber: 2, trackNumber: 3 }))).toBe('Disc 2 · Track 3');
  });

  it('gives an album its year in brackets only when it has one', () => {
    expect(albumLabel({ album: { id: 'a', title: 'Homogenic', year: 1997 } })).toBe('Homogenic (1997)');
    expect(albumLabel({ album: { id: 'a', title: 'Homogenic' } })).toBe('Homogenic');
  });

  it('puts an album\'s artist under it, a movie\'s year, and an episode\'s code', () => {
    expect(cardSubtitle(item({ kind: 'album', musicContext: { album: { id: 'a', title: 'Homogenic' }, artist: { id: 'r', title: 'Björk' } } }))).toBe('Björk');
    expect(cardSubtitle(item({ kind: 'movie', year: 1997 }))).toBe('1997');
    expect(cardSubtitle(item({ kind: 'episode', seasonNumber: 2, episodeNumber: 10 }))).toBe('S02E10');
  });

  it('reads each sort option as Sort By <X>', () => {
    expect(sortChoiceLabel('recent')).toBe('Sort By Recently added');
  });
});

describe('playback wording, keyed on core\'s codes', () => {
  it('has a sentence for every notice code', () => {
    for (const code of ['copy-refused', 'cannot-seek', 'not-ready', 'instruction-failed', 'subtitles-loading', 'update-failed'] as const) {
      expect(playbackNoticeText({ code })).toMatch(/\w/);
    }
  });

  it('words the failure codes core no longer writes a detail for', () => {
    expect(playbackFailureCodeText(SESSION_PROVENANCE_UNKNOWN_CODE)).toBe('This stream is no longer available. Start it again.');
    expect(playbackFailureCodeText(NOT_PLAYABLE_CODE)).toMatch(/cannot be played/);
    expect(playbackFailureCodeText('something_else')).toBeUndefined();
  });

  it('keeps the scrubber clock and the catch-all index key as viewers know them', () => {
    expect(playbackTimeText(5_025_000)).toBe('1:23:45');
    expect(playbackTimeText(245_000)).toBe('4:05');
    expect(playbackTimeText(Number.NaN)).toBe('0:00');
    expect(alphabetIndexKeyText('other')).toBe('#');
  });
});

describe('what a viewer is told about an error', () => {
  it('never shows core\'s log text', () => {
    expect(viewerErrorText(new Error('Macha endpoint http://10.35.1.50:7438 failed: users request failed: 500'))).toBe('Something went wrong. Try again.');
  });

  it('shows the server\'s own sentence from wherever in the chain it was said', () => {
    const inner = Object.assign(new Error('log'), { detail: 'That username is taken.' });
    expect(viewerErrorText(new Error('outer', { cause: inner }))).toBe('That username is taken.');
  });

  it('says an unreachable server is unreachable', () => {
    expect(viewerErrorText(new MachaConnectionError())).toBe(SERVER_UNREACHABLE_TEXT);
  });
});

describe('the player\'s stream-status lines, as core used to word them', () => {
  // Expected strings taken from core's own tests before the cut (8db0a12^).
  const hevc: PlaybackStreamInfo = { index: 0, type: 'video', codec: 'hevc', profile: 'Main', language: '', default: true, forced: false, width: 1920, height: 1080, bitrate: 7_500_000 };
  const eac3: PlaybackStreamInfo = { index: 1, type: 'audio', codec: 'eac3', profile: '', language: 'eng', default: true, forced: false, channels: 6, sampleRate: 48000, bitrate: 640_000 };
  const described = (overrides: Partial<PlaybackStatusDescription>): PlaybackStatusDescription => ({
    container: 'mp4',
    video: { transform: 'copy', source: hevc, sourceBitrate: 8_000_000 },
    audio: { transform: 'copy', source: eac3 },
    ...overrides,
  });

  it('names a whole-session copy once, DIRECT or REMUX', () => {
    expect(streamStatusText(described({ delivery: 'direct' }))?.video).toBe('DIRECT · HEVC · 1920×1080 · 7.5 Mb/s');
    expect(streamStatusText(described({ delivery: 'remux' }))).toMatchObject({
      container: 'MP4',
      video: 'REMUX · HEVC · 1920×1080 · 7.5 Mb/s',
      audio: 'REMUX · ENG · EAC3 · 5.1 · 48 kHz · 640 kb/s',
    });
  });

  it('keeps AUDIO COPY where a copy is what distinguishes the stream', () => {
    const text = streamStatusText(described({
      video: { transform: 'transcode', source: hevc, output: { sourceStream: 0, transform: 'transcode', codec: 'h264', width: 1280, height: 720, bitrate: 4_000_000 } },
    }));
    expect(text?.audio).toBe('AUDIO COPY · ENG · EAC3 · 5.1 · 48 kHz · 640 kb/s');
    expect(text?.video).toBe('VIDEO TRANSCODE · SOURCE · HEVC · 1920×1080 · 7.5 Mb/s → H264 · 1280×720 · 4.0 Mb/s');
  });

  it('names the served container as viewers read it', () => {
    expect(streamStatusText(described({ container: 'mpegts' }))?.container).toBe('MPEG-TS');
    expect(streamStatusText(described({ container: 'fmp4' }))?.container).toBe('FMP4');
    expect(streamStatusText(described({ container: 'avi' }))?.container).toBe('AVI');
  });

  it('describes subtitles with language, codec and forced', () => {
    const subtitle: PlaybackStreamInfo = { index: 2, type: 'subtitle', codec: 'ass', profile: '', language: 'eng', default: false, forced: true };
    expect(streamStatusText(described({ subtitle }))?.subtitle).toBe('SUBTITLES · ENG · ASS · FORCED');
  });
});
