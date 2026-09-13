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
 * Artwork id -> the last URL that actually loaded, so an identical image is
 * never asked for under a second name.
 *
 * This guards the *signature*: a node that re-signs a capability on every
 * catalogue read hands out a fresh `exp`/`sig` for bytes that have not
 * changed, and each fresh signature is a fresh browser cache key. Measured
 * against server 0.38.x on 2026-09-13 the signature is in fact stable — `exp`
 * is pinned to a UTC day boundary and is identical for every artwork object —
 * but a mixed-version cluster is this client's normal operating condition, so
 * the guard stays until no node re-signs.
 *
 * It cannot guard the *host*, which is the larger half of the same problem and
 * is core's `ArtworkHostPreference`: this map is module-scoped, so it
 * dies on reload and does not exist in a new tab, and it only knows about
 * artwork this page has already loaded. A failure forgets the entry and falls
 * through to whatever is next.
 */
const lastLoadedUrlById = new Map<string, string>();

/**
 * Everywhere the browser can load this artwork from on its own, best first:
 * the copy already known to be in its cache, then whatever order
 * `@machafoundation/core` gives — which now leads with the node that last
 * served artwork, so a pre-emptive endpoint swap no longer renames every
 * poster. That ordering was this client's for a few hours and is core's now,
 * because every client with a URL-keyed image cache has the same bug.
 * Anything wanting an `Authorization` header is not an `<img>` source at all,
 * and is dropped here rather than silently 401ing.
 */
function signedSources(api: MediaApi, artwork: SignedArtwork): string[] {
  const remembered = lastLoadedUrlById.get(artwork.id);
  const candidates = api.artworkUrls(artwork)
    .filter((source) => !source.requiresAuthorization)
    .map((source) => source.url);
  return [...new Set(remembered ? [remembered, ...candidates] : candidates)];
}

/**
 * When the catalogue handed us a signed capability URL, the browser owns
 * fetching, decode and caching — but not retry, and not failover. A plain
 * `<img>` that fails once never tries again, and with an empty `alt` it
 * renders as nothing at all. So a failure moves straight to the same
 * capability on the next node: a different node is a different failure
 * domain, and waiting before trying it would only make the viewer wait too.
 * Once every node has refused, the authenticated Blob path takes over: it
 * carries the bearer token, so it survives an expired signature (a Continue
 * Watching card rendered from storage a day later, say), and it already has
 * its own backoff, cluster walk and recovery. Nothing here needs a timer.
 *
 * A fresh URL for an artwork whose current source is still loading, or has
 * loaded, is ignored: it is a re-signing of identical bytes, and adopting it
 * would throw away the browser's cached copy for nothing. Once a source has
 * failed, the fresh URL is exactly what is wanted, whenever it arrived —
 * including before the failure, which is why a failure checks for one rather
 * than trusting an effect to have fired at the right moment.
 */
function CapabilityArtwork({ api, artwork, alt = '', placeholder, draggable, eager = false }: Props & { artwork: SignedArtwork }) {
  const [plan, setPlan] = useState(() => ({ signedBy: artwork.url, sources: signedSources(api, artwork) }));
  const [index, setIndex] = useState(0);

  const restart = () => {
    setPlan({ signedBy: artwork.url, sources: signedSources(api, artwork) });
    setIndex(0);
  };
  // A different artwork starts over from whatever is known to be good for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(restart, [api, artwork.id]);
  // The same artwork, re-signed, once the current signature has failed
  // somewhere — or everywhere, which is when it matters most.
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
 * Blob-fetch/cache/viewport-observer path, through this package's
 * authenticated fetch and cluster walk. The only path for artwork without a
 * signed URL — a node that has not upgraded to serve one, and a mixed-version
 * cluster is this client's normal operating condition, not an edge case —
 * and the last resort for artwork whose signed URL no node will honour.
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
