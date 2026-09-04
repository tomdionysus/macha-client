const DEFAULT_PRELOAD_MARGIN_PX = 1000;

type ProximityListener = () => void;

/**
 * One-shot proximity notice used by lazy artwork, backed by the browser's own
 * IntersectionObserver rather than hand-rolled scroll/resize polling.
 *
 * Registration is deliberately monotonic: once an element reaches the preload
 * region it is unobserved and its listener fires exactly once. Because the
 * browser itself re-runs intersection checks on any layout change (not just a
 * scroll or resize event), a card revealed by content moving elsewhere on the
 * page is never missed the way a scroll-only check would miss it.
 */
class BrowserArtworkViewport {
  private observer?: IntersectionObserver;
  private readonly listeners = new Map<Element, ProximityListener>();

  observe(element: Element, listener: ProximityListener): () => void {
    this.listeners.set(element, listener);
    this.ensureObserver().observe(element);
    return () => {
      this.listeners.delete(element);
      this.observer?.unobserve(element);
    };
  }

  private ensureObserver(): IntersectionObserver {
    this.observer ??= new IntersectionObserver(this.onIntersect, {
      rootMargin: `${DEFAULT_PRELOAD_MARGIN_PX}px`,
    });
    return this.observer;
  }

  private readonly onIntersect: IntersectionObserverCallback = (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const listener = this.listeners.get(entry.target);
      if (!listener) continue;
      this.listeners.delete(entry.target);
      this.observer?.unobserve(entry.target);
      listener();
    }
  };
}

let browserArtworkViewport: BrowserArtworkViewport | undefined;

/**
 * Notify once `element` is within the preload margin of the viewport.
 *
 * Falls back to loading immediately during server-side rendering and on the
 * rare browser with no IntersectionObserver (older Samsung Tizen firmware):
 * the same graceful-degradation shape this already used for SSR, just with
 * one more condition.
 */
export function observeArtworkProximity(element: Element, listener: ProximityListener): () => void {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    listener();
    return () => undefined;
  }
  browserArtworkViewport ??= new BrowserArtworkViewport();
  return browserArtworkViewport.observe(element, listener);
}
