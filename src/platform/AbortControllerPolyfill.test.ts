import { describe, expect, it, vi } from 'vitest';
import { installAbortControllerPolyfill } from './AbortControllerPolyfill';

describe('legacy AbortController compatibility', () => {
  it('installs only when the browser has no native implementation', () => {
    const target: { AbortController?: typeof AbortController; AbortSignal?: typeof AbortSignal } = {};
    expect(installAbortControllerPolyfill(target)).toBe(true);
    expect(typeof target.AbortController).toBe('function');
    expect(typeof target.AbortSignal).toBe('function');
    expect(installAbortControllerPolyfill(target)).toBe(false);
  });

  it('marks the signal, retains the reason and dispatches abort once', () => {
    const target: { AbortController?: typeof AbortController; AbortSignal?: typeof AbortSignal } = {};
    installAbortControllerPolyfill(target);
    const controller = new target.AbortController!();
    const listener = vi.fn();
    controller.signal.addEventListener('abort', listener, { once: true });
    const reason = new Error('superseded');

    controller.abort(reason);
    controller.abort(new Error('ignored'));

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(reason);
    expect(listener).toHaveBeenCalledOnce();
    expect(() => controller.signal.throwIfAborted()).toThrow(reason);
  });

  it('supports listener removal used by bounded request cleanup', () => {
    const target: { AbortController?: typeof AbortController; AbortSignal?: typeof AbortSignal } = {};
    installAbortControllerPolyfill(target);
    const controller = new target.AbortController!();
    const listener = vi.fn();
    controller.signal.addEventListener('abort', listener);
    controller.signal.removeEventListener('abort', listener);
    controller.abort();
    expect(listener).not.toHaveBeenCalled();
  });
});
