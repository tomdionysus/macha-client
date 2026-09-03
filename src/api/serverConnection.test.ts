import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reportClusterReachable,
  reportClusterUnreachable,
  serverUnreachable,
  SERVER_REACHABLE_EVENT,
  SERVER_UNREACHABLE_EVENT,
} from './serverConnection';

describe('cluster reachability notification', () => {
  afterEach(() => {
    reportClusterReachable();
    vi.unstubAllGlobals();
  });

  it('publishes once per outage rather than once per endpoint failure', () => {
    const dispatchEvent = vi.fn();
    class TestCustomEvent {
      constructor(public readonly type: string, public readonly init?: CustomEventInit) {}
    }
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    reportClusterReachable();

    serverUnreachable();
    reportClusterUnreachable();
    reportClusterUnreachable();

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(SERVER_UNREACHABLE_EVENT);

    reportClusterReachable();
    expect(dispatchEvent.mock.calls[1]?.[0].type).toBe(SERVER_REACHABLE_EVENT);
    reportClusterUnreachable();
    expect(dispatchEvent).toHaveBeenCalledTimes(3);
  });
});
