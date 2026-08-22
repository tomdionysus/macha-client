/* Macha Direct Play rolling read-ahead service worker.
 *
 * This is intentionally an in-memory cache. It does not use Cache Storage or
 * IndexedDB: media bytes disappear when playback releases the source or when
 * the worker is terminated. The browser continues to own demuxing/decoding.
 */
'use strict';

const PROXY_PATH_SUFFIX = '/__macha_direct_cache__';
const CHUNK_SIZE = 8 * 1024 * 1024;
const TARGET_AHEAD_BYTES = 64 * 1024 * 1024;
const MAX_RESIDENT_BYTES = 96 * 1024 * 1024;
const MAX_FETCHES = 2;
const MAX_PREFETCH_FETCHES = 1;
const DEMAND_WAIT_WARN_MS = 250;
const SOURCE_IDLE_MS = 5 * 60 * 1000;

const sourceConfigs = new Map();
const sourceCaches = new Map();
const demandQueue = [];
const prefetchQueue = [];
let activeFetches = 0;
let activePrefetchFetches = 0;

class RangeUnsupportedError extends Error {
  constructor(status) {
    super(`Upstream range request returned ${status}`);
    this.name = 'RangeUnsupportedError';
    this.status = status;
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function rounded(value, places = 1) {
  const scale = Math.pow(10, places);
  return Math.round(value * scale) / scale;
}

function sourceCredentials(sourceUrl) {
  try {
    return new URL(sourceUrl).origin === self.location.origin ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}

function newMetrics() {
  return {
    fetchedBytes: 0,
    servedBytes: 0,
    cacheHitBytes: 0,
    residentBytes: 0,
    aheadBytes: 0,
    activeFetches: 0,
    peakFetches: 0,
    lastFetchMbps: 0,
    demandWaitCount: 0,
    demandWaitMs: 0,
  };
}

function getSourceCache(sourceKey, sourceUrl, totalSize, mimeType) {
  let cache = sourceCaches.get(sourceKey);
  if (cache && cache.totalSize !== totalSize) {
    releaseSource(cache);
    cache = undefined;
  }
  if (!cache) {
    cache = {
      sourceKey,
      sourceUrl,
      totalSize,
      mimeType: mimeType || 'application/octet-stream',
      chunks: new Map(),
      pending: new Map(),
      abortControllers: new Set(),
      metrics: newMetrics(),
      lastAccess: Date.now(),
      lastMetricsAt: 0,
      lastServedOffset: 0,
      released: false,
    };
    sourceCaches.set(sourceKey, cache);
  } else {
    cache.lastAccess = Date.now();
    cache.released = false;
    if (mimeType) cache.mimeType = mimeType;
  }
  return cache;
}

function releaseSource(cache) {
  cache.released = true;
  for (const controller of cache.abortControllers) controller.abort();
  cache.abortControllers.clear();
  cache.chunks.clear();
  cache.pending.clear();
  cache.metrics.residentBytes = 0;
  cache.metrics.aheadBytes = 0;
  sourceCaches.delete(cache.sourceKey);
}

function pruneIdleSources() {
  const cutoff = Date.now() - SOURCE_IDLE_MS;
  for (const cache of sourceCaches.values()) {
    if (cache.lastAccess < cutoff) releaseSource(cache);
  }
}

function schedule(priority, cache, run) {
  return new Promise((resolve, reject) => {
    const task = { priority, cache, run, resolve, reject, started: false };
    (priority === 'demand' ? demandQueue : prefetchQueue).push(task);
    drainQueue();
  });
}

function promotePending(pending) {
  const task = pending.task;
  if (!task || task.started || task.priority === 'demand') return;
  const index = prefetchQueue.indexOf(task);
  if (index >= 0) prefetchQueue.splice(index, 1);
  task.priority = 'demand';
  demandQueue.push(task);
  drainQueue();
}

function nextTask() {
  while (demandQueue.length > 0) {
    const task = demandQueue.shift();
    if (!task.cache.released) return task;
    task.reject(new DOMException('Read-ahead source released', 'AbortError'));
  }
  if (activePrefetchFetches >= MAX_PREFETCH_FETCHES) return undefined;
  while (prefetchQueue.length > 0) {
    const task = prefetchQueue.shift();
    if (!task.cache.released) return task;
    task.reject(new DOMException('Read-ahead source released', 'AbortError'));
  }
  return undefined;
}

function drainQueue() {
  while (activeFetches < MAX_FETCHES) {
    const task = nextTask();
    if (!task) return;
    task.started = true;
    activeFetches += 1;
    if (task.priority === 'prefetch') activePrefetchFetches += 1;
    task.cache.metrics.activeFetches += 1;
    task.cache.metrics.peakFetches = Math.max(task.cache.metrics.peakFetches, task.cache.metrics.activeFetches);
    Promise.resolve()
      .then(task.run)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeFetches -= 1;
        if (task.priority === 'prefetch') activePrefetchFetches -= 1;
        task.cache.metrics.activeFetches = Math.max(0, task.cache.metrics.activeFetches - 1);
        void postMetrics(task.cache, true);
        drainQueue();
      });
  }
}

function touchChunk(cache, index) {
  const entry = cache.chunks.get(index);
  if (entry) entry.lastAccess = Date.now();
}

function residentBytes(cache) {
  let bytes = 0;
  for (const entry of cache.chunks.values()) bytes += entry.buffer.byteLength;
  cache.metrics.residentBytes = bytes;
  return bytes;
}


function updateAheadBytes(cache) {
  let cursor = Math.max(0, Math.min(cache.totalSize, cache.lastServedOffset || 0));
  let ahead = 0;
  while (cursor < cache.totalSize) {
    const index = Math.floor(cursor / CHUNK_SIZE);
    const entry = cache.chunks.get(index);
    if (!entry) break;
    const offset = cursor - index * CHUNK_SIZE;
    const available = Math.max(0, entry.buffer.byteLength - offset);
    if (available <= 0) break;
    ahead += available;
    cursor += available;
    if (entry.buffer.byteLength < CHUNK_SIZE) break;
  }
  cache.metrics.aheadBytes = ahead;
}

function evict(cache, protectedIndex) {
  let bytes = residentBytes(cache);
  if (bytes <= MAX_RESIDENT_BYTES) return;
  const candidates = [...cache.chunks.entries()]
    .filter(([index]) => index !== protectedIndex)
    .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
  for (const [index, entry] of candidates) {
    if (bytes <= MAX_RESIDENT_BYTES) break;
    cache.chunks.delete(index);
    bytes -= entry.buffer.byteLength;
  }
  cache.metrics.residentBytes = Math.max(0, bytes);
}

function parseContentRange(value) {
  if (!value) return undefined;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return undefined;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? undefined : Number(match[3]),
  };
}

function loadChunk(cache, index, priority) {
  const cached = cache.chunks.get(index);
  if (cached) {
    cached.lastAccess = Date.now();
    return Promise.resolve(cached.buffer);
  }
  const existing = cache.pending.get(index);
  if (existing) {
    if (priority === 'demand') promotePending(existing);
    return existing.promise;
  }

  const start = index * CHUNK_SIZE;
  if (start >= cache.totalSize) return Promise.reject(new RangeError('Chunk starts beyond end of source'));
  const end = Math.min(cache.totalSize - 1, start + CHUNK_SIZE - 1);
  const taskHolder = { task: undefined, promise: undefined };
  const promise = schedule(priority, cache, async () => {
    if (cache.released) throw new DOMException('Read-ahead source released', 'AbortError');
    const abortController = new AbortController();
    cache.abortControllers.add(abortController);
    const startedAt = now();
    try {
      const response = await fetch(cache.sourceUrl, {
        method: 'GET',
        headers: {
          Accept: cache.mimeType || '*/*',
          Range: `bytes=${start}-${end}`,
        },
        credentials: sourceCredentials(cache.sourceUrl),
        cache: 'no-store',
        signal: abortController.signal,
      });
      if (response.status !== 206) throw new RangeUnsupportedError(response.status);
      const contentRange = parseContentRange(response.headers.get('content-range'));
      if (!contentRange || contentRange.start !== start) {
        throw new Error(`Invalid upstream Content-Range for chunk ${index}`);
      }
      if (contentRange.total && contentRange.total !== cache.totalSize) {
        cache.totalSize = contentRange.total;
        const config = sourceConfigs.get(cache.sourceKey);
        if (config) config.totalSize = contentRange.total;
      }
      const contentType = response.headers.get('content-type');
      if (contentType) cache.mimeType = contentType;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) throw new Error(`Empty upstream range for chunk ${index}`);
      const elapsedMs = Math.max(1, now() - startedAt);
      cache.metrics.fetchedBytes += buffer.byteLength;
      cache.metrics.lastFetchMbps = rounded((buffer.byteLength * 8) / (elapsedMs * 1000), 2);
      cache.chunks.set(index, { buffer, lastAccess: Date.now() });
      cache.lastAccess = Date.now();
      evict(cache, index);
      updateAheadBytes(cache);
      void postMetrics(cache, false);
      return buffer;
    } finally {
      cache.abortControllers.delete(abortController);
    }
  });
  const queue = priority === 'demand' ? demandQueue : prefetchQueue;
  taskHolder.task = queue[queue.length - 1];
  taskHolder.promise = promise;
  cache.pending.set(index, taskHolder);
  promise.finally(() => {
    if (cache.pending.get(index) === taskHolder) cache.pending.delete(index);
  }).catch(() => undefined);
  return promise;
}

function prefetchAhead(cache, currentIndex) {
  if (cache.released) return;
  const chunksAhead = Math.ceil(TARGET_AHEAD_BYTES / CHUNK_SIZE);
  const lastIndex = Math.ceil(cache.totalSize / CHUNK_SIZE) - 1;
  for (let offset = 1; offset <= chunksAhead; offset += 1) {
    const index = currentIndex + offset;
    if (index > lastIndex) break;
    void loadChunk(cache, index, 'prefetch').catch(() => undefined);
  }
}

function parseRequestedRange(header, totalSize) {
  if (!header) return { start: 0, end: totalSize - 1, partial: false };
  if (header.includes(',')) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match) return undefined;
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
    return { unsatisfiable: true };
  }
  const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return undefined;
  return { start, end: Math.min(totalSize - 1, requestedEnd), partial: true };
}

function responseHeaders(cache, start, end, partial) {
  const headers = new Headers();
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', cache.mimeType || 'application/octet-stream');
  headers.set('Content-Length', String(end - start + 1));
  if (partial) headers.set('Content-Range', `bytes ${start}-${end}/${cache.totalSize}`);
  return headers;
}

async function directFetch(request, sourceUrl) {
  const headers = new Headers();
  const range = request.headers.get('range');
  const accept = request.headers.get('accept');
  if (range) headers.set('Range', range);
  if (accept) headers.set('Accept', accept);
  return await fetch(sourceUrl, {
    method: request.method,
    headers,
    credentials: sourceCredentials(sourceUrl),
    cache: 'no-store',
  });
}

async function postMetrics(cache, force) {
  if (cache.released) return;
  const timestamp = now();
  if (!force && timestamp - cache.lastMetricsAt < 500) return;
  cache.lastMetricsAt = timestamp;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const payload = {
    type: 'macha-direct-read-ahead-metrics',
    sourceKey: cache.sourceKey,
    metrics: { ...cache.metrics },
  };
  for (const client of clients) client.postMessage(payload);
}

async function handleProxy(request, url) {
  const sourceKey = url.searchParams.get('key');
  const config = sourceKey ? sourceConfigs.get(sourceKey) : undefined;
  if (!sourceKey || !config) {
    return new Response('Unknown Macha direct-play read-ahead source', { status: 404 });
  }
  const { sourceUrl, totalSize, mimeType } = config;
  config.lastAccess = Date.now();
  if (config.rangeUnsupported) return await directFetch(request, sourceUrl);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  pruneIdleSources();
  const requested = parseRequestedRange(request.headers.get('range'), totalSize);
  if (!requested) return await directFetch(request, sourceUrl);
  if (requested.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${totalSize}`, 'Accept-Ranges': 'bytes' },
    });
  }

  const cache = getSourceCache(sourceKey, sourceUrl, totalSize, mimeType);
  cache.lastAccess = Date.now();
  const firstIndex = Math.floor(requested.start / CHUNK_SIZE);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: requested.partial ? 206 : 200,
      headers: responseHeaders(cache, requested.start, requested.end, requested.partial),
    });
  }

  try {
    await loadChunk(cache, firstIndex, 'demand');
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    // Some legacy/proxy HTTP paths may not honour Range. Preserve Direct Play
    // by bypassing read-ahead rather than converting that into a playback error.
    config.rangeUnsupported = true;
    releaseSource(cache);
    return await directFetch(request, sourceUrl);
  }
  prefetchAhead(cache, firstIndex);

  let cursor = requested.start;
  const stream = new ReadableStream({
    async pull(controller) {
      if (cursor > requested.end) {
        controller.close();
        return;
      }
      const index = Math.floor(cursor / CHUNK_SIZE);
      const chunkOffset = cursor - index * CHUNK_SIZE;
      const wanted = Math.min(requested.end - cursor + 1, CHUNK_SIZE - chunkOffset);
      const wasCached = cache.chunks.has(index);
      const waitStartedAt = now();
      let buffer;
      try {
        buffer = await loadChunk(cache, index, 'demand');
      } catch (error) {
        controller.error(error);
        return;
      }
      const waitMs = now() - waitStartedAt;
      if (!wasCached && waitMs >= DEMAND_WAIT_WARN_MS) {
        cache.metrics.demandWaitCount += 1;
        cache.metrics.demandWaitMs = rounded(cache.metrics.demandWaitMs + waitMs, 1);
      }
      touchChunk(cache, index);
      const available = Math.min(wanted, Math.max(0, buffer.byteLength - chunkOffset));
      if (available <= 0) {
        controller.error(new Error(`Read-ahead chunk ${index} did not contain requested bytes`));
        return;
      }
      controller.enqueue(new Uint8Array(buffer, chunkOffset, available));
      cache.metrics.servedBytes += available;
      if (wasCached) cache.metrics.cacheHitBytes += available;
      cursor += available;
      cache.lastServedOffset = cursor;
      updateAheadBytes(cache);
      cache.lastAccess = Date.now();
      prefetchAhead(cache, index);
      void postMetrics(cache, false);
    },
  });

  return new Response(stream, {
    status: requested.partial ? 206 : 200,
    headers: responseHeaders(cache, requested.start, requested.end, requested.partial),
  });
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'macha-direct-read-ahead-configure') {
    const sourceKey = typeof data.sourceKey === 'string' ? data.sourceKey : '';
    const sourceUrl = typeof data.sourceUrl === 'string' ? data.sourceUrl : '';
    const totalSize = Number(data.sizeBytes);
    const mimeType = typeof data.mimeType === 'string' && data.mimeType ? data.mimeType : 'application/octet-stream';
    let validSource = false;
    try {
      const parsed = new URL(sourceUrl);
      validSource = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      validSource = false;
    }
    if (sourceKey && validSource && Number.isSafeInteger(totalSize) && totalSize > 0) {
      sourceConfigs.set(sourceKey, { sourceUrl, totalSize, mimeType, lastAccess: Date.now(), rangeUnsupported: false });
      const port = event.ports && event.ports[0];
      if (port) port.postMessage({ type: 'macha-direct-read-ahead-configured', sourceKey });
    }
    return;
  }
  if (data.type !== 'macha-direct-read-ahead-release' || typeof data.sourceKey !== 'string') return;
  sourceConfigs.delete(data.sourceKey);
  const cache = sourceCaches.get(data.sourceKey);
  if (cache) releaseSource(cache);
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return;
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith(PROXY_PATH_SUFFIX)) return;
  event.respondWith(handleProxy(event.request, url));
});
