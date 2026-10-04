// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { confirmMachaEndpoint, sameOriginCandidate, useSameOriginEndpoint } from './sameOriginEndpoint';
import { settle } from '../test/settle';

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
  // The web host must serve `index.html` for unknown paths, so a host without
  // Macha answers 200 at `/api/v1/health` with the application shell, and a
  // check keyed on `response.ok` would adopt it.
  it('refuses this client\'s own web host, which answers 200 for every unknown path', async () => {
    const spa = answering(answer(200, 'text/html; charset=utf-8', '<!doctype html><title>Macha</title>'));
    expect(await confirmMachaEndpoint('https://media.example.com', spa)).toBeUndefined();
  });

  // A node's plainest answer: `{"status":"ok"}`, no product or version field.
  it('confirms a node serving', async () => {
    expect(await confirmMachaEndpoint('https://node', macha('ok'))).toEqual({
      status: 'ok',
      version: undefined,
      marked: false,
    });
  });

  // Identity is not readiness: the health monitor decides whether an identified node is usable yet.
  it('confirms a node that is starting, and one that has failed', async () => {
    expect(await confirmMachaEndpoint('https://node', macha('starting'))).toMatchObject({ status: 'starting' });
    expect(await confirmMachaEndpoint('https://node', macha('failed'))).toMatchObject({ status: 'failed' });
  });

  // A full control lane answers 503 with `service` and `status` kept, so the node is still identified.
  it('confirms a node refusing work because it is busy', async () => {
    const overloaded = answering(answer(503, 'application/json', {
      service: 'macha',
      status: 'busy',
      error: { code: 'overloaded', message: 'the node is busy; retry shortly' },
    }));
    expect(await confirmMachaEndpoint('https://node', overloaded)).toEqual({ status: 'busy', marked: true });
  });

  // `busy` belongs on a 503; on a 200 it is not this contract.
  it('refuses a busy body that arrives with a 200', async () => {
    const inconsistent = answering(answer(200, 'application/json', { service: 'macha', status: 'busy' }));
    expect(await confirmMachaEndpoint('https://node', inconsistent)).toBeUndefined();
  });

  // The marker carries no version. Absent is tolerated; present and wrong is a refusal.
  it('reports the product marker when a node states one', async () => {
    const marked = macha('ok', { service: 'macha' });
    expect(await confirmMachaEndpoint('https://node', marked)).toEqual({ status: 'ok', marked: true });
  });

  it('refuses a JSON service that names itself as something else', async () => {
    const other = macha('ok', { service: 'nginx' });
    expect(await confirmMachaEndpoint('https://node', other)).toBeUndefined();
  });

  // A node older than 0.38.5 has no liveness route and answers 401, as authentication precedes routing.
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

  // A host that accepts the connection and then says nothing.
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

  // Packaged builds (Samsung widget, Android shell) load from `file:`, whose origin cannot be fetched from.
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
    await settle();
    expect(result.current.probing).toBe(false);
    expect(result.current.endpoint).toBe('http://localhost:3000');
  });

  it('asks nothing when the client is already configured', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useSameOriginEndpoint(false));
    expect(result.current).toEqual({ probing: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
