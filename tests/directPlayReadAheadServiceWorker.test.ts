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

  function addSource(sourceUrl: string) {
    listeners.get('message')?.({
      data: { type: 'macha-direct-read-ahead-add-source', sourceKey, sourceUrl },
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

  function askStatus(): unknown[] {
    const answers: unknown[] = [];
    listeners.get('message')?.({
      data: { type: 'macha-direct-read-ahead-status', sourceKey },
      ports: [{ postMessage: (message: unknown) => answers.push(message) }],
    });
    return answers;
  }

  return { configure, addSource, setMode, release, request, askStatus, metrics };
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

  it('retries the exact demand range on an alternate when the primary fails before headers', async () => {
    const calls: Array<{ url: string; range: string }> = [];
    const harness = createHarness(async (url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push({ url, range });
      if (url.includes('node.test')) throw new TypeError('primary unreachable');
      return new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/67108864' },
      });
    });
    harness.configure();
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');

    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(calls).toEqual([
      { url: 'https://node.test/direct.mp4', range: 'bytes=0-3' },
      { url: 'https://alternate.test/direct.mp4', range: 'bytes=0-3' },
    ]);
  });

  it('continues at the exact next byte on an alternate after a partial body failure', async () => {
    const calls: Array<{ url: string; range: string }> = [];
    const harness = createHarness(async (url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push({ url, range });
      if (url.includes('node.test')) {
        let emitted = false;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emitted) {
              emitted = true;
              controller.enqueue(new Uint8Array([0, 1]));
            } else {
              controller.error(new TypeError('primary body failed'));
            }
          },
        }), {
          status: 206,
          headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/67108864' },
        });
      }
      return new Response(new Uint8Array([2, 3]), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 2-3/67108864' },
      });
    });
    harness.configure();
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');

    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(calls).toEqual([
      { url: 'https://node.test/direct.mp4', range: 'bytes=0-3' },
      { url: 'https://alternate.test/direct.mp4', range: 'bytes=2-3' },
    ]);
  });

  it('reports mid-stream alternate exhaustion as node degradation evidence', async () => {
    const harness = createHarness(async (url) => {
      if (url.includes('node.test')) {
        let emitted = false;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emitted) {
              emitted = true;
              controller.enqueue(new Uint8Array([0, 1]));
            } else {
              controller.error(new TypeError('primary body failed'));
            }
          },
        }), {
          status: 206,
          headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/67108864' },
        });
      }
      throw new TypeError('alternate unreachable');
    });
    harness.configure();
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');
    // The initial fetch resolves normally — headers arrive fine — so this
    // failure can only surface once the body is actually read, exactly as it
    // would for a real player consuming the stream.
    await expect(response.arrayBuffer()).rejects.toThrow('alternate unreachable');
    expect(harness.metrics).toContainEqual(expect.objectContaining({
      type: 'macha-direct-read-ahead-source-failed',
      message: 'alternate unreachable',
    }));
  });

  it('keeps a resident prefix and obtains only the missing suffix from an alternate', async () => {
    const calls: Array<{ url: string; range: string }> = [];
    const harness = createHarness(async (url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push({ url, range });
      if (range === 'bytes=0-3') return rangeResponse(0, 4, 16);
      if (url.includes('node.test')) throw new TypeError('primary failed');
      return new Response(new Uint8Array([4, 5, 6, 7]), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 4-7/16' },
      });
    });
    harness.configure(16);
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);
    await (await harness.request('bytes=0-3', 16)).arrayBuffer();

    const response = await harness.request('bytes=0-7', 16);

    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(calls.slice(1)).toEqual([
      { url: 'https://node.test/direct.mp4', range: 'bytes=4-7' },
      { url: 'https://alternate.test/direct.mp4', range: 'bytes=4-7' },
    ]);
  });

  it('serves an overlapping range from resident bytes and fetches only its missing suffix', async () => {
    const calls: string[] = [];
    const harness = createHarness(async (_url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push(range);
      if (range === 'bytes=0-7') return new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-7/16' },
      });
      if (range === 'bytes=8-11') return new Response(new Uint8Array([8, 9, 10, 11]), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 8-11/16' },
      });
      throw new Error(`Unexpected range ${range}`);
    });
    harness.configure(16);
    releases.push(harness.release);
    await (await harness.request('bytes=0-7', 16)).arrayBuffer();

    const response = await harness.request('bytes=4-11', 16);

    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(calls).toEqual(['bytes=0-7', 'bytes=8-11']);
  });

  it('does not splice an alternate over a non-retryable HTTP response', async () => {
    const calls: string[] = [];
    const harness = createHarness(async (url) => {
      calls.push(url);
      return new Response('not found', { status: 404 });
    });
    harness.configure();
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');

    expect(response.status).toBe(404);
    expect(calls).toEqual(['https://node.test/direct.mp4']);
  });

  it('reports a 404 as a source failure carrying the status, while still returning it', async () => {
    // The node has no record of this source — most often a play session reaped
    // out from under a long pause. Before 2026-09-17 nobody was told: the 404
    // travelled to the media element, which raised a generic decode failure, so
    // the client saw "unsupported media" and failed the node over rather than
    // re-creating the session it actually needed. The response still travels as
    // it did (the test above is the invariant); what is new is that the status
    // reaches the client alongside it.
    const harness = createHarness(async () => new Response('not found', { status: 404 }));
    harness.configure();
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');

    expect(response.status).toBe(404);
    expect(harness.metrics).toContainEqual(expect.objectContaining({
      type: 'macha-direct-read-ahead-source-failed',
      status: 404,
    }));
  });

  it('answers what the node said when asked, for an element that errors before the report arrives', async () => {
    // The report above is posted after an await, and the 404 response can
    // reach the element first; measured 2026-09-23, the page then read the
    // element's error as "unsupported". The status is recorded before the
    // response is returned, so a page that asks gets the answer regardless.
    const harness = createHarness(async () => new Response('not found', { status: 404 }));
    harness.configure();
    releases.push(harness.release);
    expect(harness.askStatus()).toEqual([{ type: 'macha-direct-read-ahead-status', status: undefined }]);

    const response = await harness.request('bytes=0-3');

    expect(response.status).toBe(404);
    expect(harness.askStatus()).toEqual([{ type: 'macha-direct-read-ahead-status', status: 404 }]);
  });

  it('does not attach a status to a transport failure that never became a response', async () => {
    // Absent is a different claim from 404 and must stay absent: a fetch that
    // never landed says something about the node, and reporting it with a
    // status would route it into the re-create path instead of failover.
    const harness = createHarness(async () => { throw new TypeError('unreachable'); });
    harness.configure();
    releases.push(harness.release);

    await expect(harness.request('bytes=0-3')).rejects.toThrow('unreachable');

    const failures = harness.metrics.filter((message): message is { type: string; status?: number } => (
      typeof message === 'object' && message !== null
      && (message as { type?: unknown }).type === 'macha-direct-read-ahead-source-failed'
    ));
    expect(failures).not.toHaveLength(0);
    for (const failure of failures) expect(failure.status).toBeUndefined();
  });

  it('fails after bounded alternate exhaustion, reporting it as node degradation evidence', async () => {
    const calls: string[] = [];
    const harness = createHarness(async (url) => {
      calls.push(url);
      throw new TypeError('unreachable');
    });
    harness.configure();
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);

    await expect(harness.request('bytes=0-3')).rejects.toThrow('unreachable');
    expect(calls).toEqual(['https://node.test/direct.mp4', 'https://alternate.test/direct.mp4']);
    // A demand-path failure is more urgent than a speculative prefetch miss —
    // it is about to surface as a real player-facing read error — so it must
    // report source degradation at least as reliably as prefetch already does.
    expect(harness.metrics).toContainEqual(expect.objectContaining({
      type: 'macha-direct-read-ahead-source-failed',
      message: 'unreachable',
    }));
  });

  it('cancels active demand without starting an alternate request', async () => {
    const calls: string[] = [];
    let upstreamSignal: AbortSignal | undefined;
    const harness = createHarness(async (url, options = {}) => {
      calls.push(url);
      upstreamSignal = options.signal;
      return new Response(new ReadableStream<Uint8Array>({
        pull() { return new Promise<void>(() => undefined); },
      }), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/67108864' },
      });
    });
    harness.configure();
    harness.addSource('https://alternate.test/direct.mp4');
    releases.push(harness.release);

    const response = await harness.request('bytes=0-3');
    await response.body!.cancel();

    expect(upstreamSignal?.aborted).toBe(true);
    expect(calls).toEqual(['https://node.test/direct.mp4']);
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

  it('keeps an in-flight prefetch and fills to the bounded frontier while paused', async () => {
    const total = 12 * 1024 * 1024;
    const calls: string[] = [];
    let finishFirstPrefetch!: (response: Response) => void;
    let firstPrefetchSignal: AbortSignal | undefined;
    const harness = createHarness(async (_url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push(range);
      if (range === 'bytes=0-3') return rangeResponse(0, 4, total);
      if (range === 'bytes=4-8388611') {
        firstPrefetchSignal = options.signal;
        return await new Promise<Response>((resolve) => { finishFirstPrefetch = resolve; });
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw new Error(`Unexpected range ${range}`);
      return rangeResponse(Number(match[1]), Number(match[2]) - Number(match[1]) + 1, total);
    });
    harness.configure(total);
    harness.setMode('playing');
    releases.push(harness.release);

    await (await harness.request('bytes=0-3', total)).arrayBuffer();
    await wait(180);
    expect(calls).toContain('bytes=4-8388611');

    harness.setMode('paused');
    expect(firstPrefetchSignal?.aborted).toBe(false);
    finishFirstPrefetch(rangeResponse(4, 8 * 1024 * 1024, total));
    await wait(50);

    expect(firstPrefetchSignal?.aborted).toBe(false);
    expect(calls).toContain(`bytes=8388612-${total - 1}`);
    const prefetchCalls = calls.length;
    const cached = await harness.request('bytes=4-7', total);
    expect([...new Uint8Array(await cached.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(calls).toHaveLength(prefetchCalls);
  });

  it('uses a failed precache TCP request to promote and fill from an alternate node', async () => {
    const calls: Array<{ url: string; range: string }> = [];
    const harness = createHarness(async (url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      calls.push({ url, range });
      if (range === 'bytes=0-3') return rangeResponse(0, 4, 16);
      if (url.includes('node.test')) throw new TypeError('primary TCP stream failed');
      if (range === 'bytes=4-15') return rangeResponse(4, 12, 16);
      throw new Error(`Unexpected precache ${url} ${range}`);
    });
    harness.configure(16);
    harness.addSource('https://alternate.test/direct.mp4');
    harness.setMode('playing');
    releases.push(harness.release);

    await (await harness.request('bytes=0-3', 16)).arrayBuffer();
    await wait(180);

    expect(calls).toEqual([
      { url: 'https://node.test/direct.mp4', range: 'bytes=0-3' },
      { url: 'https://node.test/direct.mp4', range: 'bytes=4-15' },
      { url: 'https://alternate.test/direct.mp4', range: 'bytes=4-15' },
    ]);
    expect(harness.metrics.some((message) => message.metrics?.sourceOrigin === 'https://alternate.test')).toBe(true);
  });

  it('reports a failed speculative range as non-terminal node degradation evidence', async () => {
    const harness = createHarness(async (_url, options = {}) => {
      const range = new Headers(options.headers).get('range') ?? '';
      if (range === 'bytes=0-3') return rangeResponse(0, 4, 16);
      throw new TypeError('primary TCP stream failed');
    });
    harness.configure(16);
    harness.setMode('playing');
    releases.push(harness.release);

    await (await harness.request('bytes=0-3', 16)).arrayBuffer();
    await wait(180);

    expect(harness.metrics).toContainEqual(expect.objectContaining({
      type: 'macha-direct-read-ahead-source-failed',
      sourceKey: 'source-key',
      sourceUrl: 'https://node.test/direct.mp4',
    }));
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
