import { describe, expect, it } from 'vitest';
import { isSubtitleOnlyUpdate } from './PlayerScreen';

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
