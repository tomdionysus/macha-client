import { useEffect } from 'react';
const SELECTOR = '[data-tv-focusable="true"]:not([disabled])';
function scoreCandidate(current, candidate, direction) {
    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;
    const tx = candidate.left + candidate.width / 2;
    const ty = candidate.top + candidate.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (direction === 'left' && dx >= -1)
        return null;
    if (direction === 'right' && dx <= 1)
        return null;
    if (direction === 'up' && dy >= -1)
        return null;
    if (direction === 'down' && dy <= 1)
        return null;
    const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    return primary + secondary * 2.5;
}
export function useTvNavigation() {
    useEffect(() => {
        const focusFirst = () => {
            if (document.activeElement === document.body || document.activeElement === null) {
                document.querySelector(SELECTOR)?.focus();
            }
        };
        const onKeyDown = (event) => {
            const keyToDirection = {
                ArrowLeft: 'left',
                ArrowRight: 'right',
                ArrowUp: 'up',
                ArrowDown: 'down',
            };
            const direction = keyToDirection[event.key];
            if (!direction)
                return;
            const active = document.activeElement;
            if (active instanceof HTMLInputElement && active.type === 'range' && (direction === 'left' || direction === 'right')) {
                return;
            }
            const elements = Array.from(document.querySelectorAll(SELECTOR));
            if (elements.length === 0)
                return;
            const current = document.activeElement instanceof HTMLElement && elements.includes(document.activeElement)
                ? document.activeElement
                : elements[0];
            const currentRect = current.getBoundingClientRect();
            const next = elements
                .filter((element) => element !== current)
                .map((element) => ({ element, score: scoreCandidate(currentRect, element.getBoundingClientRect(), direction) }))
                .filter((entry) => entry.score !== null)
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
    }, []);
}
