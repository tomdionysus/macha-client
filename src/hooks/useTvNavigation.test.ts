// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSpatialTvNavigation, isTextEditingElement, tvRangeOwnsDirection } from './useTvNavigation';

function element(tagName: string, options: { contentEditable?: boolean; role?: string; type?: string } = {}) {
  return {
    tagName,
    type: options.type,
    isContentEditable: options.contentEditable ?? false,
    getAttribute: (name: string) => name === 'role' ? options.role ?? null : null,
  };
}

describe('TV navigation editor policy', () => {
  it('leaves native editing controls in charge of keyboard input', () => {
    expect(isTextEditingElement(element('input'))).toBe(true);
    expect(isTextEditingElement(element('textarea'))).toBe(true);
    expect(isTextEditingElement(element('select'))).toBe(true);
    expect(isTextEditingElement(element('div', { contentEditable: true }))).toBe(true);
    expect(isTextEditingElement(element('div', { role: 'textbox' }))).toBe(true);
  });

  it('continues spatial navigation from ordinary controls', () => {
    expect(isTextEditingElement(element('button'))).toBe(false);
    expect(isTextEditingElement(element('a'))).toBe(false);
    expect(isTextEditingElement(undefined)).toBe(false);
    expect(isTextEditingElement(element('input', { type: 'range' }))).toBe(false);
  });

  it('leaves range Left/Right to seeking but routes Up/Down through focus navigation', () => {
    const range = element('input', { type: 'range' });
    expect(tvRangeOwnsDirection(range, 'left')).toBe(true);
    expect(tvRangeOwnsDirection(range, 'right')).toBe(true);
    expect(tvRangeOwnsDirection(range, 'up')).toBe(false);
    expect(tvRangeOwnsDirection(range, 'down')).toBe(false);
  });
});

describe('attachSpatialTvNavigation', () => {
  let detach: (() => void) | undefined;
  let top: HTMLButtonElement;
  let middle: HTMLButtonElement;
  let bottom: HTMLButtonElement;

  // jsdom reports every element's layout as zero-size by default; stub real,
  // vertically stacked rects so the geometry scorer (not the DOM-order
  // fallback) is what this test actually exercises.
  function stackRect(element: HTMLElement, top: number) {
    element.getBoundingClientRect = () => ({
      top, bottom: top + 50, left: 0, right: 50, width: 50, height: 50, x: 0, y: top, toJSON: () => ({}),
    });
  }

  function press(key: string, keyCode: number) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <button data-tv-focusable="true" id="top">Top</button>
      <button data-tv-focusable="true" id="middle">Middle</button>
      <button data-tv-focusable="true" id="bottom">Bottom</button>
    `;
    top = document.getElementById('top') as HTMLButtonElement;
    middle = document.getElementById('middle') as HTMLButtonElement;
    bottom = document.getElementById('bottom') as HTMLButtonElement;
    stackRect(top, 0);
    stackRect(middle, 100);
    stackRect(bottom, 200);
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    document.body.innerHTML = '';
  });

  it('selects the first focusable element on attach', () => {
    detach = attachSpatialTvNavigation();
    expect(top.getAttribute('data-tv-selected')).toBe('true');
    expect(document.activeElement).toBe(top);
  });

  it('moves selection down through visual order via ArrowDown', () => {
    // SamsungDpadInput suppresses a repeated command inside a short real-time
    // floor; advance a fake clock between presses so this test exercises
    // navigation, not that unrelated repeat-suppression policy.
    vi.useFakeTimers();
    try {
      detach = attachSpatialTvNavigation();
      press('ArrowDown', 40);
      expect(middle.getAttribute('data-tv-selected')).toBe('true');
      expect(top.getAttribute('data-tv-selected')).toBeNull();
      vi.advanceTimersByTime(200);
      press('ArrowDown', 40);
      expect(bottom.getAttribute('data-tv-selected')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('activates the selected element with Enter', () => {
    detach = attachSpatialTvNavigation();
    const onClick = vi.fn();
    top.addEventListener('click', onClick);
    press('Enter', 13);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('routes a Back command to the supplied handler instead of moving focus', () => {
    const onBack = vi.fn(() => true);
    detach = attachSpatialTvNavigation(onBack);
    press('Back', 10009);
    expect(onBack).toHaveBeenCalledOnce();
    expect(top.getAttribute('data-tv-selected')).toBe('true');
  });

  it('stops responding to keys once detached', () => {
    detach = attachSpatialTvNavigation();
    detach();
    detach = undefined;
    press('ArrowDown', 40);
    expect(middle.getAttribute('data-tv-selected')).toBeNull();
  });
});
