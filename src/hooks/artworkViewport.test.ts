import { describe, expect, it, vi } from 'vitest';
import { ArtworkViewportRegistry, isArtworkNearViewport } from './artworkViewport';

describe('lazy artwork viewport policy', () => {
  const viewport = { width: 1920, height: 1080 };

  it('preloads artwork before it enters the viewport', () => {
    expect(isArtworkNearViewport({ top: 1800, bottom: 2100, left: 100, right: 300 }, viewport, 1000)).toBe(true);
    expect(isArtworkNearViewport({ top: 2200, bottom: 2500, left: 100, right: 300 }, viewport, 1000)).toBe(false);
  });

  it('covers horizontal scrolling as well as vertical scrolling', () => {
    expect(isArtworkNearViewport({ top: 100, bottom: 400, left: 2500, right: 2800 }, viewport, 1000)).toBe(true);
    expect(isArtworkNearViewport({ top: 100, bottom: 400, left: 3100, right: 3400 }, viewport, 1000)).toBe(false);
  });

  it('fires a request exactly once after an item becomes nearby', () => {
    let rect = { top: 3000, bottom: 3300, left: 100, right: 300 };
    const element = { getBoundingClientRect: () => rect };
    const request = vi.fn();
    const registry = new ArtworkViewportRegistry(1000);
    registry.add(element, request);

    registry.evaluate(viewport);
    expect(request).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);

    rect = { top: 1900, bottom: 2200, left: 100, right: 300 };
    registry.evaluate(viewport);
    registry.evaluate(viewport);

    expect(request).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('does not let later scrolling revoke an already-triggered load', () => {
    let rect = { top: 100, bottom: 400, left: 100, right: 300 };
    const element = { getBoundingClientRect: () => rect };
    const request = vi.fn();
    const registry = new ArtworkViewportRegistry(1000);
    registry.add(element, request);

    registry.evaluate(viewport);
    rect = { top: 5000, bottom: 5300, left: 100, right: 300 };
    registry.evaluate(viewport);

    expect(request).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
