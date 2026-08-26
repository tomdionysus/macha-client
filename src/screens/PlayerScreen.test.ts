import { describe, expect, it } from 'vitest';
import { isSubtitleOnlyUpdate, playerBufferedTimelineEnabled, playerControlShowsPlay, samsungSeekDeltaForKey, webSeekDeltaForKey } from './PlayerScreen';

describe('player UI transport bindings', () => {
  it('maps Web left/right arrows to ten-second seeks', () => {
    expect(webSeekDeltaForKey('ArrowLeft')).toBe(-10_000);
    expect(webSeekDeltaForKey('ArrowRight')).toBe(10_000);
    expect(webSeekDeltaForKey('ArrowUp')).toBeUndefined();
  });

  it('maps Samsung left/right remote buttons to ten-second seeks while playback chrome is hidden', () => {
    expect(samsungSeekDeltaForKey('ArrowLeft', 37, false)).toBe(-10_000);
    expect(samsungSeekDeltaForKey('Left', 0, false)).toBe(-10_000);
    expect(samsungSeekDeltaForKey('', 37, false)).toBe(-10_000);
    expect(samsungSeekDeltaForKey('ArrowRight', 39, false)).toBe(10_000);
    expect(samsungSeekDeltaForKey('Right', 0, false)).toBe(10_000);
    expect(samsungSeekDeltaForKey('', 39, false)).toBe(10_000);
    expect(samsungSeekDeltaForKey('ArrowUp', 38, false)).toBeUndefined();
  });

  it('leaves Samsung left/right available for control-bar focus navigation while chrome is visible', () => {
    expect(samsungSeekDeltaForKey('ArrowLeft', 37, true)).toBeUndefined();
    expect(samsungSeekDeltaForKey('ArrowRight', 39, true)).toBeUndefined();
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

  it('recognises subtitle-only updates', () => {
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: 5, subtitleLanguage: '' } })).toBe(true);
    expect(isSubtitleOnlyUpdate({ preferences: { subtitleStream: null } })).toBe(true);
    expect(isSubtitleOnlyUpdate({ preferences: { audioStream: 2 } })).toBe(false);
    expect(isSubtitleOnlyUpdate({ seekMs: 10_000, preferences: { subtitleStream: 5 } })).toBe(false);
  });
});
