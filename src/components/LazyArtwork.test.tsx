// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi } from '../api/MediaApi';
import { LazyArtwork } from './LazyArtwork';
import { VISIBLE_ARTWORK_RECOVERY_DELAY_MS } from '../hooks/useViewportArtworkUrl';

function fakeApi(artwork: MediaApi['artwork'] = vi.fn(() => Promise.reject(new Error('artwork() should not be called')))): MediaApi {
  return { artwork, invalidateArtwork: vi.fn() } as unknown as MediaApi;
}

describe('LazyArtwork', () => {
  it('renders a plain lazy image directly from a signed capability URL, with no client-side fetch', () => {
    const artworkFetch = vi.fn();
    render(
      <LazyArtwork
        api={fakeApi(artworkFetch)}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=abc' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    const img = screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' });
    expect(img.src).toContain('/signed/poster-1?sig=abc');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(artworkFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('placeholder')).toBeNull();
  });

  it('uses eager loading for a capability URL when requested', () => {
    render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'hero-1', mimeType: 'image/jpeg', url: '/signed/hero-1' }}
        alt="Hero"
        placeholder={<span>placeholder</span>}
        eager
      />,
    );

    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Hero' }).getAttribute('loading')).toBe('eager');
  });

  it('falls back to fetching artwork without a signed URL, for a node that has not upgraded', async () => {
    // jsdom does not implement createObjectURL/revokeObjectURL. Patch them
    // directly (rather than vi.stubGlobal, whose restore would otherwise race
    // the effect cleanup that RTL's automatic unmount runs in afterEach) so
    // the legacy Blob-fetch path — unchanged production code — can run here.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    try {
      const blob = new Blob(['poster-bytes'], { type: 'image/jpeg' });
      const artworkFetch = vi.fn(() => Promise.resolve(blob));

      const { unmount } = render(
        <LazyArtwork
          api={fakeApi(artworkFetch)}
          artwork={{ id: 'legacy-1', mimeType: 'image/jpeg' }}
          alt="Legacy poster"
          placeholder={<span>placeholder</span>}
          eager
        />,
      );

      expect(await screen.findByRole<HTMLImageElement>('img', { name: 'Legacy poster' })).toBeTruthy();
      expect(artworkFetch).toHaveBeenCalledWith({ id: 'legacy-1', mimeType: 'image/jpeg' });
      unmount();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('retries a failed capability image twice immediately, then falls back to the placeholder and rearms after a delay', () => {
    // A plain <img> never retries a failed load on its own — a transient
    // blip must be handled here, the same way LegacyLazyArtwork's decode
    // failures already are.
    vi.useFakeTimers();
    try {
      render(
        <LazyArtwork
          api={fakeApi()}
          artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=abc' }}
          alt="Movie poster"
          placeholder={<span>placeholder</span>}
        />,
      );

      fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
      expect(screen.getByRole('img', { name: 'Movie poster' })).toBeTruthy();

      fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
      expect(screen.getByRole('img', { name: 'Movie poster' })).toBeTruthy();

      fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
      expect(screen.queryByRole('img', { name: 'Movie poster' })).toBeNull();
      expect(screen.getByText('placeholder')).toBeTruthy();

      act(() => { vi.advanceTimersByTime(VISIBLE_ARTWORK_RECOVERY_DELAY_MS); });
      expect(screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' }).src).toContain('/signed/poster-1?sig=abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets retry state when a fresh capability URL arrives for the same artwork', () => {
    const { rerender } = render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=old' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
    fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
    fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
    expect(screen.queryByRole('img', { name: 'Movie poster' })).toBeNull();

    rerender(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=new' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' }).src).toContain('sig=new');
  });

  it('shows the placeholder when there is no artwork at all', () => {
    render(
      <LazyArtwork
        api={fakeApi()}
        artwork={undefined}
        placeholder={<span>no artwork</span>}
      />,
    );

    expect(screen.getByText('no artwork')).not.toBeNull();
  });

  it('ignores a re-signed URL for an artwork already loaded, so a re-fetch does not smash the browser cache', () => {
    // The server re-signs exp/sig on every catalogue re-fetch even when the
    // image hasn't changed. Once this artwork id has loaded successfully
    // once, a merely-reissued URL for the same id must not force a new
    // <img src> — that would be a fresh HTTP-cache key for identical bytes.
    const { rerender } = render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=first' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Movie poster' }));

    rerender(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=second' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' }).src).toContain('sig=first');
  });

  it('adopts a fresh remount of the same artwork id from wherever it last loaded, across component instances', () => {
    // The point of caching by id (not by component instance) is surviving a
    // full unmount/remount of the card — e.g. navigating away from Home and
    // back, which is exactly when the catalogue re-fetch reissues the URL.
    const { unmount } = render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-2', mimeType: 'image/jpeg', url: '/signed/poster-2?sig=first' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Movie poster' }));
    unmount();

    render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-2', mimeType: 'image/jpeg', url: '/signed/poster-2?sig=second' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' }).src).toContain('sig=first');
  });

  it('falls back to the fresh URL once the cached copy actually fails', () => {
    const { rerender } = render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-3', mimeType: 'image/jpeg', url: '/signed/poster-3?sig=stale' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Movie poster' }));

    fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
    fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
    fireEvent.error(screen.getByRole('img', { name: 'Movie poster' }));
    expect(screen.queryByRole('img', { name: 'Movie poster' })).toBeNull();

    rerender(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-3', mimeType: 'image/jpeg', url: '/signed/poster-3?sig=fresh' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' }).src).toContain('sig=fresh');
  });

  it('loads a never-before-seen artwork id from its given URL, not some other id\'s cached entry', () => {
    render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-unique', mimeType: 'image/jpeg', url: '/signed/poster-unique?sig=only' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' }).src).toContain('sig=only');
  });
});
