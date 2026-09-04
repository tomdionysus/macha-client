// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { observeArtworkProximity as ObserveArtworkProximity } from './artworkViewport';

/** jsdom implements no layout, so it never ships IntersectionObserver either; fake just enough of it to drive the code under test. */
class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [];
  observed = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rootMargin = String(options?.rootMargin ?? '');
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void { this.observed.add(element); }
  unobserve(element: Element): void { this.observed.delete(element); }
  disconnect(): void { this.observed.clear(); }
  takeRecords(): IntersectionObserverEntry[] { return []; }

  intersect(element: Element, isIntersecting: boolean): void {
    this.callback([{ target: element, isIntersecting } as IntersectionObserverEntry], this);
  }
}

describe('observeArtworkProximity', () => {
  let observeArtworkProximity: typeof ObserveArtworkProximity;

  // The module keeps one IntersectionObserver singleton for the app's whole
  // lifetime (correct in production); reset it here so each test starts from
  // a clean module and actually exercises its own fake observer.
  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    vi.resetModules();
    ({ observeArtworkProximity } = await import('./artworkViewport'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preloads a 1000px margin around the viewport', () => {
    observeArtworkProximity(document.createElement('div'), vi.fn());
    expect(FakeIntersectionObserver.instances[0]?.rootMargin).toBe('1000px');
  });

  it('fires the listener exactly once when the element intersects', () => {
    const element = document.createElement('div');
    const listener = vi.fn();
    observeArtworkProximity(element, listener);
    const observer = FakeIntersectionObserver.instances[0]!;

    observer.intersect(element, false);
    expect(listener).not.toHaveBeenCalled();

    observer.intersect(element, true);
    expect(listener).toHaveBeenCalledOnce();
    expect(observer.observed.has(element)).toBe(false);

    // A later, stale callback for the same (now unobserved) element must not
    // fire the listener again.
    observer.intersect(element, true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('reuses one observer across multiple elements', () => {
    observeArtworkProximity(document.createElement('div'), vi.fn());
    observeArtworkProximity(document.createElement('div'), vi.fn());
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  it('stops listening once the returned cleanup runs, before any intersection', () => {
    const element = document.createElement('div');
    const listener = vi.fn();
    const stop = observeArtworkProximity(element, listener);
    const observer = FakeIntersectionObserver.instances[0]!;

    stop();
    expect(observer.observed.has(element)).toBe(false);
    observer.intersect(element, true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('loads immediately when IntersectionObserver is unavailable', async () => {
    // @ts-expect-error simulating an older browser (e.g. Samsung Tizen 3) with no IntersectionObserver
    delete window.IntersectionObserver;
    vi.resetModules();
    ({ observeArtworkProximity } = await import('./artworkViewport'));
    const listener = vi.fn();

    const stop = observeArtworkProximity(document.createElement('div'), listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(stop).not.toThrow();
  });
});
