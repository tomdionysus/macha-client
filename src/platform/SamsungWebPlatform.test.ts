import { afterEach, describe, expect, it, vi } from 'vitest';
import { SamsungWebPlatform } from './SamsungWebPlatform';

describe('SamsungWebPlatform', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exits the current Tizen application when requested', () => {
    const exit = vi.fn();
    vi.stubGlobal('window', {
      tizen: { application: { getCurrentApplication: () => ({ exit }) } },
    });

    new SamsungWebPlatform().exitApplication();

    expect(exit).toHaveBeenCalledOnce();
  });

  it('registers remote media transport keys when the platform starts', () => {
    const registerKey = vi.fn();
    vi.stubGlobal('window', {
      tizen: { tvinputdevice: { registerKey } },
    });

    new SamsungWebPlatform();

    expect(registerKey).toHaveBeenCalledWith('MediaPlay');
    expect(registerKey).toHaveBeenCalledWith('MediaTrackPrevious');
    expect(registerKey).toHaveBeenCalledWith('MediaTrackNext');
    expect(registerKey).toHaveBeenCalledWith('MediaStop');
  });
});
