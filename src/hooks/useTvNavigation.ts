import { useEffect } from 'react';
import { SamsungDpadInput, type SamsungDpadCommand, type SamsungDpadDirection } from '../platform/SamsungDpadInput';
import { buildPlatformTraits } from '../platform/traits';

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

/**
 * Whether a focused editor should keep this command rather than let it move
 * focus elsewhere.
 *
 * Editors own the caret keys and Enter. **No editor owns up and down**, and
 * that includes the multi-line ones. On a D-pad, up and down are the only way
 * between controls, so an editor that keeps them is an editor the viewer
 * cannot leave except by pressing Back and losing the form.
 *
 * Textarea used to be excepted here, on the grounds that it genuinely uses up
 * and down to move between lines. True, and beside the point: the endpoints
 * box is a textarea, and on the television it was a trap. Caret movement
 * within a line is what left and right are for; moving between controls is
 * what up and down are for, and a viewer who cannot reach the Save button has
 * lost more than a viewer who cannot reach line two.
 */
export function tvTextEditingOwnsCommand(value: unknown, command: SamsungDpadCommand): boolean {
  if (!isTextEditingElement(value)) return false;
  return command !== 'up' && command !== 'down';
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

/**
 * How far a candidate is in the direction pressed, or null when it is not in
 * that direction at all. Judged from the current element's edges, not its
 * centre: a search field spanning most of its row has its centre far from its
 * right edge, and by centres every result card right of that middle counted
 * as "right" of the field and beat the sort control beside it. Found by the
 * Android TV client, which ported this scorer and changed it in step.
 */
function scoreTvCandidate(current: DOMRect, candidate: DOMRect, direction: SamsungDpadDirection): { score: number; inLane: boolean } | null {
  const tx = candidate.left + candidate.width / 2;
  const ty = candidate.top + candidate.height / 2;

  if (direction === 'left' && tx >= current.left) return null;
  if (direction === 'right' && tx <= current.left + current.width) return null;
  if (direction === 'up' && ty >= current.top) return null;
  if (direction === 'down' && ty <= current.top + current.height) return null;

  const horizontal = direction === 'left' || direction === 'right';
  const primary = horizontal
    ? rectGap(current.left, current.width, candidate.left, candidate.width)
    : rectGap(current.top, current.height, candidate.top, candidate.height);
  const secondary = horizontal
    ? Math.abs(ty - (current.top + current.height / 2))
    : Math.abs(tx - (current.left + current.width / 2));
  const laneGap = horizontal
    ? rectGap(current.top, current.height, candidate.top, candidate.height)
    : rectGap(current.left, current.width, candidate.left, candidate.width);

  return { score: primary + secondary * 0.2 + laneGap * 6, inLane: laneGap === 0 };
}

/**
 * The best candidate, the current row (or column) first: anything that
 * overlaps the current element across the direction of travel competes alone,
 * and the next row is reached only once this one runs out. The lane penalty
 * alone lost this: a far refresh on the same row scored worse than a near
 * card below it.
 */
function bestTvCandidate(current: HTMLElement, elements: HTMLElement[], direction: SamsungDpadDirection): HTMLElement | undefined {
  const currentRect = current.getBoundingClientRect();
  const scored = elements
    .filter((element) => element !== current)
    .map((element) => ({ element, result: scoreTvCandidate(currentRect, element.getBoundingClientRect(), direction) }))
    .filter((entry): entry is { element: HTMLElement; result: { score: number; inLane: boolean } } => entry.result !== null);
  const inLane = scored.filter((entry) => entry.result.inLane);
  return (inLane.length > 0 ? inLane : scored).sort((a, b) => a.result.score - b.result.score)[0]?.element;
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
    if (command !== 'back' && tvTextEditingOwnsCommand(document.activeElement, command)) return false;

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
      next = bestTvCandidate(current, elements, command);
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

export function requestTvDefaultFocus(): void {
  if (!buildPlatformTraits.usesDpadNavigation) return;
  window.setTimeout(() => window.dispatchEvent(new Event('macha:tv-focus-default')), 0);
}

export function useTvNavigation(onBack?: () => boolean): void {
  useEffect(() => {
    if (!buildPlatformTraits.usesDpadNavigation) return undefined;
    return attachSpatialTvNavigation(onBack);
  }, [onBack]);
}
