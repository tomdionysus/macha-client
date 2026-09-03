type AbortListener = EventListenerOrEventListenerObject;

interface ListenerEntry {
  listener: AbortListener;
  once: boolean;
}

function abortError(reason?: unknown): unknown {
  if (reason !== undefined) return reason;
  if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError');
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function abortEvent(): Event {
  if (typeof Event === 'function') return new Event('abort');
  const event = document.createEvent('Event');
  event.initEvent('abort', false, false);
  return event;
}

class LegacyAbortSignal {
  aborted = false;
  reason: unknown;
  onabort: ((this: AbortSignal, event: Event) => unknown) | null = null;
  private readonly listeners: ListenerEntry[] = [];

  addEventListener(type: string, listener: AbortListener | null, options?: boolean | AddEventListenerOptions): void {
    if (type !== 'abort' || !listener) return;
    const once = typeof options === 'object' && options !== null && options.once === true;
    if (!this.listeners.some((entry) => entry.listener === listener)) this.listeners.push({ listener, once });
  }

  removeEventListener(type: string, listener: AbortListener | null): void {
    if (type !== 'abort' || !listener) return;
    const index = this.listeners.findIndex((entry) => entry.listener === listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  dispatchEvent(event: Event): boolean {
    if (event.type !== 'abort') return true;
    this.onabort?.call(this as unknown as AbortSignal, event);
    for (const entry of [...this.listeners]) {
      if (typeof entry.listener === 'function') entry.listener.call(this, event);
      else entry.listener.handleEvent(event);
      if (entry.once) this.removeEventListener('abort', entry.listener);
    }
    return !event.defaultPrevented;
  }

  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }

  abort(reason?: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = abortError(reason);
    this.dispatchEvent(abortEvent());
  }
}

class LegacyAbortController {
  readonly signal = new LegacyAbortSignal() as unknown as AbortSignal;

  abort(reason?: unknown): void {
    (this.signal as unknown as LegacyAbortSignal).abort(reason);
  }
}

interface AbortGlobals {
  AbortController?: typeof AbortController;
  AbortSignal?: typeof AbortSignal;
}

/** Install only on legacy browsers; modern native cancellation is never replaced. */
export function installAbortControllerPolyfill(target: AbortGlobals): boolean {
  if (typeof target.AbortController === 'function') return false;
  target.AbortSignal = LegacyAbortSignal as unknown as typeof AbortSignal;
  target.AbortController = LegacyAbortController as unknown as typeof AbortController;
  return true;
}
