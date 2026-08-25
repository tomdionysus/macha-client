const DEFAULT_PRELOAD_MARGIN_PX = 1000;

interface ViewportElement {
  getBoundingClientRect(): RectLike;
}
type ProximityListener = () => void;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function isArtworkNearViewport(
  rect: RectLike,
  viewport: ViewportSize,
  marginPx = DEFAULT_PRELOAD_MARGIN_PX,
): boolean {
  return rect.bottom >= -marginPx
    && rect.top <= viewport.height + marginPx
    && rect.right >= -marginPx
    && rect.left <= viewport.width + marginPx;
}

/**
 * One-shot proximity registry used by lazy artwork.
 *
 * Registration is deliberately monotonic: once an element reaches the preload
 * region it is removed from the registry and its listener fires exactly once.
 * Scrolling away can never make an already-requested image "not requested"
 * again.
 */
export class ArtworkViewportRegistry {
  private readonly entries = new Map<ViewportElement, ProximityListener>();

  constructor(private readonly marginPx = DEFAULT_PRELOAD_MARGIN_PX) {}

  add(element: ViewportElement, listener: ProximityListener): () => void {
    this.entries.set(element, listener);
    return () => {
      if (this.entries.get(element) === listener) this.entries.delete(element);
    };
  }

  evaluate(viewport: ViewportSize): void {
    for (const [element, listener] of [...this.entries]) {
      if (!isArtworkNearViewport(element.getBoundingClientRect(), viewport, this.marginPx)) continue;
      this.entries.delete(element);
      listener();
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

class BrowserArtworkViewport {
  private readonly registry = new ArtworkViewportRegistry();
  private listening = false;
  private scheduled = false;

  observe(element: Element, listener: ProximityListener): () => void {
    const remove = this.registry.add(element, () => {
      listener();
      this.stopIfIdle();
    });
    this.start();
    this.schedule();
    return () => {
      remove();
      this.stopIfIdle();
    };
  }

  private start(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    // Capture scroll events so nested rails/containers are covered too. There
    // is one listener for the whole application, regardless of card count.
    window.addEventListener('scroll', this.schedule, true);
    window.addEventListener('resize', this.schedule);
  }

  private stopIfIdle(): void {
    if (!this.listening || this.registry.size !== 0 || typeof window === 'undefined') return;
    window.removeEventListener('scroll', this.schedule, true);
    window.removeEventListener('resize', this.schedule);
    this.listening = false;
  }

  private readonly schedule = (): void => {
    if (this.scheduled || typeof window === 'undefined') return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.registry.evaluate({ width: window.innerWidth, height: window.innerHeight });
      this.stopIfIdle();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 0);
    }
  };
}

const browserArtworkViewport = new BrowserArtworkViewport();

export function observeArtworkProximity(element: Element, listener: ProximityListener): () => void {
  if (typeof window === 'undefined') {
    listener();
    return () => undefined;
  }
  return browserArtworkViewport.observe(element, listener);
}
