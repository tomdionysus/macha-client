const PRELOAD_MARGIN = '1000px';
type VisibilityListener = (intersecting: boolean) => void;

class SharedVisibilityObserver {
  private observer: IntersectionObserver | undefined;
  private readonly listeners = new Map<Element, Set<VisibilityListener>>();

  constructor(private readonly rootMargin: string) {}

  observe(element: Element, listener: VisibilityListener): () => void {
    let elementListeners = this.listeners.get(element);
    if (!elementListeners) {
      elementListeners = new Set();
      this.listeners.set(element, elementListeners);
      this.getObserver().observe(element);
    }
    elementListeners.add(listener);

    return () => {
      const current = this.listeners.get(element);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;
      this.listeners.delete(element);
      this.observer?.unobserve(element);
      if (this.listeners.size === 0) {
        this.observer?.disconnect();
        this.observer = undefined;
      }
    };
  }

  private getObserver(): IntersectionObserver {
    if (!this.observer) {
      this.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const callbacks = this.listeners.get(entry.target);
          if (!callbacks) continue;
          for (const callback of callbacks) callback(entry.isIntersecting);
        }
      }, { root: null, rootMargin: this.rootMargin, threshold: 0 });
    }
    return this.observer;
  }
}

const nearbyObserver = new SharedVisibilityObserver(PRELOAD_MARGIN);
const visibleObserver = new SharedVisibilityObserver('0px');

export function observeArtworkVisibility(
  element: Element,
  onNearby: VisibilityListener,
  onVisible: VisibilityListener,
): () => void {
  const stopNearby = nearbyObserver.observe(element, onNearby);
  const stopVisible = visibleObserver.observe(element, onVisible);
  return () => {
    stopNearby();
    stopVisible();
  };
}
