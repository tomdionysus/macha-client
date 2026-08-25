import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const workerSource = readFileSync(new URL('../public/macha-direct-play-sw.js', import.meta.url), 'utf8');
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FetchOptions = RequestInit & { headers?: HeadersInit; signal?: AbortSignal };
type WorkerListener = (event: any) => void;

function rangeResponse(start: number, bytes: number, total = 64 * 1024 * 1024): Response {
  const body = new Uint8Array(bytes);
  for (let index = 0; index < body.length; index += 1) body[index] = index & 0xff;
  return new Response(body, {
    status: 206,
    headers: {
      'content-type': 'video/mp4',
      'content-range': `bytes ${start}-${start + bytes - 1}/${total}`,
    },
  });
}

function createHarness(fetchImpl: (url: string, options?: FetchOptions) => Promise<Response>) {
  const listeners = new Map<string, WorkerListener>();
  const metrics: any[] = [];
  const self = {
    location: { origin: 'https://client.test' },
    skipWaiting() {},
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ postMessage: (message: unknown) => metrics.push(message) }],
    },
    addEventListener(type: string, listener: WorkerListener) {
      listeners.set(type, listener);
    },
  };
  const context = vm.createContext({
    self,
    fetch: fetchImpl,
    URL,
    Headers,
    Request,
    Response,
    ReadableStream,
    Uint8Array,
    ArrayBuffer,
    AbortController,
    DOMException,
    performance,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    console,
  });
  vm.runInContext(workerSource, context, { filename: 'macha-direct-play-sw.js' });

  const sourceKey = 'source-key';
  const sourceUrl = 'https://node.test/direct.mp4';
  const proxyUrl = (sizeBytes = 64 * 1024 * 1024) => {
    const url = new URL('https://client.test/__macha_direct_cache__');
    url.searchParams.set('key', sourceKey);
    url.searchParams.set('source', sourceUrl);
    url.searchParams.set('size', String(sizeBytes));
    url.searchParams.set('mime', 'video/mp4');
    return url.toString();
  };

  function configure(sizeBytes = 64 * 1024 * 1024) {
    const acknowledgements: unknown[] = [];
    listeners.get('message')?.({
      data: {
        type: 'macha-direct-read-ahead-configure',
        sourceKey,
        sourceUrl,
        sizeBytes,
        mimeType: 'video/mp4',
      },
      ports: [{ postMessage: (message: unknown) => acknowledgements.push(message) }],
    });
    expect(acknowledgements).toEqual([{ type: 'macha-direct-read-ahead-configured', sourceKey }]);
  }

  function setMode(mode: 'bootstrap' | 'playing' | 'seeking' | 'paused') {
    listeners.get('message')?.({
      data: { type: 'macha-direct-read-ahead-state', sourceKey, mode },
      ports: [],
    });
  }

  function release() {
    listeners.get('message')?.({
      data: { type: 'macha-direct-read-ahead-release', sourceKey },
      ports: [],
    });
  }

  async function request(range?: string, sizeBytes = 64 * 1024 * 1024): Promise<Response> {
    let responsePromise: Promise<Response> | undefined;
    listeners.get('fetch')?.({
      request: new Request(proxyUrl(sizeBytes), { headers: range ? { Range: range } : undefined }),
      respondWith(value: Response | Promise<Response>) {
        responsePromise = Promise.resolve(value);
      },
    });
    if (!responsePromise) throw new Error('Service Worker did not intercept proxy request');
    return await responsePromise;
  }

  return { configure, setMode, release, request, metrics };
}

describe('Direct Play read-ahead Service Worker', () => {
  const releases: Array<() => void> = [];

  afterEach(() => {
    while (releases.length > 0) releases.pop()?.();
  });

  it('starts self-described proxy demand without waiting for a configure message', async () => {
    const calls: string[] = [];
    const harness = createHarness(async (_url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push(range);
      return rangeResponse(0, 4);
    });
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(calls).toEqual(['bytes=0-3']);
  });

  it('streams an exact demand range before the upstream body completes and does not prefetch during bootstrap', async () => {
    const calls: FetchOptions[] = [];
    let releaseTail!: () => void;
    const tail = new Promise<void>((resolve) => { releaseTail = resolve; });
    const fetchImpl = async (_url: string, options: FetchOptions = {}) => {
      calls.push(options);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          void tail.then(() => {
            controller.enqueue(new Uint8Array([4, 5, 6]));
            controller.close();
          });
        },
      }), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-5/67108864',
        },
      });
    };
    const harness = createHarness(fetchImpl);
    harness.configure();
    releases.push(harness.release);

    const response = await harness.request('bytes=0-5');
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]?.headers).get('range')).toBe('bytes=0-5');

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect([...first.value!]).toEqual([1, 2, 3]);
    expect(first.done).toBe(false);
    expect(calls).toHaveLength(1);

    releaseTail();
    const second = await reader.read();
    expect([...second.value!]).toEqual([4, 5, 6]);
    expect((await reader.read()).done).toBe(true);
    await wait(180);
    expect(calls).toHaveLength(1);
  });

  it('retains streamed viewer demand so an immediate repeat is a memory hit', async () => {
    const calls: string[] = [];
    const harness = createHarness(async (_url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push(range);
      return rangeResponse(0, 4);
    });
    harness.configure();
    releases.push(harness.release);

    const first = await harness.request('bytes=0-3');
    await first.arrayBuffer();
    const second = await harness.request('bytes=0-3');
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(calls).toEqual(['bytes=0-3']);
  });

  it('aborts speculative read-ahead immediately when new viewer demand arrives', async () => {
    const calls: string[] = [];
    let prefetchSignal: AbortSignal | undefined;
    const fetchImpl = async (_url: string, options: FetchOptions = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push(range);
      if (range === 'bytes=4-8388611') {
        prefetchSignal = options.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            options.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
          },
        }), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': 'bytes 4-8388611/67108864',
          },
        });
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw new Error(`Unexpected range ${range}`);
      return rangeResponse(Number(match[1]), Number(match[2]) - Number(match[1]) + 1);
    };
    const harness = createHarness(fetchImpl);
    harness.configure();
    harness.setMode('playing');
    releases.push(harness.release);

    const first = await harness.request('bytes=0-3');
    await first.arrayBuffer();
    await wait(180);
    expect(calls).toContain('bytes=4-8388611');
    expect(prefetchSignal?.aborted).toBe(false);

    const second = await harness.request('bytes=100-103');
    expect(prefetchSignal?.aborted).toBe(true);
    await second.arrayBuffer();
    expect(calls).toContain('bytes=100-103');
  });

  it('serves an open-ended seek from resident read-ahead immediately, then continues with exact demand', async () => {
    const total = 16 * 1024 * 1024;
    const secondRange = `bytes=8388612-${total - 1}`;
    const calls: string[] = [];
    let speculativeSecondSignal: AbortSignal | undefined;
    let secondRangeCalls = 0;
    const fetchImpl = async (_url: string, options: FetchOptions = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push(range);
      if (range === 'bytes=0-3') return rangeResponse(0, 4, total);
      if (range === 'bytes=4-8388611') return rangeResponse(4, 8 * 1024 * 1024, total);
      if (range === secondRange) {
        secondRangeCalls += 1;
        if (secondRangeCalls === 1) {
          speculativeSecondSignal = options.signal;
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              options.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
            },
          }), {
            status: 206,
            headers: {
              'content-type': 'video/mp4',
              'content-range': `bytes 8388612-${total - 1}/${total}`,
            },
          });
        }
        return rangeResponse(8388612, total - 8388612, total);
      }
      throw new Error(`Unexpected range ${range}`);
    };
    const harness = createHarness(fetchImpl);
    harness.configure(total);
    harness.setMode('playing');
    releases.push(harness.release);

    const first = await harness.request('bytes=0-3', total);
    await first.arrayBuffer();
    await wait(180);
    for (let attempt = 0; attempt < 20 && !speculativeSecondSignal; attempt += 1) await wait(5);
    expect(speculativeSecondSignal?.aborted).toBe(false);

    const seek = await harness.request('bytes=100-', total);
    expect(speculativeSecondSignal?.aborted).toBe(true);
    const reader = seek.body!.getReader();
    const firstSeekChunk = await reader.read();
    expect(firstSeekChunk.done).toBe(false);
    expect(firstSeekChunk.value!.byteLength).toBeGreaterThan(1024 * 1024);
    expect(secondRangeCalls).toBe(2);
    await reader.cancel();
    expect(calls).toContain(secondRange);
  });

  it('treats seek as a new playback generation and aborts old speculative work', async () => {
    let prefetchSignal: AbortSignal | undefined;
    const fetchImpl = async (_url: string, options: FetchOptions = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      if (range === 'bytes=4-8388611') {
        prefetchSignal = options.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            options.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
          },
        }), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': 'bytes 4-8388611/67108864',
          },
        });
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw new Error(`Unexpected range ${range}`);
      return rangeResponse(Number(match[1]), Number(match[2]) - Number(match[1]) + 1);
    };
    const harness = createHarness(fetchImpl);
    harness.configure();
    harness.setMode('playing');
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');
    await response.arrayBuffer();
    await wait(180);
    expect(prefetchSignal?.aborted).toBe(false);

    harness.setMode('seeking');
    await wait(0);
    expect(prefetchSignal?.aborted).toBe(true);
    const latest = harness.metrics.at(-1)?.metrics;
    expect(latest?.mode).toBe('seeking');
    expect(latest?.generation).toBe(1);
  });
});
