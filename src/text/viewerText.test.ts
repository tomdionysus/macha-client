import { describe, expect, it } from 'vitest';
import { endpointFailure, MachaAcquisitionApiError, MachaClusterRouteError, MachaConnectionError, MachaPlaybackError, NOT_PLAYABLE_CODE, SESSION_PROVENANCE_UNKNOWN_CODE, START_NO_PROGRESS_CODE, TOO_SLOW_TO_PLAY_CODE, type MediaSummary, type PlaybackNotice, type PlaybackStartProgress, type VersionStep, type PassedOverVersion, type QualityCeiling, type PlaybackStatusDescription, type PlaybackStreamInfo } from '@machafoundation/core';
import {
  playbackRefusalText,
  diagnosticErrorText,
  hintResultLabel,
  jobErrorText,
  serverStatusText,
  albumLabel, alphabetIndexKeyText, cardSubtitle, episodeCode, episodeLabel, playbackFailureCodeText, playbackNoticeText,
  playbackTimeText, qualityChoiceText, qualitySteppedDownText, tooSlowToPlayText, CHANGE_UNANSWERED_TEXT, NO_NODE_ANSWERED_TEXT, SERVER_SLOW_TEXT, SERVER_UNREACHABLE_TEXT, sortChoiceLabel, startProgressText, streamStatusText, trackNumberLabel, viewerErrorText,
} from './viewerText';

const item = (overrides: Partial<MediaSummary>) => ({ id: 'i', kind: 'movie', title: 'T', mediaIds: [], ...overrides }) as MediaSummary;

describe('media wording, now this client\'s', () => {
  it('names an episode compactly inside its season, and in full away from it', () => {
    expect(episodeCode(item({ kind: 'episode', seasonNumber: 1, episodeNumber: 4 }))).toBe('S01E04');
    // Tom, 2026-09-27: "S04E08 in all cases", on every client.
    expect(episodeLabel(item({ kind: 'episode', seasonNumber: 1, episodeNumber: 4 }))).toBe('S01E04');
    expect(episodeLabel(item({ kind: 'episode', episodeNumber: 4, playbackContext: { series: { id: 's', title: 'S' }, season: { id: 'x', title: 'Season 4', seasonNumber: 4 } } }))).toBe('S04E04');
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
    for (const code of ['copy-refused', 'decode-fallback', 'cannot-seek', 'not-ready', 'instruction-failed', 'subtitles-loading', 'update-failed'] as const) {
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

  it('says no server answered when every node was tried and none did, rather than that something went wrong', () => {
    const timedOut = new MachaConnectionError('Request to http://node/api/v1/manage/unmatched exceeded 8000 ms.');
    expect(viewerErrorText(new MachaClusterRouteError(['fi-1', 'gbni-1'], true, timedOut))).toBe(NO_NODE_ANSWERED_TEXT);
  });

  it('says the server is taking too long when a node in good standing ran out of time, rather than that none answered', () => {
    expect(viewerErrorText(new MachaClusterRouteError(['fi-1'], false, new MachaConnectionError('exceeded 30000 ms'), true))).toBe(SERVER_SLOW_TEXT);
  });

  it('says a change one node did not answer may still finish, rather than that something went wrong', () => {
    const timedOut = endpointFailure('fi-1', 'http://fi-1', new MachaConnectionError('Request exceeded 8000 ms.'));
    expect(viewerErrorText(timedOut)).toBe(CHANGE_UNANSWERED_TEXT);
  });

  it('gives the server\'s own sentence when the nodes answered and refused', () => {
    const refused = Object.assign(new Error('log'), { detail: 'That file changed since matching failed.' });
    expect(viewerErrorText(new MachaClusterRouteError(['fi-1'], false, refused))).toBe('That file changed since matching failed.');
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

describe('the server\'s codes, worded here (server 0.56.0)', () => {
  it('words a job\'s code, and adds the server\'s sentence only where the code is generic', () => {
    expect(jobErrorText({ error_code: 'no_supported_media', error: 'no supported media under /srv/x' })).toBe('No playable media was found in it.');
    expect(jobErrorText({ error_code: 'torrent_error', error: 'tracker unreachable' })).toBe('The torrent reported an error. tracker unreachable');
    expect(jobErrorText({ error_code: 'staging_full', error: null })).toBe('Waiting for room in staging.');
  });

  it('shows the server\'s sentence for a code it does not know, or from a node older than 0.56.0', () => {
    expect(jobErrorText({ error_code: 'something_new', error: 'A new failure.' })).toBe('A new failure.');
    expect(jobErrorText({ error: 'Old node sentence.' })).toBe('Old node sentence.');
    expect(jobErrorText({ error: null, error_code: null })).toBeUndefined();
    expect(jobErrorText(undefined)).toBeUndefined();
  });

  it('words a catalogue result, and leaves an older node\'s sentence as it is', () => {
    expect(hintResultLabel('no_provider_match')).toBe('No match found');
    expect(hintResultLabel('some_new_result')).toBe('Some new result');
    expect(hintResultLabel('No provider match after 3 candidates')).toBe('No provider match after 3 candidates');
  });

  it('words a diagnostic\'s code', () => {
    expect(diagnosticErrorText({ error_code: 'discovery_failed', error: 'no IGD found' })).toBe('No UPnP router was found.');
    expect(diagnosticErrorText({ error_code: 'rpc_failed', error: 'timeout' })).toBe('The node did not answer.');
  });

  it('words a torrent another node would not take by its reason', () => {
    const refused = new MachaAcquisitionApiError('log text', 409, 'placement_failed', 'Node refused.', 'node_unreachable');
    expect(viewerErrorText(refused)).toBe('That node cannot be reached.');
    const peerCode = new MachaAcquisitionApiError('log text', 409, 'placement_failed', 'Staging full.', 'staging_full');
    expect(viewerErrorText(peerCode)).toBe('Waiting for room in staging.');
  });

  it('says nothing on the settings card for a server that is ok', () => {
    expect(serverStatusText({ code: 'ok', detail: null })).toBeUndefined();
    expect(serverStatusText({ code: null, detail: null })).toBeUndefined();
    expect(serverStatusText({ code: 'playback_unavailable', detail: null })).toBe('Playback unavailable');
  });
});

describe('a refused playback change says why (Tom: no more "That change could not be made")', () => {
  const refusal = (code: string, choice?: string, detail?: string) => {
    const error = new MachaPlaybackError('log text', 400, code, undefined, undefined, detail);
    if (choice) error.choice = choice;
    return error;
  };

  it('words a stream choice the node refused', () => {
    expect(playbackRefusalText(refusal('choice_required', 'audio_stream'))).toBe('This file has more than one audio track and none was chosen.');
    expect(playbackRefusalText(refusal('choice_not_available', 'subtitle_stream'))).toBe('The chosen subtitle track is not in this file.');
  });

  it('carries the node\'s own reason for anything else, and says plainly when there was none', () => {
    expect(playbackRefusalText(refusal('bad_request', undefined, 'A quality limit needs a converted stream.'))).toBe('A quality limit needs a converted stream.');
    expect(playbackRefusalText(undefined)).toBe('The node refused it without saying why.');
  });

  it('reads the refusal core puts on the notice, even with no error beside it', () => {
    expect(playbackNoticeText({ code: 'update-failed', refusal: { status: 400, code: 'choice_required', choice: 'audio_stream', choices: [1, 2] } }))
      .toBe('Playback settings were not changed: This file has more than one audio track and none was chosen.');
  });

  it('never shows the old sentence', () => {
    expect(playbackNoticeText({ code: 'update-failed', error: refusal('choice_required', 'container') })).toBe('Playback settings were not changed: This file has more than one streaming format and none was chosen.');
    expect(playbackNoticeText({ code: 'update-failed' })).not.toMatch(/could not be made/);
  });
});

describe('a refusal because the node is busy', () => {
  it('says the node is converting for others rather than quoting the server', () => {
    const error = new MachaPlaybackError('Macha playback request failed: video transcode limit reached', 429, 'resource_limit');
    expect(playbackNoticeText({ code: 'update-failed', error } as PlaybackNotice)).toBe('Playback settings were not changed: This node is already converting as much as it can for other viewers. Try again shortly.');
  });
});

describe('adding a torrent a node already holds (server 0.63.0)', () => {
  it('says it is already in the list, and how to add it again, without the job id', () => {
    const error = new MachaAcquisitionApiError('Macha acquisition request failed: job 3f2a already holds this torrent', 409, 'torrent_already_added', 'job 3f2a already holds this torrent');
    expect(viewerErrorText(error)).toBe('That torrent is already in the list. To download it again, remove its job first.');
  });
});

describe('an acquisition refusal that reached us through the cluster router', () => {
  it('is worded from the node\'s own refusal inside the wrapping', () => {
    const placement = endpointFailure('e', 'http://node', new MachaAcquisitionApiError('m', 409, 'placement_failed', 'server sentence', 'node_refused'));
    expect(viewerErrorText(placement)).toBe('That node refused the torrent.');
    const held = endpointFailure('e', 'http://node', new MachaAcquisitionApiError('m', 409, 'torrent_already_added', 'job x already holds this torrent'));
    expect(viewerErrorText(held)).toBe('That torrent is already in the list. To download it again, remove its job first.');
  });

  it('words the two torrent faults of server 0.63.0', () => {
    expect(jobErrorText({ error_code: 'duplicate_torrent', error: 'x' })).toMatch(/^Another job already held this torrent/);
    expect(jobErrorText({ error_code: 'torrent_fault', error: 'x' })).toBe('The download engine failed on this torrent. Remove it and add the torrent again.');
  });
});

describe('what a start or a change is doing (server 0.69.0)', () => {
  const progress = (overrides: Partial<PlaybackStartProgress>): PlaybackStartProgress => ({
    kind: 'start', stage: 'planning', progressSeq: 1, elapsedMs: 0, ...overrides,
  });

  it('names the stage of a start, and the node only while it is planning', () => {
    expect(startProgressText(progress({ stage: 'planning' }), 'fi-1')).toBe('Preparing the stream on fi-1');
    expect(startProgressText(progress({ stage: 'preroll', prerollDecodedMs: 2_000, prerollTotalMs: 5_000 }), 'fi-1'))
      .toBe('Finding the start point: 40%');
    expect(startProgressText(progress({ stage: 'encoding', outputMediaMs: 1_200, firstFragmentMs: 2_000 }), 'fi-1'))
      .toBe('Starting the stream: 60%');
  });

  it('names the node throughout a change, since another stream is playing meanwhile', () => {
    expect(startProgressText(progress({ kind: 'change', stage: 'planning' }), 'fi-1', true)).toBe('Preparing new stream on fi-1…');
    expect(startProgressText(progress({ kind: 'change', stage: 'preroll', prerollDecodedMs: 1, prerollTotalMs: 4 }), 'fi-1', true))
      .toBe('Finding the start point on fi-1: 25%');
    expect(startProgressText(progress({ kind: 'change', stage: 'encoding', outputMediaMs: 0, firstFragmentMs: 2_000 }), 'fi-1', true))
      .toBe('Starting the new stream on fi-1: 0%');
  });

  it('shows no figure the node did not measure, rather than a zero or a guess', () => {
    expect(startProgressText(progress({ stage: 'encoding', firstFragmentMs: 2_000 }))).toBe('Starting the stream');
    expect(startProgressText(progress({ stage: 'preroll', prerollDecodedMs: 3_000, prerollTotalMs: 0 }))).toBe('Finding the start point');
    expect(startProgressText(progress({ kind: 'change', stage: 'encoding' }), undefined, true)).toBe('Starting the new stream…');
  });

  it('words a start that stopped progressing, which has no server sentence of its own', () => {
    expect(playbackFailureCodeText(START_NO_PROGRESS_CODE)).toBe('The node stopped making progress starting this stream.');
  });

  it('says nothing once the start is over, whichever way it ended', () => {
    expect(startProgressText(progress({ stage: 'ready' }))).toBeUndefined();
    expect(startProgressText(progress({ stage: 'failed' }))).toBeUndefined();
  });
});

describe('why Play chooses the file it does, as one sentence from every fact', () => {
  const instruction = (video: 'copy' | 'transcode', audio: 'copy' | 'transcode') =>
    ({ mode: video === 'transcode' || audio === 'transcode' ? 'transcode' : 'direct', video, audio, reasons: [], assumed: [] }) as VersionStep['instruction'];
  const file = (quality: VersionStep['quality'], video: 'copy' | 'transcode' = 'copy', audio: 'copy' | 'transcode' = 'copy') =>
    ({ quality, instruction: instruction(video, audio), index: 0 });
  // The Martian: a 4K file (HEVC, TrueHD), a 1080p file (HEVC, E-AC-3) and a 720p file (H.264, AAC).
  const files = [file(2160, 'copy', 'transcode'), file(1080, 'copy', 'transcode'), file(720)];
  const automatic = (quality: VersionStep['quality'], video: 'copy' | 'transcode' = 'copy', audio: 'copy' | 'transcode' = 'copy') =>
    ({ quality, source: 'file', mediaId: 'm', instruction: instruction(video, audio) }) as VersionStep;
  const passedOver = (quality: VersionStep['quality'], video: boolean, audio: boolean): PassedOverVersion =>
    ({ quality, converts: { video, audio }, reasons: [] });

  it('builds one sentence when a ceiling and a conversion both kept Play off a larger file', () => {
    // This Mac: the screen caps at 1080p, and Chrome cannot play E-AC-3.
    expect(qualityChoiceText({ files, automatic: automatic(720), limitedBy: { quality: 1080, reason: 'ceiling-display' }, passedOver: passedOver(1080, false, true) }))
      .toBe('Play chooses 720p, which plays without converting. 1080p needs its audio converted, and 4K is more than this screen shows. Pick a quality to play another.');
  });

  it('names only the conversion, where no ceiling applies (the 4K television)', () => {
    expect(qualityChoiceText({ files, automatic: automatic(1080), passedOver: passedOver(2160, false, true) }))
      .toBe('Play chooses 1080p, which plays without converting. 4K needs its audio converted. Pick a quality to play another.');
    expect(qualityChoiceText({ files, automatic: automatic(1080), passedOver: passedOver(2160, true, true) }))
      .toBe('Play chooses 1080p, which plays without converting. 4K needs its video and audio converted. Pick a quality to play another.');
  });

  it('names only the ceiling, with its reason, and the largest file it kept out', () => {
    const only = (reason: QualityCeiling['reason']) => qualityChoiceText({ files, automatic: automatic(1080), limitedBy: { quality: 1080, reason } });
    expect(only('ceiling-display')).toBe('Play chooses 1080p. 4K is more than this screen shows. Pick a quality to play another.');
    expect(only('ceiling-device')).toBe('Play chooses 1080p. 4K is more than this device plays. Pick a quality to play another.');
    expect(only('ceiling-cellular')).toBe('Play chooses 1080p. 4K is more than Play uses on mobile data. Pick a quality to play another.');
    expect(only('ceiling-preference')).toBe('Play chooses 1080p. 4K is more than the most set in Settings. Pick a quality to play another.');
  });

  it("says where the conversion is not only needed but too slow for any node to keep up with (server 0.70.0's rates)", () => {
    const slow: PassedOverVersion = { quality: 2160, converts: { video: true, audio: true }, reasons: ['transcode-below-real-time'] };
    expect(qualityChoiceText({ files, automatic: automatic(1080), passedOver: slow }))
      .toBe("Play chooses 1080p, which plays without converting. 4K needs its video and audio converted, which the server can't do fast enough. Pick a quality to play another.");
  });

  it('never claims the chosen file plays as it is when it does not', () => {
    expect(qualityChoiceText({ files, automatic: automatic(1080, 'copy', 'transcode'), passedOver: passedOver(2160, true, true) }))
      .toBe('Play chooses 1080p. 4K needs its video and audio converted. Pick a quality to play another.');
  });

  it('says nothing when Play chooses the largest file there is', () => {
    expect(qualityChoiceText({ files, automatic: automatic(2160) })).toBeUndefined();
  });
});

describe('a quality no node can convert fast enough', () => {
  it("says which quality and which streams, from what was playing (Tom: 'Macha can't play this quality because...')", () => {
    expect(tooSlowToPlayText(2160, { video: 'transcode', audio: 'transcode' }))
      .toBe("Macha can't play 4K because the server can't convert its video and audio fast enough to keep up.");
    expect(tooSlowToPlayText(1440, { video: 'transcode', audio: 'copy' }))
      .toBe("Macha can't play 2K because the server can't convert its video fast enough to keep up.");
    // An omitted stream (no audio at all) is not one being converted.
    expect(tooSlowToPlayText(2160, { video: 'transcode', audio: 'omit' }))
      .toBe("Macha can't play 4K because the server can't convert its video fast enough to keep up.");
  });

  it('keeps the sentence whole when a fact is missing', () => {
    expect(tooSlowToPlayText()).toBe("Macha can't play this quality because the server can't convert it fast enough to keep up.");
    expect(playbackFailureCodeText(TOO_SLOW_TO_PLAY_CODE)).toBe(tooSlowToPlayText());
  });

  it("says where core stepped its own choice down, naming the quality it chose", () => {
    expect(qualitySteppedDownText(1080)).toBe("Switched to 1080p: the server can't convert a higher quality fast enough.");
    expect(playbackNoticeText({ code: 'quality-stepped-down' } as PlaybackNotice, 1080))
      .toBe("Switched to 1080p: the server can't convert a higher quality fast enough.");
    expect(qualitySteppedDownText()).toBe("Switched to a lower quality: the server can't convert a higher quality fast enough.");
  });
});
