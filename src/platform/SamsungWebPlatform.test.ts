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
});
