import { afterEach, describe, expect, it, vi } from 'vitest';
import { AndroidWebPlatform } from './AndroidWebPlatform';

afterEach(() => vi.unstubAllGlobals());

describe('Android WebView platform', () => {
  it('reports Android while retaining detected WebView media capabilities', async () => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        canPlayType: (mime: string) => mime.includes('mp4') ? 'probably' : '',
      })),
    });
    vi.stubGlobal('MediaSource', undefined);

    const capabilities = await new AndroidWebPlatform().capabilities();

    expect(capabilities.platform).toBe('android');
    expect(capabilities.containers).toContain('mp4');
  });
});
