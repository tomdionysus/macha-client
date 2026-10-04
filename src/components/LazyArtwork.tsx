import { useEffect, useState, type ReactNode } from 'react';
import type { ArtworkRef, MediaApi } from '@machafoundation/core';
import { artworkHostOf, createClientLogger } from '@machafoundation/core';
import { useViewportArtworkUrl, VISIBLE_ARTWORK_RECOVERY_DELAY_MS } from '../hooks/useViewportArtworkUrl';
import { observeArtworkProximity } from '../hooks/artworkViewport';

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
 * How long a visible poster may go unloaded before the next node is asked as well. A host
 * that drops packets fails an `<img>` only after ~15 s, and core charges it 8-18 s after it
 * dies; the first request is never cancelled, so a slow but working link still wins.
 */
export const ARTWORK_HEDGE_DELAY_MS = 2000;

interface Attempt {
  signedBy: string;
  sources: string[];
  /** Indexes of `sources` in flight, the shown one first. At most two. */
  inFlight: number[];
  /** Indexes started, in flight or done. */
  tried: number[];
  loaded: boolean;
  failed: boolean;
}

function attempt(api: MediaApi, artwork: SignedArtwork): Attempt {
  const sources = signedSources(api, artwork);
  const first = sources.length > 0 ? [0] : [];
  return { signedBy: artwork.url, sources, inFlight: first, tried: first, loaded: false, failed: false };
}

const hostOf = (url: string) => artworkHostOf(url) ?? url;

/** The first untried source, or with `hedge`, the first on a host not already in flight. */
function nextSource(plan: Attempt, hedge: boolean): number | undefined {
  const busy = new Set(plan.inFlight.map((index) => hostOf(plan.sources[index])));
  const index = plan.sources.findIndex((url, candidate) =>
    !plan.tried.includes(candidate) && !(hedge && busy.has(hostOf(url))));
  return index < 0 ? undefined : index;
}

function hedged(plan: Attempt): Attempt {
  const index = plan.inFlight.length === 1 && !plan.loaded ? nextSource(plan, true) : undefined;
  return index === undefined ? plan : { ...plan, inFlight: [...plan.inFlight, index], tried: [...plan.tried, index] };
}

/**
 * Signed-URL artwork. A failed `<img>` moves at once to the next node; one that has not
 * loaded within `ARTWORK_HEDGE_DELAY_MS` of being near the viewport is raced against the
 * next source on another host, and the first to load is shown. When every node has refused, the authenticated
 * Blob path takes over, which survives an expired signature. A re-signed URL is ignored
 * unless a source has failed, since adopting it would discard the browser's cached copy; a
 * failure checks for one itself, as it may have arrived earlier.
 */
function CapabilityArtwork({ api, artwork, alt = '', placeholder, draggable, eager = false }: Props & { artwork: SignedArtwork }) {
  const [plan, setPlan] = useState(() => attempt(api, artwork));
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(eager);

  const restart = () => setPlan(attempt(api, artwork));
  // A different artwork starts over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(restart, [api, artwork.id]);
  // The same artwork re-signed, once the current signature has failed somewhere.
  useEffect(() => {
    if (plan.failed) restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artwork.url]);

  useEffect(() => {
    if (eager || !element) return undefined;
    return observeArtworkProximity(element, () => setNear(true));
  }, [eager, element]);

  const canHedge = near && hedged(plan) !== plan;
  useEffect(() => {
    if (!canHedge) return undefined;
    const timer = setTimeout(() => {
      log.info('capability-hedged', { artworkId: artwork.id, sources: plan.sources.length });
      setPlan(hedged);
    }, ARTWORK_HEDGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canHedge, plan.inFlight, plan.sources.length, artwork.id]);

  if (plan.inFlight.length === 0) {
    return <LegacyLazyArtwork api={api} artwork={artwork} alt={alt} placeholder={placeholder} draggable={draggable} eager={eager} />;
  }

  const handleLoad = (index: number) => {
    const url = plan.sources[index];
    lastLoadedUrlById.set(artwork.id, url);
    api.noteArtworkLoaded?.(url);
    // Unmounting the loser cancels its request.
    setPlan((current) => ({ ...current, inFlight: [index], loaded: true }));
  };

  const handleError = (index: number) => {
    const url = plan.sources[index];
    if (lastLoadedUrlById.get(artwork.id) === url) lastLoadedUrlById.delete(artwork.id);
    const resigned = artwork.url !== plan.signedBy;
    const others = plan.inFlight.filter((other) => other !== index);
    const next = others.length === 0 ? nextSource(plan, false) : undefined;
    const exhausted = others.length === 0 && next === undefined;
    log.warn('capability-failed', {
      artworkId: artwork.id,
      source: index + 1,
      sources: plan.sources.length,
      next: resigned ? 'fresh-capability' : others.length > 0 ? 'in-flight' : exhausted ? 'authenticated-fetch' : 'next-node',
    });
    if (resigned) restart();
    else if (next === undefined) setPlan({ ...plan, inFlight: others, failed: true });
    else setPlan({ ...plan, inFlight: [next], tried: [...plan.tried, next], failed: true });
  };

  return (
    <span ref={setElement} className="lazy-artwork">
      {plan.inFlight.map((index, position) => {
        const url = plan.sources[index];
        const shown = position === 0;
        return (
          <img
            key={url}
            src={url}
            alt={shown ? alt : ''}
            aria-hidden={shown ? undefined : true}
            className={shown ? undefined : 'lazy-artwork-hedge'}
            draggable={draggable}
            loading={eager || !shown ? 'eager' : 'lazy'}
            onLoad={() => handleLoad(index)}
            onError={() => handleError(index)}
          />
        );
      })}
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
