import { describe, expect, it, vi } from 'vitest';
import { registerSamsungMediaKeys, SAMSUNG_MEDIA_KEYS, samsungMediaCommand } from './SamsungMediaKeys';

describe('Samsung media remote keys', () => {
  it('maps modern names and legacy Tizen key codes to their transport action', () => {
    expect(samsungMediaCommand('MediaPlay', 0)).toBe('play');
    expect(samsungMediaCommand('', 415)).toBe('play');
    expect(samsungMediaCommand('MediaPause', 0)).toBe('pause');
    expect(samsungMediaCommand('', 19)).toBe('pause');
    expect(samsungMediaCommand('MediaPlayPause', 0)).toBe('toggle');
    expect(samsungMediaCommand('', 10252)).toBe('toggle');
    expect(samsungMediaCommand('MediaTrackPrevious', 0)).toBe('previous');
    expect(samsungMediaCommand('', 10232)).toBe('previous');
    expect(samsungMediaCommand('MediaTrackNext', 0)).toBe('next');
    expect(samsungMediaCommand('', 10233)).toBe('next');
    expect(samsungMediaCommand('MediaStop', 0)).toBe('stop');
    expect(samsungMediaCommand('', 413)).toBe('stop');
  });

  it('registers every transport key and continues if an older TV rejects one', () => {
    const registerKey = vi.fn((key: string) => {
      if (key === 'MediaPlayPause') throw new Error('unsupported');
    });
    registerSamsungMediaKeys({ tizen: { tvinputdevice: { registerKey } } });
    expect(registerKey.mock.calls.map(([key]) => key)).toEqual([...SAMSUNG_MEDIA_KEYS]);
  });
});
