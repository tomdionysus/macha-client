import { describe, expect, it } from 'vitest';
import { boundedPlayerSeekTarget, isSubtitleOnlyUpdate, playerBackAction, playerBufferedTimelineEnabled, playerControlShowsPlay, playerMediaSubtitle, samsungTransportSeekDirection, webSeekDeltaForKey } from './PlayerScreen';
import type { MediaSummary } from '@macha/core';

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
    // With the bar up of its own accord the arrows must move focus between
    // controls, or the control row cannot be navigated at all.
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

  it('recognises subtitle-only updates', () => {
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: 5, subtitleLanguage: '' } })).toBe(true);
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: null } })).toBe(true);
    expect(isSubtitleOnlyUpdate({ preferences: { audioStream: 2 } })).toBe(false);
    expect(isSubtitleOnlyUpdate({ seekMs: 10_000, preferences: { subtitleStream: 5 } })).toBe(false);
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

    it('never displaces a subtitle the catalogue did supply', () => {
      expect(playerMediaSubtitle(movie({ subtitle: 'Extended cut', year: 2007 }))).toBe('Extended cut');
    });

    it('leaves the episode line as series plus episode number', () => {
      const episode: MediaSummary = {
        id: 'e1',
        kind: 'episode',
        title: 'Pilot',
        subtitle: 'S01E01',
        year: 2005,
        mediaIds: ['file:e1'],
        playbackContext: { series: { id: 's1', title: 'The Show' }, season: { id: 'se1', title: 'Season 1', seasonNumber: 1 } },
      };
      // The year must not creep in here: the series name is the context that matters.
      expect(playerMediaSubtitle(episode)).toBe('The Show S01E01');
    });

    it('leaves a track showing its track number, not its year', () => {
      expect(playerMediaSubtitle({ id: 't1', kind: 'track', title: 'Song', subtitle: 'Track 3', year: 1999, mediaIds: ['file:t1'] })).toBe('Track 3');
    });
  });
});
