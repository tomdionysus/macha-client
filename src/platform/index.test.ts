// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readinessFetchForHost } from '.';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { __MACHA_TIZEN__?: unknown }).__MACHA_TIZEN__;
  delete (window as { __MACHA_ANDROID__?: unknown }).__MACHA_ANDROID__;
});

describe('the fetch core measures start costs with', () => {
  it('sends no cache headers from a browser, where the nodes would refuse them cross-origin', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 206 }));
    vi.stubGlobal('fetch', fetch);
    const probe = readinessFetchForHost();
    expect(probe).toBeDefined();
    await probe!('http://10.44.1.50:7438/master.m3u8', {
      headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache', Range: 'bytes=0-0' },
    });
    const init = fetch.mock.calls[0][1]!;
    expect(init.headers).toEqual({ Range: 'bytes=0-0' });
    expect(init.cache).toBe('no-store');
  });

  it('leaves a television shell on core default until its webview is measured', () => {
    (window as { __MACHA_TIZEN__?: unknown }).__MACHA_TIZEN__ = {};
    expect(readinessFetchForHost()).toBeUndefined();
  });
});
