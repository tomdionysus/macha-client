// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi } from '../api/MediaApi';
import { useArtworkUrl } from './useArtworkUrl';

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
    // jsdom does not implement createObjectURL/revokeObjectURL. Patch them
    // directly and unmount before restoring, so the effect cleanup this
    // hook runs on unmount has a real function to call.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    try {
      const blob = new Blob(['bytes'], { type: 'image/jpeg' });
      const artworkFetch = vi.fn(() => Promise.resolve(blob));
      const { result, unmount } = renderHook(() => useArtworkUrl(fakeApi(artworkFetch), { id: 'legacy', mimeType: 'image/jpeg' }));

      expect(result.current).toBeUndefined();
      await waitFor(() => expect(result.current).toBe('blob:fake'));
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
