import { describe, expect, it } from 'vitest';
import { buildDirectPlayReadAheadProxyUrl, directPlayReadAheadUrl } from './directPlayReadAhead';
import type { PlaybackSource } from '../types';

describe('Direct Play read-ahead client', () => {
  it('builds a local proxy URL containing only the opaque source key', () => {
    const url = new URL(buildDirectPlayReadAheadProxyUrl('source-key-123', 'https://client.test'));
    expect(url.origin).toBe('https://client.test');
    expect(url.pathname).toBe('/__macha_direct_cache__');
    expect(url.searchParams.get('key')).toBe('source-key-123');
    expect(url.search).not.toContain('playback');
  });

  it('falls back to the original source outside a Service Worker browser environment', async () => {
    const source: PlaybackSource = {
      mediaId: 'file:test',
      url: 'https://node.test/api/v1/playback/stream/session/cap/secret/file.mkv',
      mimeType: 'video/x-matroska',
      mode: 'direct',
      sizeBytes: 1024 * 1024 * 1024,
    };
    await expect(directPlayReadAheadUrl(source)).resolves.toBe(source.url);
  });
});
