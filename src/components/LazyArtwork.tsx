import { useEffect, useState, type ReactNode } from 'react';
import type { MediaApi } from '@macha/core';
import { useViewportArtworkUrl, VISIBLE_ARTWORK_RECOVERY_DELAY_MS } from '../hooks/useViewportArtworkUrl';
import type { ArtworkRef } from '@macha/core';
import { createClientLogger } from '@macha/core';

const log = createClientLogger('artwork.image');

interface Props {
  api: MediaApi;
  artwork?: ArtworkRef;
  alt?: string;
  placeholder: ReactNode;
  draggable?: boolean;
  eager?: boolean;
}

/**
 * The server re-signs a capability URL's `exp`/`sig` on every catalogue
 * fetch of the same artwork, even when nothing about the image changed and
 * its previous signature hasn't actually expired yet. Handing each fresh
 * signature straight to `<img src>` makes every re-fetch a new browser
 * HTTP-cache key, so revisiting a screen re-downloads and re-decodes every
 * poster already on screen — the server's `Cache-Control` never gets a
 * chance to do anything, since the cache key itself is what's churning, not
 * a mismatch. This maps artwork id -> the last URL that actually loaded
 * successfully, so a same-image resign gets ignored in favor of the
 * already-cached one; a real failure (the cached copy genuinely expired or
 * evaporated) still falls through to the fresh URL the caller just gave us.
 */
const lastLoadedUrlById = new Map<string, string>();

/**
 * When the catalogue already handed us a short-lived signed capability URL,
 * the browser owns fetching, decode and caching — but NOT retry: a plain
 * `<img>` that fails once (a transient network blip, a node hiccup, a
 * truncated response) never retries itself, and with an empty `alt` a failed
 * image renders as nothing at all. Mirror `LegacyLazyArtwork`'s
 * fail-twice-immediately/fall-back-and-rearm shape (via `key` remounts,
 * since a capability `<img>` has no blob to invalidate) rather than trusting
 * the browser to cover for a dead source.
 */
function CapabilityArtwork({ id, url, alt, draggable, eager, placeholder }: { id: string; url: string; alt: string; draggable?: boolean; eager: boolean; placeholder: ReactNode }) {
  const [displayUrl, setDisplayUrl] = useState(() => lastLoadedUrlById.get(id) ?? url);
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    // A genuinely different artwork: prefer whatever we already know is
    // good for it, ignoring a merely re-signed URL for the same id (the
    // other effect below, keyed on `url`) until proven otherwise.
    setDisplayUrl(lastLoadedUrlById.get(id) ?? url);
    setAttempt(0);
    setFailures(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    // Only adopt a fresh URL for the SAME id once its predecessor has
    // exhausted its retries — otherwise this fires on every catalogue
    // re-signing of an artwork already loaded fine, smashing the cache for
    // no reason.
    if (failures < 3) return;
    setDisplayUrl(url);
    setAttempt((current) => current + 1);
    setFailures(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => {
    if (failures < 3) return undefined;
    const timer = setTimeout(() => { setFailures(0); setAttempt((current) => current + 1); }, VISIBLE_ARTWORK_RECOVERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failures]);

  const handleLoad = () => { lastLoadedUrlById.set(id, displayUrl); };

  const handleError = () => {
    if (failures >= 2) {
      setFailures(3);
      return;
    }
    setFailures((current) => current + 1);
    setAttempt((current) => current + 1);
  };

  return (
    <span className="lazy-artwork">
      {failures < 3
        ? <img key={attempt} src={displayUrl} alt={alt} decoding="async" draggable={draggable} loading={eager ? 'eager' : 'lazy'} onLoad={handleLoad} onError={handleError} />
        : placeholder}
    </span>
  );
}

export function LazyArtwork(props: Props) {
  return props.artwork?.url
    ? <CapabilityArtwork id={props.artwork.id} url={props.artwork.url} alt={props.alt ?? ''} draggable={props.draggable} eager={props.eager ?? false} placeholder={props.placeholder} />
    : <LegacyLazyArtwork {...props} />;
}

/**
 * Blob-fetch/cache/viewport-observer fallback for artwork without a signed
 * URL yet — a node that has not upgraded to serve one. Not reachable once
 * every known node has upgraded, but a mixed-version cluster is this
 * client's normal operating condition, not an edge case.
 */
function LegacyLazyArtwork({ api, artwork, alt = '', placeholder, draggable, eager = false }: Props) {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [decodeFailures, setDecodeFailures] = useState(0);
  const image = useViewportArtworkUrl(api, artwork, element, eager, decodeFailures);

  useEffect(() => setDecodeFailures(0), [api, artwork?.id]);
  useEffect(() => {
    if (decodeFailures < 3) return undefined;
    const timer = setTimeout(() => {
      log.info('decode-rearmed', { artworkId: artwork?.id });
      setDecodeFailures(0);
    }, VISIBLE_ARTWORK_RECOVERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [artwork?.id, decodeFailures]);

  const handleImageError = () => {
    if (!artwork) return;
    const attempt = decodeFailures + 1;
    log.warn('decode-failed', {
      artworkId: artwork.id,
      attempt,
      retryInMs: attempt >= 3 ? VISIBLE_ARTWORK_RECOVERY_DELAY_MS : 0,
    });
    api.invalidateArtwork?.(artwork);
    if (decodeFailures >= 2) {
      setDecodeFailures(3);
      return;
    }
    setDecodeFailures((failures) => failures + 1);
  };

  return (
    <span ref={setElement} className="lazy-artwork">
      {image && decodeFailures < 3
        ? <img src={image} alt={alt} decoding="async" draggable={draggable} onError={handleImageError} />
        : placeholder}
    </span>
  );
}
