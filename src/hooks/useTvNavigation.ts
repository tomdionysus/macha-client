import { useEffect } from 'react';

const SELECTOR = '[data-tv-focusable="true"]:not([disabled])';
const SELECTED_ATTRIBUTE = 'data-tv-selected';

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

function samsungElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
}

function markSamsungSelected(element: HTMLElement | undefined, elements: HTMLElement[]): void {
  for (const candidate of elements) candidate.removeAttribute(SELECTED_ATTRIBUTE);
  if (!element) return;
  element.setAttribute(SELECTED_ATTRIBUTE, 'true');
  element.focus();
}

function samsungSequentialCandidate(elements: HTMLElement[], current: HTMLElement, direction: Direction): HTMLElement | undefined {
  const index = elements.indexOf(current);
  if (index < 0) return elements[0];
  const delta = direction === 'left' || direction === 'up' ? -1 : 1;
  const next = index + delta;
  return next >= 0 && next < elements.length ? elements[next] : undefined;
}

function useSamsungNavigation(): () => void {
  const focusFirst = () => {
    const elements = samsungElements();
    if (elements.length === 0) return;
    const active = document.activeElement instanceof HTMLElement && elements.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : undefined;
    markSamsungSelected(active ?? elements[0], elements);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(SELECTOR)) return;
    markSamsungSelected(target, samsungElements());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keyToDirection: Partial<Record<string, Direction>> = {
      ArrowLeft: 'left', Left: 'left',
      ArrowRight: 'right', Right: 'right',
      ArrowUp: 'up', Up: 'up',
      ArrowDown: 'down', Down: 'down',
    };
    const keyCodeDirection: Partial<Record<number, Direction>> = {
      37: 'left', 38: 'up', 39: 'right', 40: 'down',
    };

    const elements = samsungElements();
    if (elements.length === 0) return;

    const active = document.activeElement instanceof HTMLElement && elements.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : undefined;
    const selected = elements.find((element) => element.getAttribute(SELECTED_ATTRIBUTE) === 'true');
    const current = active ?? selected ?? elements[0];

    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault();
      event.stopPropagation();
      markSamsungSelected(current, elements);
      current.click();
      return;
    }

    const direction = keyToDirection[event.key] ?? keyCodeDirection[event.keyCode];
    if (!direction) return;

    if (current instanceof HTMLInputElement && current.type === 'range' && (direction === 'left' || direction === 'right')) {
      return;
    }

    const currentRect = current.getBoundingClientRect();
    let next: HTMLElement | undefined = elements
      .filter((element) => element !== current)
      .map((element) => ({ element, score: scoreCandidate(currentRect, element.getBoundingClientRect(), direction) }))
      .filter((entry): entry is { element: HTMLElement; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score)[0]?.element;

    // Chromium 47 can briefly return degenerate geometry while the layout settles.
    // Keep the five-button remote deterministic rather than silently losing input.
    if (!next) next = samsungSequentialCandidate(elements, current, direction);
    if (!next) return;

    event.preventDefault();
    event.stopPropagation();
    markSamsungSelected(next, elements);
    next.scrollIntoView(false);
  };

  // Samsung recommends keydown on body/document. Capture phase ensures the
  // application sees D-pad input before React/input handlers consume it.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  focusFirst();
  const timer = window.setTimeout(focusFirst, 0);

  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
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

export function useTvNavigation(): void {
  useEffect(() => (
    import.meta.env.MODE === 'samsung'
      ? useSamsungNavigation()
      : useWebNavigation()
  ), []);
}
