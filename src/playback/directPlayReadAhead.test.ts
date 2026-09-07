import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDirectPlayReadAheadAlternative, buildDirectPlayReadAheadProxyUrl, directPlayReadAheadUrl } from './directPlayReadAhead';
import type { PlaybackSource } from '@macha/core';

function source(): PlaybackSource {
  return {
    mediaId: 'file:test',
    url: 'https://node.test/api/v1/playback/stream/session/cap/secret/file.mkv',
    isManifest: false, mimeType: 'video/x-matroska',
    mode: 'direct',
    sizeBytes: 1024 * 1024 * 1024,
  };
}

describe('Direct Play read-ahead client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds a local proxy URL containing only the opaque source key when no descriptor is supplied', () => {
    const url = new URL(buildDirectPlayReadAheadProxyUrl('source-key-123', 'https://client.test'));
    expect(url.origin).toBe('https://client.test');
    expect(url.pathname).toBe('/__macha_direct_cache__');
    expect(url.searchParams.get('key')).toBe('source-key-123');
    expect(url.search).not.toContain('playback');
  });

  it('can self-describe a proxy request so fetch dispatch never waits for worker message ordering', () => {
    const direct = source();
    const url = new URL(buildDirectPlayReadAheadProxyUrl('source-key-123', 'https://client.test', direct));
    expect(url.searchParams.get('source')).toBe(direct.url);
    expect(url.searchParams.get('size')).toBe(String(direct.sizeBytes));
    expect(url.searchParams.get('mime')).toBe(direct.mimeType);
  });

  it('falls back synchronously outside a Service Worker browser environment', () => {
    expect(directPlayReadAheadUrl(source())).toBe(source().url);
  });

  it('never waits for Service Worker registration when the page is not controlled yet', () => {
    const register = vi.fn(() => new Promise<ServiceWorkerRegistration>(() => undefined));
    vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://client.test' } });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: null,
        register,
        addEventListener: vi.fn(),
      },
    });

    const startedAt = performance.now();
    const result = directPlayReadAheadUrl(source());
    expect(result).toBe(source().url);
    expect(performance.now() - startedAt).toBeLessThan(20);
    expect(register).toHaveBeenCalledOnce();
  });

  it('registers a prepared alternate without replacing the active proxy URL', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://client.test' } });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: { postMessage },
        addEventListener: vi.fn(),
      },
    });
    const primary = { ...source(), url: 'https://node-a.test/direct' };
    const alternate = { ...source(), url: 'https://node-b.test/direct' };

    expect(directPlayReadAheadUrl(primary)).not.toBe(primary.url);
    expect(addDirectPlayReadAheadAlternative(primary, alternate)).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'macha-direct-read-ahead-add-source',
      sourceUrl: alternate.url,
    }));
  });
});
