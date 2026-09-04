import { useEffect, useState, type ReactNode } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { useViewportArtworkUrl, VISIBLE_ARTWORK_RECOVERY_DELAY_MS } from '../hooks/useViewportArtworkUrl';
import type { ArtworkRef } from '../types';
import { createClientLogger } from '../diagnostics/ClientLog';

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
 * When the catalogue already handed us a short-lived signed capability URL,
 * the browser owns fetching, decode and caching — but NOT retry: a plain
 * `<img>` that fails once (a transient network blip, a node hiccup, a
 * truncated response) never retries itself, and with an empty `alt` a failed
 * image renders as nothing at all. Mirror `LegacyLazyArtwork`'s
 * fail-twice-immediately/fall-back-and-rearm shape (via `key` remounts,
 * since a capability `<img>` has no blob to invalidate) rather than trusting
 * the browser to cover for a dead source.
 */
function CapabilityArtwork({ url, alt, draggable, eager, placeholder }: { url: string; alt: string; draggable?: boolean; eager: boolean; placeholder: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);

  useEffect(() => { setAttempt(0); setFailures(0); }, [url]);
  useEffect(() => {
    if (failures < 3) return undefined;
    const timer = setTimeout(() => { setFailures(0); setAttempt((current) => current + 1); }, VISIBLE_ARTWORK_RECOVERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failures]);

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
        ? <img key={attempt} src={url} alt={alt} decoding="async" draggable={draggable} loading={eager ? 'eager' : 'lazy'} onError={handleError} />
        : placeholder}
    </span>
  );
}

export function LazyArtwork(props: Props) {
  return props.artwork?.url
    ? <CapabilityArtwork url={props.artwork.url} alt={props.alt ?? ''} draggable={props.draggable} eager={props.eager ?? false} placeholder={props.placeholder} />
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
