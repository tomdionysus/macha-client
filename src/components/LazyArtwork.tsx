import { useEffect, useState, type ReactNode } from 'react';
import type { ArtworkRef, MediaApi } from '@machafoundation/core';
import { createClientLogger } from '@machafoundation/core';
import { useViewportArtworkUrl, VISIBLE_ARTWORK_RECOVERY_DELAY_MS } from '../hooks/useViewportArtworkUrl';

const log = createClientLogger('artwork.image');

interface Props {
  api: MediaApi;
  artwork?: ArtworkRef;
  alt?: string;
  placeholder: ReactNode;
  draggable?: boolean;
  eager?: boolean;
}

type SignedArtwork = ArtworkRef & { url: string };

function isSigned(artwork?: ArtworkRef): artwork is SignedArtwork {
  return Boolean(artwork?.url);
}

/**
 * Artwork id -> the last URL that loaded. A node may re-sign unchanged bytes, and each
 * signature is a new browser cache key. A failure forgets the entry. Page-scoped; the
 * host is core's `ArtworkHostPreference`.
 */
const lastLoadedUrlById = new Map<string, string>();

/**
 * `<img>`-loadable sources, best first: the URL known to be cached, then core's order.
 * Sources needing an `Authorization` header are dropped.
 */
function signedSources(api: MediaApi, artwork: SignedArtwork): string[] {
  const remembered = lastLoadedUrlById.get(artwork.id);
  const candidates = api.artworkUrls(artwork)
    .filter((source) => !source.requiresAuthorization)
    .map((source) => source.url);
  return [...new Set(remembered ? [remembered, ...candidates] : candidates)];
}

/**
 * Signed-URL artwork. A failed `<img>` moves at once to the next node; when every node
 * has refused, the authenticated Blob path takes over, which survives an expired signature.
 * A re-signed URL is ignored unless a source has failed, since adopting it would discard
 * the browser's cached copy; a failure checks for one itself, as it may have arrived earlier.
 */
function CapabilityArtwork({ api, artwork, alt = '', placeholder, draggable, eager = false }: Props & { artwork: SignedArtwork }) {
  const [plan, setPlan] = useState(() => ({ signedBy: artwork.url, sources: signedSources(api, artwork) }));
  const [index, setIndex] = useState(0);

  const restart = () => {
    setPlan({ signedBy: artwork.url, sources: signedSources(api, artwork) });
    setIndex(0);
  };
  // A different artwork starts over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(restart, [api, artwork.id]);
  // The same artwork re-signed, once the current signature has failed somewhere.
  useEffect(() => {
    if (index > 0) restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artwork.url]);

  if (index >= plan.sources.length) {
    return <LegacyLazyArtwork api={api} artwork={artwork} alt={alt} placeholder={placeholder} draggable={draggable} eager={eager} />;
  }

  const url = plan.sources[index];
  const handleError = () => {
    if (lastLoadedUrlById.get(artwork.id) === url) lastLoadedUrlById.delete(artwork.id);
    const resigned = artwork.url !== plan.signedBy;
    const exhausted = index + 1 >= plan.sources.length;
    log.warn('capability-failed', {
      artworkId: artwork.id,
      source: index + 1,
      sources: plan.sources.length,
      next: resigned ? 'fresh-capability' : exhausted ? 'authenticated-fetch' : 'next-node',
    });
    if (resigned) restart();
    else setIndex(index + 1);
  };

  return (
    <span className="lazy-artwork">
      <img
        key={url}
        src={url}
        alt={alt}
        draggable={draggable}
        loading={eager ? 'eager' : 'lazy'}
        onLoad={() => { lastLoadedUrlById.set(artwork.id, url); api.noteArtworkLoaded?.(url); }}
        onError={handleError}
      />
    </span>
  );
}

export function LazyArtwork(props: Props) {
  return isSigned(props.artwork)
    ? <CapabilityArtwork {...props} artwork={props.artwork} />
    : <LegacyLazyArtwork {...props} />;
}

/**
 * The authenticated Blob path, with its own cache, viewport observer and cluster walk: for
 * a node that serves no signed URL, and the last resort when no node honours one.
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
