import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDirectPlayReadAheadAlternative, buildDirectPlayReadAheadProxyUrl, directPlayReadAheadUrl } from './directPlayReadAhead';
import type { PlaybackSource } from '@machafoundation/core';

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

  /**
   * The worker's failure message is the only channel Direct Play has, and until
   * 2026-09-17 it carried a string and nothing else. A node that no longer has
   * the source answers `404`, and the worker used to hand that response to the
   * media element as though the error envelope were media — so the element
   * raised a generic decode/unsupported error and a session that only needed
   * re-creating became a terminal failure on the wrong node.
   *
   * Fresh module per test: the listener installs once per module instance and
   * latches, so a stub registered after an earlier test's install would never
   * be called and this would pass without proving anything.
   */
  async function failureListenerHarness() {
    vi.resetModules();
    let handler: ((event: MessageEvent<unknown>) => void) | undefined;
    vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://client.test' } });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: { postMessage: vi.fn() },
        addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => { handler = listener; },
        register: vi.fn(),
      },
    });
    const module = await import('./directPlayReadAhead');
    const direct = source();
    const sourceKey = new URL(module.directPlayReadAheadUrl(direct)).searchParams.get('key');
    const failures: Array<Error & { status?: number }> = [];
    module.subscribeDirectPlayReadAheadFailure(direct.url, (error) => failures.push(error));
    const fail = (extra: Record<string, unknown>) => handler?.({
      data: { type: 'macha-direct-read-ahead-source-failed', sourceKey, ...extra },
    } as MessageEvent<unknown>);
    return { handler, sourceKey, failures, fail };
  }

  it('carries the status that failed a Direct Play source through to the listener', async () => {
    const { handler, sourceKey, failures, fail } = await failureListenerHarness();
    expect(handler).toBeDefined();
    expect(sourceKey).toBeTruthy();

    fail({ message: 'Direct Play source returned 404', status: 404 });
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toBe('Direct Play source returned 404');
    expect(failures[0].status).toBe(404);
  });

  it('leaves a transport failure with no status at all, which is a different claim', async () => {
    // No status is not "a status I do not recognise". A fetch that never became
    // a response says something about the node; a 404 says something about the
    // source. Defaulting the absent case to any number would erase that.
    const { failures, fail } = await failureListenerHarness();
    fail({ message: 'Direct Play read-ahead source failed' });
    expect(failures).toHaveLength(1);
    expect(failures[0].status).toBeUndefined();
  });

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
