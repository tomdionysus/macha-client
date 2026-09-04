import { useEffect } from 'react';
import { SamsungDpadInput, type SamsungDpadCommand, type SamsungDpadDirection } from '../platform/SamsungDpadInput';

const SELECTOR = '[data-tv-focusable="true"]:not([disabled])';
const SELECTED_ATTRIBUTE = 'data-tv-selected';
const DEFAULT_FOCUS_ATTRIBUTE = 'data-tv-default-focus';

function isRangeInput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const element = value as { tagName?: unknown; type?: unknown };
  return typeof element.tagName === 'string'
    && element.tagName.toUpperCase() === 'INPUT'
    && element.type === 'range';
}

export function tvRangeOwnsDirection(value: unknown, direction: SamsungDpadDirection): boolean {
  return isRangeInput(value) && (direction === 'left' || direction === 'right');
}

/** Editors own caret movement, selection controls and Enter while focused. */
export function isTextEditingElement(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const element = value as {
    tagName?: unknown;
    type?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return (tagName === 'INPUT' && !isRangeInput(element))
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || element.isContentEditable === true
    || element.getAttribute?.('role') === 'textbox';
}

function tvVisible(element: HTMLElement): boolean {
  const chrome = element.closest('.player-chrome');
  if (chrome && !chrome.classList.contains('visible')) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function tvElements(): HTMLElement[] {
  const fullPlayer = document.querySelector<HTMLElement>('.player-presentation-full');
  const scope = fullPlayer?.querySelector<HTMLElement>('.player-chrome.visible') ?? document;
  return Array.from(scope.querySelectorAll<HTMLElement>(SELECTOR)).filter(tvVisible);
}

function markTvSelected(element: HTMLElement | undefined, elements: HTMLElement[]): void {
  for (const candidate of elements) candidate.removeAttribute(SELECTED_ATTRIBUTE);
  if (!element) return;
  element.setAttribute(SELECTED_ATTRIBUTE, 'true');
  if (document.activeElement !== element) element.focus();
}

function rectGap(start: number, size: number, otherStart: number, otherSize: number): number {
  const end = start + size;
  const otherEnd = otherStart + otherSize;
  if (otherEnd < start) return start - otherEnd;
  if (otherStart > end) return otherStart - end;
  return 0;
}

function scoreTvCandidate(current: DOMRect, candidate: DOMRect, direction: SamsungDpadDirection): number | null {
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;
  const tx = candidate.left + candidate.width / 2;
  const ty = candidate.top + candidate.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  if (direction === 'left' && dx >= -1) return null;
  if (direction === 'right' && dx <= 1) return null;
  if (direction === 'up' && dy >= -1) return null;
  if (direction === 'down' && dy <= 1) return null;

  const horizontal = direction === 'left' || direction === 'right';
  const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
  const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
  const laneGap = horizontal
    ? rectGap(current.top, current.height, candidate.top, candidate.height)
    : rectGap(current.left, current.width, candidate.left, candidate.width);

  return primary + secondary * 0.2 + laneGap * 6;
}

function sequentialCandidate(elements: HTMLElement[], current: HTMLElement, direction: SamsungDpadDirection): HTMLElement | undefined {
  const index = elements.indexOf(current);
  if (index < 0) return elements[0];
  const delta = direction === 'left' || direction === 'up' ? -1 : 1;
  const next = index + delta;
  return next >= 0 && next < elements.length ? elements[next] : undefined;
}

/** Plain DOM wiring (not a hook) called from inside useTvNavigation's useEffect below. Exported so it's testable without a real Samsung/Android build mode. */
export function attachSpatialTvNavigation(onBack?: () => boolean): () => void {
  const focusFirst = () => {
    const elements = tvElements();
    if (elements.length === 0) return;
    const active = document.activeElement instanceof HTMLElement && elements.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : undefined;
    const selected = elements.find((element) => element.getAttribute(SELECTED_ATTRIBUTE) === 'true');
    const preferred = elements.find((element) => element.getAttribute(DEFAULT_FOCUS_ATTRIBUTE) === 'true');
    markTvSelected(active ?? selected ?? preferred ?? elements[0], elements);
  };

  const focusDefault = () => {
    const elements = tvElements();
    if (elements.length === 0) return;
    const preferred = elements.find((element) => element.getAttribute(DEFAULT_FOCUS_ATTRIBUTE) === 'true') ?? elements[0];
    markTvSelected(preferred, elements);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(SELECTOR) || !tvVisible(target)) return;
    markTvSelected(target, tvElements());
  };

  const onCommand = (command: SamsungDpadCommand): boolean => {
    if (command !== 'back' && isTextEditingElement(document.activeElement)) return false;

    const elements = tvElements();
    if (elements.length === 0) return false;

    const active = document.activeElement instanceof HTMLElement && elements.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : undefined;
    const selected = elements.find((element) => element.getAttribute(SELECTED_ATTRIBUTE) === 'true');
    const preferred = elements.find((element) => element.getAttribute(DEFAULT_FOCUS_ATTRIBUTE) === 'true');
    const current = active ?? selected ?? preferred ?? elements[0];

    if (command === 'back') return onBack?.() ?? false;

    if (command === 'activate') {
      markTvSelected(current, elements);
      current.click();
      return true;
    }

    if (tvRangeOwnsDirection(current, command)) {
      return false;
    }

    const currentRect = current.getBoundingClientRect();
    const geometryValid = currentRect.width > 0 && currentRect.height > 0;
    let next: HTMLElement | undefined;
    if (geometryValid) {
      next = elements
        .filter((element) => element !== current)
        .map((element) => ({ element, score: scoreTvCandidate(currentRect, element.getBoundingClientRect(), command) }))
        .filter((entry): entry is { element: HTMLElement; score: number } => entry.score !== null)
        .sort((a, b) => a.score - b.score)[0]?.element;
    } else {
      next = sequentialCandidate(elements, current, command);
    }
    if (!next) return false;

    markTvSelected(next, elements);
    next.scrollIntoView(false);
    return true;
  };

  const input = new SamsungDpadInput(onCommand);
  input.attach(document);
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('hashchange', focusFirst);
  window.addEventListener('macha:tv-focus-default', focusDefault);
  focusFirst();
  const timer = window.setTimeout(focusFirst, 0);

  return () => {
    window.clearTimeout(timer);
    input.detach();
    document.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('hashchange', focusFirst);
    window.removeEventListener('macha:tv-focus-default', focusDefault);
  };
}

function tvMode(): boolean {
  return import.meta.env.MODE === 'samsung' || import.meta.env.MODE === 'android';
}

export function requestTvDefaultFocus(): void {
  if (!tvMode()) return;
  window.setTimeout(() => window.dispatchEvent(new Event('macha:tv-focus-default')), 0);
}

export function useTvNavigation(onBack?: () => boolean): void {
  useEffect(() => {
    if (!tvMode()) return undefined;
    return attachSpatialTvNavigation(onBack);
  }, [onBack]);
}
