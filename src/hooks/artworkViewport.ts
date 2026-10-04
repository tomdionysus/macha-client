const DEFAULT_PRELOAD_MARGIN_PX = 1000;

type ProximityListener = () => void;

/**
 * One-shot proximity notice for lazy artwork: an element is unobserved once it
 * reaches the preload region, and its listener fires exactly once.
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
 * Notifies once `element` is within the preload margin of the viewport;
 * immediately where there is no IntersectionObserver (SSR, older Tizen firmware).
 */
export function observeArtworkProximity(element: Element, listener: ProximityListener): () => void {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    listener();
    return () => undefined;
  }
  browserArtworkViewport ??= new BrowserArtworkViewport();
  return browserArtworkViewport.observe(element, listener);
}
