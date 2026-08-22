import { useEffect } from 'react';
import { SamsungDpadInput, type SamsungDpadCommand, type SamsungDpadDirection } from '../platform/SamsungDpadInput';

const SELECTOR = '[data-tv-focusable="true"]:not([disabled])';
const SELECTED_ATTRIBUTE = 'data-tv-selected';
const DEFAULT_FOCUS_ATTRIBUTE = 'data-tv-default-focus';

type Direction = 'left' | 'right' | 'up' | 'down';

function scoreCandidate(current: DOMRect, candidate: DOMRect, direction: Direction): number | null {
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

  const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
  const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
  return primary + secondary * 2.5;
}

function samsungVisible(element: HTMLElement): boolean {
  // Avoid getComputedStyle walks on every remote press: they are expensive on
  // Chromium 47. Geometry filters display:none/zero-size controls; the player
  // chrome is the one intentional opacity-hidden focus container.
  const chrome = element.closest('.player-chrome');
  if (chrome && !chrome.classList.contains('visible')) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function samsungElements(): HTMLElement[] {
  const fullPlayer = document.querySelector<HTMLElement>('.player-presentation-full');
  const scope = fullPlayer?.querySelector<HTMLElement>('.player-chrome.visible') ?? document;
  return Array.from(scope.querySelectorAll<HTMLElement>(SELECTOR)).filter(samsungVisible);
}

function markSamsungSelected(element: HTMLElement | undefined, elements: HTMLElement[]): void {
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

function scoreSamsungCandidate(current: DOMRect, candidate: DOMRect, direction: SamsungDpadDirection): number | null {
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

  // Prefer staying in the current visual row/column. Crossing a lane is
  // deliberately expensive so a remote press does not jump diagonally across
  // unrelated controls merely because their centres are slightly closer.
  return primary + secondary * 0.2 + laneGap * 6;
}

function samsungSequentialCandidate(elements: HTMLElement[], current: HTMLElement, direction: SamsungDpadDirection): HTMLElement | undefined {
  const index = elements.indexOf(current);
  if (index < 0) return elements[0];
  const delta = direction === 'left' || direction === 'up' ? -1 : 1;
  const next = index + delta;
  return next >= 0 && next < elements.length ? elements[next] : undefined;
}

function useSamsungNavigation(onBack?: () => boolean): () => void {
  const focusFirst = () => {
    const elements = samsungElements();
    if (elements.length === 0) return;
    const active = document.activeElement instanceof HTMLElement && elements.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : undefined;
    const selected = elements.find((element) => element.getAttribute(SELECTED_ATTRIBUTE) === 'true');
    const preferred = elements.find((element) => element.getAttribute(DEFAULT_FOCUS_ATTRIBUTE) === 'true');
    markSamsungSelected(active ?? selected ?? preferred ?? elements[0], elements);
  };

  const focusDefault = () => {
    const elements = samsungElements();
    if (elements.length === 0) return;
    const preferred = elements.find((element) => element.getAttribute(DEFAULT_FOCUS_ATTRIBUTE) === 'true') ?? elements[0];
    markSamsungSelected(preferred, elements);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(SELECTOR) || !samsungVisible(target)) return;
    markSamsungSelected(target, samsungElements());
  };

  const onCommand = (command: SamsungDpadCommand): boolean => {
    const elements = samsungElements();
    if (elements.length === 0) return false;

    const active = document.activeElement instanceof HTMLElement && elements.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : undefined;
    const selected = elements.find((element) => element.getAttribute(SELECTED_ATTRIBUTE) === 'true');
    const preferred = elements.find((element) => element.getAttribute(DEFAULT_FOCUS_ATTRIBUTE) === 'true');
    const current = active ?? selected ?? preferred ?? elements[0];

    if (command === 'back') return onBack?.() ?? false;

    if (command === 'activate') {
      markSamsungSelected(current, elements);
      current.click();
      return true;
    }

    if (current instanceof HTMLInputElement && current.type === 'range' && (command === 'left' || command === 'right')) {
      return false;
    }

    const currentRect = current.getBoundingClientRect();
    const geometryValid = currentRect.width > 0 && currentRect.height > 0;
    let next: HTMLElement | undefined;
    if (geometryValid) {
      next = elements
        .filter((element) => element !== current)
        .map((element) => ({ element, score: scoreSamsungCandidate(currentRect, element.getBoundingClientRect(), command) }))
        .filter((entry): entry is { element: HTMLElement; score: number } => entry.score !== null)
        .sort((a, b) => a.score - b.score)[0]?.element;
    } else {
      // Only use DOM order when Chromium has not produced usable geometry yet.
      next = samsungSequentialCandidate(elements, current, command);
    }
    if (!next) return false;

    markSamsungSelected(next, elements);
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

function useWebNavigation(): () => void {
  const focusFirst = () => {
    if (document.activeElement === document.body || document.activeElement === null) {
      (document.querySelector(SELECTOR) as HTMLElement | null)?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keyToDirection: Partial<Record<string, Direction>> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    };
    const direction = keyToDirection[event.key];
    if (!direction) return;

    const elements = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    if (elements.length === 0) return;
    const current = document.activeElement instanceof HTMLElement && elements.includes(document.activeElement)
      ? document.activeElement
      : elements[0];

    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type === 'range' && (direction === 'left' || direction === 'right')) {
      return;
    }

    const currentRect = current.getBoundingClientRect();
    const next = elements
      .filter((element) => element !== current)
      .map((element) => ({ element, score: scoreCandidate(currentRect, element.getBoundingClientRect(), direction) }))
      .filter((entry): entry is { element: HTMLElement; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score)[0]?.element;

    if (next) {
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('load', focusFirst, { once: true });
  void Promise.resolve().then(focusFirst);
  return () => window.removeEventListener('keydown', onKeyDown);
}

export function requestTvDefaultFocus(): void {
  if (import.meta.env.MODE !== 'samsung') return;
  window.setTimeout(() => window.dispatchEvent(new Event('macha:tv-focus-default')), 0);
}

export function useTvNavigation(onBack?: () => boolean): void {
  useEffect(() => (
    import.meta.env.MODE === 'samsung'
      ? useSamsungNavigation(onBack)
      : useWebNavigation()
  ), [onBack]);
}
