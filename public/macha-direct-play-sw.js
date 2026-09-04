/* Macha Direct Play rolling read-ahead service worker.
 *
 * Viewer demand is never scheduled behind read-ahead. Cache misses are proxied
 * as native streaming HTTP range requests; speculative fetches run only after
 * established playback has gone briefly quiet and are aborted immediately by
 * new demand or a seek. The cache is memory-only. Viewer bytes are delivered
 * first and copied into resident cache opportunistically; completed speculative
 * ranges share the same cache. Cache bookkeeping is never a prerequisite for
 * current demand, so bytes already paid for can accelerate later seeks/repeats
 * without extending the viewer-critical path.
 */
'use strict';

const PROXY_PATH_SUFFIX = '/__macha_direct_cache__';
const PREFETCH_BLOCK_BYTES = 8 * 1024 * 1024;
const TARGET_AHEAD_BYTES = 64 * 1024 * 1024;
const MAX_RESIDENT_BYTES = 96 * 1024 * 1024;
const PREFETCH_QUIET_MS = 150;
const DEMAND_WAIT_WARN_MS = 250;
const SOURCE_IDLE_MS = 5 * 60 * 1000;

const sourceConfigs = new Map();
const sourceCaches = new Map();

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function rounded(value, places = 1) {
  const scale = Math.pow(10, places);
  return Math.round(value * scale) / scale;
}

function abortError(message) {
  return new DOMException(message, 'AbortError');
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
    sourceOrigin: '',
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
    demandFetches: 0,
    demandBytes: 0,
    demandFirstByteMs: 0,
    demandBlockedByPrefetchMs: 0,
    prefetchFetches: 0,
    prefetchBytes: 0,
    prefetchAbortsForDemand: 0,
    generation: 0,
    mode: 'bootstrap',
  };
}

function getSourceCache(sourceKey, sourceUrl, totalSize, mimeType) {
  const config = sourceConfigs.get(sourceKey);
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
      segments: new Map(),
      prefetchController: undefined,
      prefetchRange: undefined,
      prefetchTimer: undefined,
      metrics: newMetrics(),
      lastAccess: Date.now(),
      lastMetricsAt: 0,
      lastServedOffset: 0,
      lastDemandAt: now(),
      pendingDemandWaits: 0,
      sourceFailureNotified: false,
      prefetchFailureCount: 0,
      generation: config ? config.generation || 0 : 0,
      mode: config ? config.mode || 'bootstrap' : 'bootstrap',
      released: false,
    };
    cache.metrics.generation = cache.generation;
    cache.metrics.mode = cache.mode;
    sourceCaches.set(sourceKey, cache);
  } else {
    cache.lastAccess = Date.now();
    cache.released = false;
    if (mimeType) cache.mimeType = mimeType;
  }
  return cache;
}

function configuredSourceUrls(config) {
  const urls = Array.isArray(config.sourceUrls) ? config.sourceUrls : [config.sourceUrl];
  return [config.sourceUrl, ...urls].filter((url, index, all) => validHttpSource(url) && all.indexOf(url) === index);
}

function preferSource(config, cache, sourceUrl) {
  config.sourceUrl = sourceUrl;
  if (cache) {
    cache.sourceUrl = sourceUrl;
    try {
      cache.metrics.sourceOrigin = new URL(sourceUrl).origin;
    } catch {
      cache.metrics.sourceOrigin = '';
    }
  }
}

function clearPrefetchTimer(cache) {
  if (cache.prefetchTimer !== undefined) {
    clearTimeout(cache.prefetchTimer);
    cache.prefetchTimer = undefined;
  }
}

function abortPrefetch(cache, forDemand) {
  clearPrefetchTimer(cache);
  const controller = cache.prefetchController;
  if (!controller) return;
  if (forDemand && !controller.signal.aborted) cache.metrics.prefetchAbortsForDemand += 1;
  cache.prefetchController = undefined;
  cache.prefetchRange = undefined;
  controller.abort();
}

function releaseSource(cache) {
  cache.released = true;
  abortPrefetch(cache, false);
  cache.segments.clear();
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

function activeFetchStarted(cache) {
  cache.metrics.activeFetches += 1;
  cache.metrics.peakFetches = Math.max(cache.metrics.peakFetches, cache.metrics.activeFetches);
}

function activeFetchFinished(cache) {
  cache.metrics.activeFetches = Math.max(0, cache.metrics.activeFetches - 1);
  void postMetrics(cache, true);
}

function residentBytes(cache) {
  let bytes = 0;
  for (const entry of cache.segments.values()) bytes += entry.buffer.byteLength;
  cache.metrics.residentBytes = bytes;
  return bytes;
}

function segmentContaining(cache, offset, touch = false) {
  let best;
  for (const entry of cache.segments.values()) {
    if (entry.start <= offset && entry.end >= offset && (!best || entry.end > best.end)) best = entry;
  }
  if (best && touch) best.lastAccess = Date.now();
  return best;
}

function contiguousCachedEnd(cache, start, limit = cache.totalSize - 1) {
  let cursor = start;
  while (cursor <= limit) {
    const entry = segmentContaining(cache, cursor);
    if (!entry) break;
    cursor = Math.min(limit + 1, entry.end + 1);
  }
  return cursor - 1;
}

function updateAheadBytes(cache) {
  const cursor = Math.max(0, Math.min(cache.totalSize, cache.lastServedOffset || 0));
  if (cursor >= cache.totalSize) {
    cache.metrics.aheadBytes = 0;
    return;
  }
  const end = contiguousCachedEnd(cache, cursor);
  cache.metrics.aheadBytes = end >= cursor ? end - cursor + 1 : 0;
}

function evict(cache) {
  let bytes = residentBytes(cache);
  if (bytes <= MAX_RESIDENT_BYTES) return;
  const candidates = [...cache.segments.entries()].sort((left, right) => {
    const generationDelta = left[1].generation - right[1].generation;
    return generationDelta !== 0 ? generationDelta : left[1].lastAccess - right[1].lastAccess;
  });
  for (const [start, entry] of candidates) {
    if (bytes <= MAX_RESIDENT_BYTES) break;
    cache.segments.delete(start);
    bytes -= entry.buffer.byteLength;
  }
  cache.metrics.residentBytes = Math.max(0, bytes);
  updateAheadBytes(cache);
}

function storeSegment(cache, start, buffer) {
  if (!buffer || buffer.byteLength <= 0 || cache.released) return;
  let mergedStart = start;
  let mergedBuffer = buffer;
  let mergedEnd = start + buffer.byteLength - 1;
  // Demand streaming often arrives in small transport chunks. Coalesce adjacent
  // chunks into modest resident entries off the viewer path so cache lookup does
  // not degrade into a huge linear segment list during long Direct Play sessions.
  const MAX_DEMAND_SEGMENT_BYTES = 2 * 1024 * 1024;
  for (const [existingStart, existing] of cache.segments.entries()) {
    if (existing.start === mergedStart && existing.end === mergedEnd) {
      existing.lastAccess = Date.now();
      existing.generation = cache.generation;
      return;
    }
    if (existing.end + 1 === mergedStart
        && existing.buffer.byteLength + mergedBuffer.byteLength <= MAX_DEMAND_SEGMENT_BYTES) {
      const joined = new Uint8Array(existing.buffer.byteLength + mergedBuffer.byteLength);
      joined.set(new Uint8Array(existing.buffer), 0);
      joined.set(new Uint8Array(mergedBuffer), existing.buffer.byteLength);
      cache.segments.delete(existingStart);
      mergedStart = existing.start;
      mergedBuffer = joined.buffer;
      mergedEnd = mergedStart + mergedBuffer.byteLength - 1;
      break;
    }
  }
  // Drop ranges wholly covered by the new range. Partial overlap is harmless
  // and rare because speculative fetches walk the contiguous-ahead frontier.
  for (const [existingStart, existing] of cache.segments.entries()) {
    if (existing.start >= mergedStart && existing.end <= mergedEnd) cache.segments.delete(existingStart);
  }
  cache.segments.set(mergedStart, {
    start: mergedStart,
    end: mergedEnd,
    buffer: mergedBuffer,
    lastAccess: Date.now(),
    generation: cache.generation,
  });
  evict(cache);
  updateAheadBytes(cache);
}

function storeStreamChunk(cache, start, value) {
  if (!value || !value.byteLength) return;
  const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  storeSegment(cache, start, buffer);
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

function parseRequestedRange(header, totalSize) {
  if (!header) return { start: 0, end: totalSize - 1, partial: false, openEnded: true };
  if (header.includes(',')) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match) return undefined;
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) return { unsatisfiable: true };
  const openEnded = match[2] === '';
  const requestedEnd = openEnded ? totalSize - 1 : Number(match[2]);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return undefined;
  return { start, end: Math.min(totalSize - 1, requestedEnd), partial: true, openEnded };
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

function upstreamHeaders(request, rangeOverride) {
  const headers = new Headers();
  const range = rangeOverride === undefined ? request.headers.get('range') : rangeOverride;
  const accept = request.headers.get('accept');
  if (range) headers.set('Range', range);
  if (accept) headers.set('Accept', accept);
  return headers;
}

async function directFetch(request, sourceUrl, signal, rangeOverride) {
  return await fetch(sourceUrl, {
    method: request.method,
    headers: upstreamHeaders(request, rangeOverride),
    credentials: sourceCredentials(sourceUrl),
    cache: 'no-store',
    signal,
  });
}

function retryableSourceStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function directFetchWithFailover(request, config, cache, signal, rangeOverride, excluded = new Set()) {
  let lastError;
  for (const sourceUrl of configuredSourceUrls(config)) {
    if (excluded.has(sourceUrl)) continue;
    try {
      const response = await directFetch(request, sourceUrl, signal, rangeOverride);
      if (retryableSourceStatus(response.status)) {
        lastError = new Error(`Direct Play source returned ${response.status}`);
        if (response.body) void response.body.cancel().catch(() => undefined);
        continue;
      }
      preferSource(config, cache, sourceUrl);
      return { response, sourceUrl };
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('No Direct Play source remains');
}

async function exactRangeReader(request, config, cache, signal, start, end, excluded) {
  let lastError;
  const range = `bytes=${start}-${end}`;
  for (const sourceUrl of configuredSourceUrls(config)) {
    if (excluded.has(sourceUrl)) continue;
    try {
      const response = await directFetch(request, sourceUrl, signal, range);
      if (retryableSourceStatus(response.status)) {
        lastError = new Error(`Direct Play source returned ${response.status}`);
        if (response.body) void response.body.cancel().catch(() => undefined);
        continue;
      }
      const contentRange = parseContentRange(response.headers.get('content-range'));
      if (response.status !== 206 || !contentRange || contentRange.start !== start || !response.body) {
        lastError = new Error(`Direct Play source did not return exact range at ${start}`);
        continue;
      }
      preferSource(config, cache, sourceUrl);
      return { reader: response.body.getReader(), sourceUrl };
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`No Direct Play source can continue at byte ${start}`);
}

async function postMetrics(cache, force) {
  if (cache.released) return;
  const timestamp = now();
  if (!force && timestamp - cache.lastMetricsAt < 500) return;
  cache.lastMetricsAt = timestamp;
  cache.metrics.generation = cache.generation;
  cache.metrics.mode = cache.mode;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const payload = {
    type: 'macha-direct-read-ahead-metrics',
    sourceKey: cache.sourceKey,
    metrics: { ...cache.metrics },
  };
  for (const client of clients) client.postMessage(payload);
}

async function postSourceFailure(cache, sourceUrl, error) {
  if (cache.released || cache.sourceFailureNotified) return;
  cache.sourceFailureNotified = true;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const payload = {
    type: 'macha-direct-read-ahead-source-failed',
    sourceKey: cache.sourceKey,
    sourceUrl,
    message: error && error.message ? error.message : 'Direct Play read-ahead source failed',
  };
  for (const client of clients) client.postMessage(payload);
}

function disableReadAhead(cache) {
  const config = sourceConfigs.get(cache.sourceKey);
  if (config) config.rangeUnsupported = true;
  abortPrefetch(cache, false);
  cache.segments.clear();
  cache.metrics.residentBytes = 0;
  cache.metrics.aheadBytes = 0;
}

function noteDemand(cache) {
  cache.lastDemandAt = now();
  cache.lastAccess = Date.now();
  abortPrefetch(cache, true);
}

function demandWaitStarted(cache) {
  cache.pendingDemandWaits += 1;
  noteDemand(cache);
}

function demandWaitFinished(cache) {
  cache.pendingDemandWaits = Math.max(0, cache.pendingDemandWaits - 1);
}

function readAheadEnabled(cache) {
  return cache.mode === 'playing' || cache.mode === 'paused';
}

function schedulePrefetch(cache) {
  if (cache.released || !readAheadEnabled(cache) || cache.pendingDemandWaits > 0) return;
  clearPrefetchTimer(cache);
  const quietFor = now() - cache.lastDemandAt;
  const delay = Math.max(0, PREFETCH_QUIET_MS - quietFor);
  cache.prefetchTimer = setTimeout(() => {
    cache.prefetchTimer = undefined;
    void pumpPrefetch(cache);
  }, delay);
}

async function pumpPrefetch(cache) {
  if (cache.released || !readAheadEnabled(cache) || cache.prefetchController || cache.pendingDemandWaits > 0) return;
  const quietFor = now() - cache.lastDemandAt;
  if (quietFor < PREFETCH_QUIET_MS) {
    schedulePrefetch(cache);
    return;
  }

  updateAheadBytes(cache);
  if (cache.metrics.aheadBytes >= TARGET_AHEAD_BYTES) return;
  const start = Math.max(0, Math.min(cache.totalSize, cache.lastServedOffset));
  if (start >= cache.totalSize) return;
  const cachedEnd = contiguousCachedEnd(cache, start);
  const fetchStart = cachedEnd >= start ? cachedEnd + 1 : start;
  if (fetchStart >= cache.totalSize) return;
  const fetchEnd = Math.min(cache.totalSize - 1, fetchStart + PREFETCH_BLOCK_BYTES - 1);

  const controller = new AbortController();
  cache.prefetchController = controller;
  cache.prefetchRange = { start: fetchStart, end: fetchEnd };
  cache.metrics.prefetchFetches += 1;
  activeFetchStarted(cache);
  const startedAt = now();
  let retryDelayMs = 0;
  try {
    const config = sourceConfigs.get(cache.sourceKey);
    if (!config) return;
    let selected;
    let lastError;
    for (const sourceUrl of configuredSourceUrls(config)) {
      try {
        const response = await fetch(sourceUrl, {
          method: 'GET',
          headers: {
            Accept: cache.mimeType || '*/*',
            Range: `bytes=${fetchStart}-${fetchEnd}`,
          },
          credentials: sourceCredentials(sourceUrl),
          cache: 'no-store',
          signal: controller.signal,
        });
        const contentRange = parseContentRange(response.headers.get('content-range'));
        if (response.status !== 206 || !contentRange || contentRange.start !== fetchStart
            || (contentRange.total && contentRange.total !== cache.totalSize)) {
          lastError = new Error(`Direct Play precache source did not return exact range at ${fetchStart}`);
          if (response.body) void response.body.cancel().catch(() => undefined);
          continue;
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) {
          lastError = new Error('Direct Play precache source returned no bytes');
          continue;
        }
        selected = { sourceUrl, buffer, contentType: response.headers.get('content-type') };
        preferSource(config, cache, sourceUrl);
        cache.sourceFailureNotified = false;
        cache.prefetchFailureCount = 0;
        break;
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        lastError = error;
      }
    }
    if (!selected) throw lastError || new Error('No Direct Play precache source remains');
    if (selected.contentType) cache.mimeType = selected.contentType;
    const buffer = selected.buffer;
    if (controller.signal.aborted || cache.released || !readAheadEnabled(cache)) return;
    const elapsedMs = Math.max(1, now() - startedAt);
    cache.metrics.fetchedBytes += buffer.byteLength;
    cache.metrics.prefetchBytes += buffer.byteLength;
    cache.metrics.lastFetchMbps = rounded((buffer.byteLength * 8) / (elapsedMs * 1000), 2);
    storeSegment(cache, fetchStart, buffer);
    cache.lastAccess = Date.now();
    void postMetrics(cache, false);
  } catch (error) {
    if (!(error && error.name === 'AbortError')) {
      // Every configured source has failed. Speculation still cannot become a
      // viewer failure; active demand will independently retry the bounded set.
      void postMetrics(cache, true);
      void postSourceFailure(cache, cache.sourceUrl, error);
      cache.prefetchFailureCount += 1;
      retryDelayMs = Math.min(30_000, 1_000 * (2 ** Math.min(cache.prefetchFailureCount - 1, 5)));
    }
  } finally {
    if (cache.prefetchController === controller) {
      cache.prefetchController = undefined;
      cache.prefetchRange = undefined;
    }
    activeFetchFinished(cache);
  }

  if (!cache.released && readAheadEnabled(cache) && now() - cache.lastDemandAt >= PREFETCH_QUIET_MS) {
    if (retryDelayMs > 0) {
      clearPrefetchTimer(cache);
      cache.prefetchTimer = setTimeout(() => {
        cache.prefetchTimer = undefined;
        void pumpPrefetch(cache);
      }, retryDelayMs);
    } else {
      void pumpPrefetch(cache);
    }
  }
}

function setMode(sourceKey, mode) {
  const config = sourceConfigs.get(sourceKey);
  if (!config) return;
  if (mode === 'seeking' && config.mode !== 'seeking') config.generation += 1;
  config.mode = mode;
  config.lastAccess = Date.now();
  const cache = sourceCaches.get(sourceKey);
  if (!cache) return;
  cache.mode = mode;
  cache.generation = config.generation;
  cache.metrics.generation = cache.generation;
  cache.metrics.mode = mode;
  // Pause freezes presentation only. Preserve an in-flight range and continue
  // filling the bounded read-ahead cache for the expected resume.
  if (mode === 'playing' || mode === 'paused') schedulePrefetch(cache);
  else abortPrefetch(cache, false);
  updateAheadBytes(cache);
  void postMetrics(cache, true);
}

function cacheStream(cache, start, end) {
  let cursor = start;
  return new ReadableStream({
    pull(controller) {
      if (cursor > end) {
        controller.close();
        return;
      }
      noteDemand(cache);
      const entry = segmentContaining(cache, cursor, true);
      if (!entry) {
        controller.error(new Error(`Read-ahead cache lost byte ${cursor}`));
        return;
      }
      entry.generation = cache.generation;
      const offset = cursor - entry.start;
      const available = Math.min(end - cursor + 1, entry.buffer.byteLength - offset);
      if (available <= 0) {
        controller.error(new Error(`Read-ahead cache entry did not contain byte ${cursor}`));
        return;
      }
      controller.enqueue(new Uint8Array(entry.buffer, offset, available));
      cache.metrics.servedBytes += available;
      cache.metrics.cacheHitBytes += available;
      cache.metrics.demandBytes += available;
      cursor += available;
      cache.lastServedOffset = cursor;
      updateAheadBytes(cache);
      schedulePrefetch(cache);
      void postMetrics(cache, false);
    },
  });
}

function wrapDemandResponse(cache, response, request, config, requested, requestStartedAt, abortController, initialSourceUrl) {
  if (!response.body) {
    activeFetchFinished(cache);
    return response;
  }
  let reader = response.body.getReader();
  const attemptedSources = new Set([initialSourceUrl]);
  let cursor = requested.start;
  let firstByte = true;
  return new Response(new ReadableStream({
    async pull(controller) {
      noteDemand(cache);
      while (true) {
        try {
          demandWaitStarted(cache);
          let result;
          try {
            result = await reader.read();
          } finally {
            demandWaitFinished(cache);
          }
          if (result.done) {
            if (requested.partial && cursor <= requested.end) {
              if (abortController.signal.aborted) {
                activeFetchFinished(cache);
                return;
              }
              const replacement = await exactRangeReader(
                request, config, cache, abortController.signal, cursor, requested.end, attemptedSources,
              );
              reader = replacement.reader;
              attemptedSources.add(replacement.sourceUrl);
              continue;
            }
            controller.close();
            schedulePrefetch(cache);
            activeFetchFinished(cache);
            return;
          }
          const value = result.value;
          if (firstByte) {
            firstByte = false;
            const firstByteMs = Math.max(0, now() - requestStartedAt);
            cache.metrics.demandFirstByteMs = rounded(firstByteMs, 1);
            if (firstByteMs >= DEMAND_WAIT_WARN_MS) {
              cache.metrics.demandWaitCount += 1;
              cache.metrics.demandWaitMs = rounded(cache.metrics.demandWaitMs + firstByteMs, 1);
            }
          }
          const byteLength = value.byteLength || 0;
          cache.metrics.fetchedBytes += byteLength;
          cache.metrics.demandBytes += byteLength;
          cache.metrics.servedBytes += byteLength;
          const chunkStart = cursor;
          cursor += byteLength;
          cache.lastServedOffset = cursor;
          cache.lastAccess = Date.now();
          controller.enqueue(value);
          // Caching is a beneficiary of demand, never a prerequisite for it.
          // Copy/cache after enqueue so cache bookkeeping cannot extend first-byte
          // or steady-state demand delivery latency.
          queueMicrotask(() => storeStreamChunk(cache, chunkStart, value));
          updateAheadBytes(cache);
          schedulePrefetch(cache);
          void postMetrics(cache, false);
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') {
            activeFetchFinished(cache);
            controller.error(abortError('Direct Play demand fetch aborted'));
            return;
          }
          try {
            const replacement = await exactRangeReader(
              request, config, cache, abortController.signal, cursor, requested.end, attemptedSources,
            );
            reader = replacement.reader;
            attemptedSources.add(replacement.sourceUrl);
          } catch (replacementError) {
            activeFetchFinished(cache);
            // See demandFetch's catch: a demand-path exhaustion is the same
            // urgent evidence a prefetch-path exhaustion already reports.
            void postSourceFailure(cache, cache.sourceUrl, replacementError);
            controller.error(replacementError);
            return;
          }
        }
      }
    },
    async cancel(reason) {
      if (!abortController.signal.aborted) abortController.abort();
      try {
        await reader.cancel(reason);
      } catch {
        // Browser cancellation is normal during media probing and seeking.
      }
      schedulePrefetch(cache);
      activeFetchFinished(cache);
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function demandFetch(cache, request, config, rangeOverride, requested) {
  noteDemand(cache);
  const controller = new AbortController();
  const startedAt = now();
  cache.metrics.demandFetches += 1;
  activeFetchStarted(cache);
  try {
    demandWaitStarted(cache);
    let opened;
    try {
      opened = await directFetchWithFailover(request, config, cache, controller.signal, rangeOverride);
    } finally {
      demandWaitFinished(cache);
    }
    const { response, sourceUrl } = opened;
    if (rangeOverride && response.status !== 206) {
      disableReadAhead(cache);
      activeFetchFinished(cache);
      return response;
    }
    return wrapDemandResponse(cache, response, request, config, requested, startedAt, controller, sourceUrl);
  } catch (error) {
    activeFetchFinished(cache);
    // Unlike a prefetch miss, a failed demand fetch is about to surface as a
    // real player-facing read error — but the client cannot react to what it
    // is never told. This is the earliest and most urgent evidence a source
    // has actually failed; it must reach the client at least as reliably as
    // a speculative prefetch failure already does.
    if (!(error && error.name === 'AbortError')) void postSourceFailure(cache, cache.sourceUrl, error);
    throw error;
  }
}

function cacheThenDemandResponse(cache, request, config, requested, cachedEnd) {
  noteDemand(cache);
  const networkStart = cachedEnd + 1;
  const abortController = new AbortController();
  const networkStartedAt = now();
  cache.metrics.demandFetches += 1;
  cache.metrics.demandFirstByteMs = 0;
  activeFetchStarted(cache);

  let networkReader;
  const attemptedSources = new Set();
  let networkFinished = false;
  const finishNetwork = () => {
    if (networkFinished) return;
    networkFinished = true;
    activeFetchFinished(cache);
  };
  const networkReaderPromise = exactRangeReader(
    request, config, cache, abortController.signal, networkStart, requested.end, attemptedSources,
  ).then((opened) => {
    networkReader = opened.reader;
    attemptedSources.add(opened.sourceUrl);
    return networkReader;
  }).catch((error) => {
    finishNetwork();
    throw error;
  });

  let cursor = requested.start;
  let firstNetworkByte = true;
  const stream = new ReadableStream({
    async pull(controller) {
      noteDemand(cache);
      if (cursor <= cachedEnd) {
        const entry = segmentContaining(cache, cursor, true);
        if (!entry) {
          controller.error(new Error(`Read-ahead cache lost byte ${cursor}`));
          return;
        }
        entry.generation = cache.generation;
        const offset = cursor - entry.start;
        const available = Math.min(cachedEnd - cursor + 1, entry.buffer.byteLength - offset);
        if (available <= 0) {
          controller.error(new Error(`Read-ahead cache entry did not contain byte ${cursor}`));
          return;
        }
        controller.enqueue(new Uint8Array(entry.buffer, offset, available));
        cache.metrics.servedBytes += available;
        cache.metrics.cacheHitBytes += available;
        cache.metrics.demandBytes += available;
        cursor += available;
        cache.lastServedOffset = cursor;
        updateAheadBytes(cache);
        void postMetrics(cache, false);
        return;
      }

      try {
        demandWaitStarted(cache);
        let result;
        try {
          await networkReaderPromise;
          result = await networkReader.read();
        } finally {
          demandWaitFinished(cache);
        }
        if (result.done) {
          if (cursor <= requested.end) {
            if (abortController.signal.aborted) {
              finishNetwork();
              return;
            }
            const replacement = await exactRangeReader(
              request, config, cache, abortController.signal, cursor, requested.end, attemptedSources,
            );
            networkReader = replacement.reader;
            attemptedSources.add(replacement.sourceUrl);
            return;
          }
          controller.close();
          finishNetwork();
          schedulePrefetch(cache);
          return;
        }
        if (firstNetworkByte) {
          firstNetworkByte = false;
          const networkFirstByteMs = Math.max(0, now() - networkStartedAt);
          if (networkFirstByteMs >= DEMAND_WAIT_WARN_MS) {
            cache.metrics.demandWaitCount += 1;
            cache.metrics.demandWaitMs = rounded(cache.metrics.demandWaitMs + networkFirstByteMs, 1);
          }
        }
        const value = result.value;
        const byteLength = value.byteLength || 0;
        cache.metrics.fetchedBytes += byteLength;
        cache.metrics.demandBytes += byteLength;
        cache.metrics.servedBytes += byteLength;
        const chunkStart = cursor;
        cursor += byteLength;
        cache.lastServedOffset = cursor;
        cache.lastAccess = Date.now();
        controller.enqueue(value);
        // Caching is a beneficiary of demand, never a prerequisite for it.
        // Copy/cache after enqueue so cache bookkeeping cannot extend first-byte
        // or steady-state demand delivery latency.
        queueMicrotask(() => storeStreamChunk(cache, chunkStart, value));
        updateAheadBytes(cache);
        schedulePrefetch(cache);
        void postMetrics(cache, false);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          finishNetwork();
          controller.error(abortError('Direct Play demand continuation aborted'));
          return;
        }
        try {
          const replacement = await exactRangeReader(
            request, config, cache, abortController.signal, cursor, requested.end, attemptedSources,
          );
          networkReader = replacement.reader;
          attemptedSources.add(replacement.sourceUrl);
        } catch (replacementError) {
          finishNetwork();
          // See demandFetch's catch: a demand-path exhaustion is the same
          // urgent evidence a prefetch-path exhaustion already reports.
          void postSourceFailure(cache, cache.sourceUrl, replacementError);
          controller.error(replacementError);
        }
      }
    },
    async cancel(reason) {
      if (!abortController.signal.aborted) abortController.abort();
      try {
        if (networkReader) await networkReader.cancel(reason);
      } catch {
        // Browser cancellation is normal during media probing and seeking.
      }
      finishNetwork();
      schedulePrefetch(cache);
    },
  });

  return new Response(stream, {
    status: 206,
    headers: responseHeaders(cache, requested.start, requested.end, true),
  });
}

function validHttpSource(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sourceConfigForProxy(sourceKey, url) {
  const existing = sourceConfigs.get(sourceKey);
  if (existing) return existing;

  const sourceUrl = url.searchParams.get('source') || '';
  const totalSize = Number(url.searchParams.get('size'));
  const mimeType = url.searchParams.get('mime') || 'application/octet-stream';
  if (!validHttpSource(sourceUrl) || !Number.isSafeInteger(totalSize) || totalSize <= 0) return undefined;

  const config = {
    sourceUrl,
    sourceUrls: [sourceUrl],
    totalSize,
    mimeType,
    lastAccess: Date.now(),
    rangeUnsupported: false,
    mode: 'bootstrap',
    generation: 0,
  };
  sourceConfigs.set(sourceKey, config);
  return config;
}

async function handleProxy(request, url) {
  const sourceKey = url.searchParams.get('key');
  if (!sourceKey) return new Response('Unknown Macha direct-play read-ahead source', { status: 404 });
  const config = sourceConfigForProxy(sourceKey, url);
  if (!config) return new Response('Unknown Macha direct-play read-ahead source', { status: 404 });
  const { sourceUrl, totalSize, mimeType } = config;
  config.lastAccess = Date.now();
  if (config.rangeUnsupported) return (await directFetchWithFailover(request, config, undefined, undefined)).response;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  pruneIdleSources();
  const requested = parseRequestedRange(request.headers.get('range'), totalSize);
  if (!requested) return (await directFetchWithFailover(request, config, undefined, undefined)).response;
  if (requested.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${totalSize}`, 'Accept-Ranges': 'bytes' },
    });
  }

  const cache = getSourceCache(sourceKey, sourceUrl, totalSize, mimeType);
  cache.lastAccess = Date.now();

  if (request.method === 'HEAD') return (await directFetchWithFailover(request, config, cache, undefined)).response;

  // A complete resident range is an immediate memory hit. Otherwise demand is
  // proxied as the browser asked for it; there is deliberately no 8 MiB
  // completion barrier and no speculative queue in front of it.
  if (requested.partial) {
    const cachedEnd = contiguousCachedEnd(cache, requested.start, requested.end);
    if (cachedEnd >= requested.end) {
      return new Response(cacheStream(cache, requested.start, requested.end), {
        status: 206,
        headers: responseHeaders(cache, requested.start, requested.end, true),
      });
    }
    if (cachedEnd >= requested.start) {
      return cacheThenDemandResponse(cache, request, config, requested, cachedEnd);
    }
  }

  const rangeOverride = requested.partial ? `bytes=${requested.start}-${requested.end}` : undefined;
  return await demandFetch(cache, request, config, rangeOverride, requested);
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
    if (sourceKey && validHttpSource(sourceUrl) && Number.isSafeInteger(totalSize) && totalSize > 0) {
      sourceConfigs.set(sourceKey, {
        sourceUrl,
        sourceUrls: [sourceUrl],
        totalSize,
        mimeType,
        lastAccess: Date.now(),
        rangeUnsupported: false,
        mode: 'bootstrap',
        generation: 0,
      });
      const port = event.ports && event.ports[0];
      if (port) port.postMessage({ type: 'macha-direct-read-ahead-configured', sourceKey });
    }
    return;
  }
  if (data.type === 'macha-direct-read-ahead-add-source') {
    const sourceKey = typeof data.sourceKey === 'string' ? data.sourceKey : '';
    const sourceUrl = typeof data.sourceUrl === 'string' ? data.sourceUrl : '';
    const config = sourceConfigs.get(sourceKey);
    if (config && validHttpSource(sourceUrl)) {
      if (!Array.isArray(config.sourceUrls)) config.sourceUrls = [config.sourceUrl];
      if (!config.sourceUrls.includes(sourceUrl)) config.sourceUrls.push(sourceUrl);
      config.lastAccess = Date.now();
    }
    return;
  }
  if (data.type === 'macha-direct-read-ahead-state' && typeof data.sourceKey === 'string') {
    if (data.mode === 'bootstrap' || data.mode === 'playing' || data.mode === 'seeking' || data.mode === 'paused') {
      setMode(data.sourceKey, data.mode);
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
  event.respondWith(handleProxy(event.request, url).catch((error) => {
    // Source release/browser cancellation is routine during navigation and
    // seek probing. Do not leak a rejected FetchEvent promise to the console.
    if (error && error.name === 'AbortError') return new Response(null, { status: 499 });
    throw error;
  }));
});
