// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTWORK_HEDGE_DELAY_MS, type ArtworkRef, type MediaApi } from '@machafoundation/core';
import { LazyArtwork } from './LazyArtwork';
import { settle } from '../test/settle';

const FUTURE = '?exp=9999999999999&sig=abc';
const PAST = '?exp=1&sig=abc';

/**
 * Mirrors `MachaMediaApi.artworkUrls`: the ref's signed URL, that capability on
 * every node, then each node's authenticated URL, which an `<img>` cannot use.
 */
function fakeApi(
  artwork: MediaApi['artwork'] = vi.fn(() => Promise.reject(new Error('artwork() should not be called'))),
  nodes: string[] = ['http://node'],
): MediaApi {
  const artworkUrls = (ref: ArtworkRef) => {
    const query = ref.url ? ref.url.slice(ref.url.indexOf('?')) : '';
    return [
      ...(ref.url ? [{ url: ref.url, requiresAuthorization: false }] : []),
      ...(ref.url ? nodes.map((node) => ({ url: `${node}/api/v1/catalogue/artwork/${ref.id}${query}`, requiresAuthorization: false })) : []),
      ...nodes.map((node) => ({ url: `${node}/api/v1/catalogue/artwork/${ref.id}`, requiresAuthorization: true })),
    ];
  };
  return { artwork, artworkUrls, invalidateArtwork: vi.fn() } as unknown as MediaApi;
}

/**
 * Patches createObjectURL/revokeObjectURL, which jsdom lacks, and unmounts
 * before restoring them: RTL's own afterEach unmount would run after the restore.
 */
async function withObjectUrls(run: () => Promise<void>): Promise<void> {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  try {
    await run();
  } finally {
    cleanup();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

function poster(): HTMLImageElement {
  return screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' });
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

    expect(poster().src).toContain('/signed/poster-1?sig=abc');
    expect(poster().getAttribute('loading')).toBe('lazy');
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

  it('falls back to fetching artwork without a signed URL, for a node that has not upgraded', () => withObjectUrls(async () => {
    const blob = new Blob(['poster-bytes'], { type: 'image/jpeg' });
    const artworkFetch = vi.fn(() => Promise.resolve(blob));

    render(
      <LazyArtwork
        api={fakeApi(artworkFetch)}
        artwork={{ id: 'legacy-1', mimeType: 'image/jpeg' }}
        alt="Legacy poster"
        placeholder={<span>placeholder</span>}
        eager
      />,
    );

    await settle();
    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Legacy poster' })).toBeTruthy();
    expect(artworkFetch).toHaveBeenCalledWith({ id: 'legacy-1', mimeType: 'image/jpeg' });
  }));

  it('moves a failed image straight to the same capability on the next node, then to the authenticated fetch', () => withObjectUrls(async () => {
    const artworkFetch = vi.fn(() => Promise.resolve(new Blob(['poster-bytes'], { type: 'image/jpeg' })));
    const ref = { id: 'poster-1', mimeType: 'image/jpeg', url: `http://a/api/v1/catalogue/artwork/poster-1${FUTURE}` };
    render(
      <LazyArtwork
        api={fakeApi(artworkFetch, ['http://a', 'http://b'])}
        artwork={ref}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
        eager
      />,
    );
    expect(poster().src).toBe(`http://a/api/v1/catalogue/artwork/poster-1${FUTURE}`);

    fireEvent.error(poster());
    expect(poster().src).toBe(`http://b/api/v1/catalogue/artwork/poster-1${FUTURE}`);
    expect(artworkFetch).not.toHaveBeenCalled();

    fireEvent.error(poster());
    expect(artworkFetch).toHaveBeenCalledWith(ref);
    await settle();
    expect((screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' })).src).toBe('blob:fake');
  }));

  it('goes straight to the authenticated fetch when the cluster offers only one header-free source', () => withObjectUrls(async () => {
    // Which sources exist is core's call; an expired capability is re-hosted nowhere.
    const artworkFetch = vi.fn(() => Promise.resolve(new Blob(['poster-bytes'], { type: 'image/jpeg' })));
    const api = fakeApi(artworkFetch, ['http://a', 'http://b']);
    api.artworkUrls = (ref) => [
      { url: ref.url!, requiresAuthorization: false },
      { url: `http://a/api/v1/catalogue/artwork/${ref.id}`, requiresAuthorization: true },
      { url: `http://b/api/v1/catalogue/artwork/${ref.id}`, requiresAuthorization: true },
    ];
    render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: `http://a/api/v1/catalogue/artwork/poster-1${PAST}` }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
        eager
      />,
    );
    expect(poster().src).toContain(PAST);

    fireEvent.error(poster());

    // Never node b's authenticated URL: an <img> cannot send the header.
    expect(screen.queryByRole('img', { name: 'Movie poster' })).toBeNull();
    expect(artworkFetch).toHaveBeenCalled();
    await settle();
    expect((screen.getByRole<HTMLImageElement>('img', { name: 'Movie poster' })).src).toBe('blob:fake');
  }));

  it('adopts a fresh capability URL for the same artwork once the current one has failed', () => {
    const api = fakeApi();
    const { rerender } = render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=old' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.error(poster());
    expect(poster().src).toContain('sig=old');

    rerender(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=new' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(poster().src).toContain('sig=new');
  });

  it('adopts a fresh capability URL that arrived before the current one failed, rather than giving up on signed URLs', () => {
    // A fresh URL is ignored while the current one is loading, but kept for when that fails.
    const artworkFetch = vi.fn(() => new Promise<Blob>(() => undefined));
    const api = fakeApi(artworkFetch);
    const { rerender } = render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=old' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    rerender(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=new' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    expect(poster().src).toContain('sig=old');

    fireEvent.error(poster());

    expect(poster().src).toContain('sig=new');
    expect(artworkFetch).not.toHaveBeenCalled();
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
    // The server re-signs exp/sig on every catalogue re-fetch; a new <img src>
    // would be a fresh HTTP-cache key for identical bytes.
    const api = fakeApi();
    const { rerender } = render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=first' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.load(poster());

    rerender(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-1', mimeType: 'image/jpeg', url: '/signed/poster-1?sig=second' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(poster().src).toContain('sig=first');
  });

  it('adopts a fresh remount of the same artwork id from wherever it last loaded, across component instances', () => {
    // Cached by id, not component instance, to survive a remount such as navigating away and back.
    const { unmount } = render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-2', mimeType: 'image/jpeg', url: '/signed/poster-2?sig=first' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.load(poster());
    unmount();

    render(
      <LazyArtwork
        api={fakeApi()}
        artwork={{ id: 'poster-2', mimeType: 'image/jpeg', url: '/signed/poster-2?sig=second' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(poster().src).toContain('sig=first');
  });

  it('forgets a remembered URL that fails, and moves on to the fresh one', () => {
    const api = fakeApi();
    const { rerender } = render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-3', mimeType: 'image/jpeg', url: '/signed/poster-3?sig=stale' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    fireEvent.load(poster());
    rerender(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-3', mimeType: 'image/jpeg', url: '/signed/poster-3?sig=fresh' }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );
    expect(poster().src).toContain('sig=stale');

    fireEvent.error(poster());

    expect(poster().src).toContain('sig=fresh');
    expect(poster().src).not.toContain('sig=stale');
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

    expect(poster().src).toContain('sig=only');
  });
  // Core's `ArtworkHostPreference` orders the hosts. This client only reports
  // successful loads, so a single artwork 404 never moves the preference.
  it('reports the URL that actually loaded, so core can prefer that node next time', () => {
    const api = fakeApi();
    const noteArtworkLoaded = vi.fn();
    (api as { noteArtworkLoaded?: (url: string) => void }).noteArtworkLoaded = noteArtworkLoaded;
    render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-noted', mimeType: 'image/jpeg', url: `http://node/api/v1/catalogue/artwork/poster-noted${FUTURE}` }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    expect(noteArtworkLoaded).not.toHaveBeenCalled();
    fireEvent.load(poster());
    expect(noteArtworkLoaded).toHaveBeenCalledWith(poster().src);
  });

  it('tells core nothing when a source fails, so one missing object cannot move the preference', () => {
    const api = fakeApi();
    const noteArtworkLoaded = vi.fn();
    (api as { noteArtworkLoaded?: (url: string) => void }).noteArtworkLoaded = noteArtworkLoaded;
    render(
      <LazyArtwork
        api={api}
        artwork={{ id: 'poster-404', mimeType: 'image/jpeg', url: `http://node/api/v1/catalogue/artwork/poster-404${FUTURE}` }}
        alt="Movie poster"
        placeholder={<span>placeholder</span>}
      />,
    );

    fireEvent.error(poster());
    expect(noteArtworkLoaded).not.toHaveBeenCalled();
  });

  describe('a node that neither loads nor fails', () => {
    // A fresh id each time: the page remembers where each id last loaded.
    let id = '';
    let A = '';
    let B = '';
    beforeEach(() => {
      id = `hedged-${Math.random()}`;
      A = `http://a/api/v1/catalogue/artwork/${id}${FUTURE}`;
      B = `http://b/api/v1/catalogue/artwork/${id}${FUTURE}`;
    });

    function renderPoster(props: { eager?: boolean } = { eager: true }) {
      return render(
        <LazyArtwork
          api={fakeApi(undefined, ['http://a', 'http://b'])}
          artwork={{ id, mimeType: 'image/jpeg', url: A }}
          alt="Movie poster"
          placeholder={<span>placeholder</span>}
          {...props}
        />,
      );
    }

    function sources(container: HTMLElement): string[] {
      return [...container.querySelectorAll('img')].map((image) => image.src);
    }

    function elapse(ms: number) {
      act(() => { vi.advanceTimersByTime(ms); });
    }

    it('asks the next node as well once the delay passes, keeping the first request', () => {
      vi.useFakeTimers();
      try {
        const { container } = renderPoster();
        elapse(ARTWORK_HEDGE_DELAY_MS - 1);
        expect(sources(container)).toEqual([A]);
        elapse(1);
        expect(sources(container)).toEqual([A, B]);
        expect(poster().src).toBe(A);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows whichever node loads first and drops the other request', () => {
      vi.useFakeTimers();
      try {
        const { container } = renderPoster();
        elapse(ARTWORK_HEDGE_DELAY_MS);
        fireEvent.load(container.querySelectorAll('img')[1]);
        expect(sources(container)).toEqual([B]);
        expect(poster().src).toBe(B);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not race a poster that loaded in time', () => {
      vi.useFakeTimers();
      try {
        const { container } = renderPoster();
        fireEvent.load(poster());
        elapse(ARTWORK_HEDGE_DELAY_MS * 2);
        expect(sources(container)).toEqual([A]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets the raced request carry on alone when the first then fails', () => {
      vi.useFakeTimers();
      try {
        const { container } = renderPoster();
        elapse(ARTWORK_HEDGE_DELAY_MS);
        fireEvent.error(poster());
        expect(sources(container)).toEqual([B]);
        expect(poster().src).toBe(B);
      } finally {
        vi.useRealTimers();
      }
    });

    it('races a source on another host, not the next entry when that is the same host', () => {
      vi.useFakeTimers();
      try {
        const sameHost = `http://a/api/v1/catalogue/artwork/${id}?exp=9999999999999&sig=other`;
        const api = {
          artworkUrls: () => [A, sameHost, B].map((url) => ({ url, requiresAuthorization: false })),
          invalidateArtwork: vi.fn(),
        } as unknown as MediaApi;
        const { container } = render(
          <LazyArtwork api={api} artwork={{ id, mimeType: 'image/jpeg', url: A }} alt="Movie poster" placeholder={<span>placeholder</span>} eager />,
        );
        elapse(ARTWORK_HEDGE_DELAY_MS);
        expect(sources(container)).toEqual([A, B]);
        // Both fail: the same-host entry is still tried before giving up on signed URLs.
        fireEvent.error(container.querySelectorAll('img')[1]);
        fireEvent.error(poster());
        expect(sources(container)).toEqual([sameHost]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not race signed sources again once every one has failed and the authenticated fetch has taken over', () => withObjectUrls(async () => {
      vi.useFakeTimers();
      try {
        const artworkFetch = vi.fn(() => Promise.resolve(new Blob(['poster-bytes'], { type: 'image/jpeg' })));
        const { container } = render(
          <LazyArtwork api={fakeApi(artworkFetch, ['http://a', 'http://b'])} artwork={{ id, mimeType: 'image/jpeg', url: A }} alt="Movie poster" placeholder={<span>placeholder</span>} eager />,
        );
        fireEvent.error(poster());
        fireEvent.error(poster());
        elapse(ARTWORK_HEDGE_DELAY_MS * 2);
        expect(sources(container).filter((url) => url.startsWith('http://'))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    }));

    it('does not start the clock for a lazy poster until it nears the viewport', () => {
      vi.useFakeTimers();
      let reveal: (() => void) | undefined;
      const original = globalThis.IntersectionObserver;
      globalThis.IntersectionObserver = class {
        constructor(callback: IntersectionObserverCallback) {
          reveal = () => callback([{ isIntersecting: true, target: document.querySelector('.lazy-artwork')! } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof IntersectionObserver;
      try {
        const { container } = renderPoster({ eager: false });
        elapse(ARTWORK_HEDGE_DELAY_MS * 2);
        expect(sources(container)).toEqual([A]);
        act(() => reveal?.());
        elapse(ARTWORK_HEDGE_DELAY_MS);
        expect(sources(container)).toEqual([A, B]);
      } finally {
        globalThis.IntersectionObserver = original;
        vi.useRealTimers();
      }
    });
  });
});
