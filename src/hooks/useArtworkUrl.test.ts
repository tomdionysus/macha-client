// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi } from '@machafoundation/core';
import { useArtworkUrl } from './useArtworkUrl';
import { settle } from '../test/settle';

function fakeApi(artwork: MediaApi['artwork']): MediaApi {
  return { artwork } as unknown as MediaApi;
}

describe('useArtworkUrl', () => {
  it('returns a signed capability URL directly with no fetch', () => {
    const artworkFetch = vi.fn();
    const { result } = renderHook(() => useArtworkUrl(fakeApi(artworkFetch), {
      id: 'a', mimeType: 'image/jpeg', url: '/signed/a?sig=1',
    }));

    expect(result.current).toBe('/signed/a?sig=1');
    expect(artworkFetch).not.toHaveBeenCalled();
  });

  it('falls back to fetching and object-URL creation for artwork without a signed URL', async () => {
    // jsdom lacks createObjectURL/revokeObjectURL; unmount before restoring so the hook's cleanup can call one.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    try {
      const blob = new Blob(['bytes'], { type: 'image/jpeg' });
      const artworkFetch = vi.fn(() => Promise.resolve(blob));
      // Built outside the render: a new api each render re-triggers the hook's effect for ever.
      const api = fakeApi(artworkFetch);
      const ref = { id: 'legacy', mimeType: 'image/jpeg' };
      const { result, unmount } = renderHook(() => useArtworkUrl(api, ref));

      expect(result.current).toBeUndefined();
      await settle();
      expect(result.current).toBe('blob:fake');
      expect(artworkFetch).toHaveBeenCalled();
      unmount();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('returns undefined with no artwork reference', () => {
    const { result } = renderHook(() => useArtworkUrl(fakeApi(vi.fn()), undefined));
    expect(result.current).toBeUndefined();
  });
});
