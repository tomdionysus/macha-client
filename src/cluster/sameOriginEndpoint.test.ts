// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { confirmMachaEndpoint, sameOriginCandidate, useSameOriginEndpoint } from './sameOriginEndpoint';

function answer(status: number, contentType: string | null, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => {
      if (typeof body === 'string') return JSON.parse(body) as unknown;
      return body;
    },
  } as unknown as Response;
}

function answering(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

const macha = (status: string, extra: Record<string, unknown> = {}) =>
  answering(answer(status === 'ok' ? 200 : 503, 'application/json; charset=utf-8', { status, ...extra }));

describe('confirmMachaEndpoint', () => {
  /**
   * The failure this whole check exists for, and the one that makes a status
   * check unusable.
   *
   * `README.md` states the deployment requirement: the web host must serve
   * `index.html` for unknown application paths, or a deep link never reaches
   * React Router. So a host serving this bundle and **not** running Macha
   * answers `200` at `/api/v1/health` — with the application shell. Anything
   * keyed on `response.ok` adopts that host, and then every API call fails
   * against a pile of HTML.
   *
   * This test goes red against the obvious implementation, which is the only
   * reason to trust it green.
   */
  it('refuses this client\'s own web host, which answers 200 for every unknown path', async () => {
    const spa = answering(answer(200, 'text/html; charset=utf-8', '<!doctype html><title>Macha</title>'));
    expect(await confirmMachaEndpoint('https://media.example.com', spa)).toBeUndefined();
  });

  // Measured against the live cluster 2026-09-15: the body is exactly
  // `{"status":"ok"}`, 15 bytes, no product or version field.
  it('confirms a node serving', async () => {
    expect(await confirmMachaEndpoint('https://node', macha('ok'))).toEqual({
      status: 'ok',
      version: undefined,
      marked: false,
    });
  });

  /**
   * Identity and readiness are different questions. A node that is still
   * recovering has identified itself, and the health monitor owns whether it
   * can be used yet — so refusing it here would send a viewer who powered on
   * their server and their television together to an endpoint form, seconds
   * before the node they are already pointing at starts answering.
   */
  it('confirms a node that is starting, and one that has failed', async () => {
    expect(await confirmMachaEndpoint('https://node', macha('starting'))).toMatchObject({ status: 'starting' });
    expect(await confirmMachaEndpoint('https://node', macha('failed'))).toMatchObject({ status: 'failed' });
  });

  /**
   * Server 0.43.0 refuses work when the control lane's queue is full, with a
   * 503 and `Retry-After`. The refusal body deliberately keeps `service` and
   * `status`, so it still identifies the node — and a node that is busy is one
   * to wait for, not evidence that the address is not Macha. Refusing it would
   * put an endpoint form in front of a viewer during a load spike, on a node
   * that is plainly there.
   */
  it('confirms a node refusing work because it is busy', async () => {
    const overloaded = answering(answer(503, 'application/json', {
      service: 'macha',
      status: 'busy',
      error: { code: 'overloaded', message: 'the node is busy; retry shortly' },
    }));
    expect(await confirmMachaEndpoint('https://node', overloaded)).toEqual({ status: 'busy', marked: true });
  });

  // `busy` is a 503 like the other two, and the pairing rule still holds: a
  // body claiming to be busy on a 200 is not this contract being answered.
  it('refuses a busy body that arrives with a 200', async () => {
    const inconsistent = answering(answer(200, 'application/json', { service: 'macha', status: 'busy' }));
    expect(await confirmMachaEndpoint('https://node', inconsistent)).toBeUndefined();
  });

  /**
   * The marker the server is adding: `{"service":"macha","status":"ok"}` and
   * nothing more. It carries no version deliberately — an unauthenticated
   * route that answers anyone who can reach the port does not get to say which
   * build it is, and the server has a test from 0.38.5 asserting so.
   *
   * Asserted conditionally, so a cluster whose nodes drift apart keeps
   * working: absent is tolerated, present and wrong is a refusal.
   */
  it('reports the product marker when a node states one', async () => {
    const marked = macha('ok', { service: 'macha' });
    expect(await confirmMachaEndpoint('https://node', marked)).toEqual({ status: 'ok', marked: true });
  });

  it('refuses a JSON service that names itself as something else', async () => {
    const other = macha('ok', { service: 'nginx' });
    expect(await confirmMachaEndpoint('https://node', other)).toBeUndefined();
  });

  // A node older than 0.38.5 has no liveness route, and answers 401 rather
  // than 404 because authentication happens before routing. Not identifiable,
  // so not adoptable — the viewer sees the endpoint screen, as today.
  it('refuses a node too old to have the liveness route', async () => {
    const old = answering(answer(401, 'application/json', { error: 'unauthorized' }));
    expect(await confirmMachaEndpoint('https://node', old)).toBeUndefined();
  });

  it('refuses a body that disagrees with its own status line', async () => {
    const inconsistent = answering(answer(200, 'application/json', { status: 'starting' }));
    expect(await confirmMachaEndpoint('https://node', inconsistent)).toBeUndefined();
  });

  it('refuses JSON that is not a health answer at all', async () => {
    const router = answering(answer(200, 'application/json', { status: 'up' }));
    expect(await confirmMachaEndpoint('https://node', router)).toBeUndefined();
    const array = answering(answer(200, 'application/json', []));
    expect(await confirmMachaEndpoint('https://node', array)).toBeUndefined();
  });

  it('refuses an endpoint that cannot be reached at all', async () => {
    const refused = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await confirmMachaEndpoint('https://node', refused)).toBeUndefined();
  });

  /**
   * The deadline is what the viewer actually waits, so it has to be real: a
   * host that accepts the connection and then says nothing must cost the
   * budget and no more.
   */
  it('gives up within its own deadline rather than holding the splash', async () => {
    const hangs = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    expect(await confirmMachaEndpoint('https://node', hangs, 10)).toBeUndefined();
  });
});

describe('sameOriginCandidate', () => {
  it('is this page\'s own origin when it was served over HTTP', () => {
    expect(sameOriginCandidate({ protocol: 'https:', origin: 'https://media.example.com' }))
      .toBe('https://media.example.com');
  });

  /**
   * A packaged build has no host to link to. The Samsung widget and the
   * Android shell load from `file:`, where `origin` is not an address anything
   * can be fetched from — and Samsung is pinned to its build-time endpoints
   * besides, so nothing here should ever run on it.
   */
  it('is nothing at all for a packaged build', () => {
    expect(sameOriginCandidate({ protocol: 'file:', origin: 'null' })).toBeUndefined();
  });
});

describe('useSameOriginEndpoint', () => {
  it('holds while probing, then adopts a confirmed node', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (async () => answer(200, 'application/json', { status: 'ok' })) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useSameOriginEndpoint(true));
    expect(result.current.probing).toBe(true);
    expect(result.current.endpoint).toBeUndefined();
    await waitFor(() => expect(result.current.probing).toBe(false));
    expect(result.current.endpoint).toBe('http://localhost:3000');
  });

  // Once anything is configured the page's own origin is not in play, and must
  // not be probed at all — a configured client should make no request it was
  // not asked to make.
  it('asks nothing when the client is already configured', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useSameOriginEndpoint(false));
    expect(result.current).toEqual({ probing: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
