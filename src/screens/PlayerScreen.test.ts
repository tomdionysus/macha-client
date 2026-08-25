import { describe, expect, it } from 'vitest';
import { isSubtitleOnlyUpdate, playerControlShowsPlay, webSeekDeltaForKey } from './PlayerScreen';

describe('player UI transport bindings', () => {
  it('maps Web left/right arrows to ten-second seeks', () => {
    expect(webSeekDeltaForKey('ArrowLeft')).toBe(-10_000);
    expect(webSeekDeltaForKey('ArrowRight')).toBe(10_000);
    expect(webSeekDeltaForKey('ArrowUp')).toBeUndefined();
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
