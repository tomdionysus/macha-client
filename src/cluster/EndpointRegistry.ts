import { normalizeBaseUrl } from '../api/httpCompat';

export type EndpointSource = 'bootstrap' | 'environment' | 'discovered';

export interface MachaEndpoint {
  /** Provisional identity until the server advertises a durable node ID. */
  id: string;
  baseUrl: string;
  source: EndpointSource;
  nodeId?: string;
}

export interface EndpointHealth {
  consecutiveFailures: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  retryAt?: number;
}

export interface EndpointCandidate {
  endpoint: MachaEndpoint;
  health: EndpointHealth;
}

/** Transport-neutral shape consumed by the registry once servers advertise APIs. */
export interface EndpointAdvertisement {
  nodeId?: string;
  apiBaseUrls: readonly string[];
}

const FAILURE_COOLDOWN_MS = [500, 2_000, 10_000, 30_000] as const;

export function endpointId(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl);
}

export function bootstrapEndpoints(urls: readonly string[], source: EndpointSource = 'bootstrap'): MachaEndpoint[] {
  const unique = new Set<string>();
  const endpoints: MachaEndpoint[] = [];
  for (const value of urls) {
    const baseUrl = normalizeBaseUrl(value);
    if (!baseUrl) continue;
    if (unique.has(baseUrl)) continue;
    unique.add(baseUrl);
    endpoints.push({ id: endpointId(baseUrl), baseUrl, source });
  }
  return endpoints;
}

/**
 * Endpoint ordering from real request and active-probe evidence. The registry
 * owns no timer itself; callers feed it outcomes and ask for candidates.
 */
export class EndpointRegistry {
  private endpoints: MachaEndpoint[];
  private readonly health = new Map<string, EndpointHealth>();
  private readonly listeners = new Set<() => void>();
  private preferredId?: string;

  constructor(endpoints: readonly MachaEndpoint[], private readonly now: () => number = Date.now) {
    this.endpoints = this.deduplicate(endpoints);
  }

  replace(endpoints: readonly MachaEndpoint[]): void {
    this.endpoints = this.deduplicate(endpoints);
    const retained = new Set(this.endpoints.map((endpoint) => endpoint.id));
    for (const id of this.health.keys()) if (!retained.has(id)) this.health.delete(id);
    if (this.preferredId && !retained.has(this.preferredId)) this.preferredId = undefined;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Apply the latest endpoint advertisement while retaining configured seeds.
   * Discovery is a refreshable view, not durable configuration. Matching seeds
   * gain durable node identity but remain bootstrap candidates.
   */
  applyAdvertisement(advertisements: readonly EndpointAdvertisement[]): void {
    const advertisedByUrl = new Map<string, string | undefined>();
    for (const advertisement of advertisements) {
      for (const value of advertisement.apiBaseUrls) {
        const baseUrl = normalizeBaseUrl(value);
        if (!baseUrl) continue;
        if (!advertisedByUrl.has(baseUrl)) advertisedByUrl.set(baseUrl, advertisement.nodeId);
      }
    }

    const retained = this.endpoints
      .filter((endpoint) => endpoint.source !== 'discovered')
      .map((endpoint) => {
        const nodeId = advertisedByUrl.get(endpoint.baseUrl);
        advertisedByUrl.delete(endpoint.baseUrl);
        return nodeId ? { ...endpoint, nodeId } : endpoint;
      });
    const discovered = [...advertisedByUrl].map(([baseUrl, nodeId]) => ({
      id: endpointId(baseUrl),
      baseUrl,
      source: 'discovered' as const,
      ...(nodeId ? { nodeId } : {}),
    }));
    this.replace([...retained, ...discovered]);
  }

  candidates(excludedIds: ReadonlySet<string> = new Set()): EndpointCandidate[] {
    const now = this.now();
    const candidates = this.endpoints
      .filter((endpoint) => !excludedIds.has(endpoint.id))
      .map((endpoint, order) => ({
        endpoint,
        health: { ...(this.health.get(endpoint.id) ?? { consecutiveFailures: 0 }) },
        order,
      }));

    candidates.sort((left, right) => {
      const leftReady = (left.health.retryAt ?? 0) <= now;
      const rightReady = (right.health.retryAt ?? 0) <= now;
      if (leftReady !== rightReady) return leftReady ? -1 : 1;
      const leftPreferred = left.endpoint.id === this.preferredId;
      const rightPreferred = right.endpoint.id === this.preferredId;
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      if (!leftReady && !rightReady) return (left.health.retryAt ?? 0) - (right.health.retryAt ?? 0);
      if (left.health.consecutiveFailures !== right.health.consecutiveFailures) {
        return left.health.consecutiveFailures - right.health.consecutiveFailures;
      }
      return left.order - right.order;
    });

    return candidates.map(({ endpoint, health }) => ({ endpoint, health }));
  }

  recordSuccess(endpointIdValue: string): void {
    this.recordHealthy(endpointIdValue, true);
  }

  /** Health probes must not reshuffle the sticky endpoint used by real work. */
  recordProbeSuccess(endpointIdValue: string): void {
    this.recordHealthy(endpointIdValue, false);
  }

  private recordHealthy(endpointIdValue: string, prefer: boolean): void {
    this.health.set(endpointIdValue, {
      consecutiveFailures: 0,
      lastSuccessAt: this.now(),
    });
    if (prefer) this.preferredId = endpointIdValue;
    this.notify();
  }

  recordFailure(endpointIdValue: string): void {
    const previous = this.health.get(endpointIdValue);
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    const now = this.now();
    const cooldownIndex = Math.min(consecutiveFailures - 1, FAILURE_COOLDOWN_MS.length - 1);
    this.health.set(endpointIdValue, {
      ...previous,
      consecutiveFailures,
      lastFailureAt: now,
      retryAt: now + FAILURE_COOLDOWN_MS[cooldownIndex],
    });
    if (this.preferredId === endpointIdValue) this.preferredId = undefined;
    this.notify();
  }

  snapshot(): EndpointCandidate[] {
    return this.endpoints.map((endpoint) => ({
      endpoint,
      health: { ...(this.health.get(endpoint.id) ?? { consecutiveFailures: 0 }) },
    }));
  }

  private deduplicate(endpoints: readonly MachaEndpoint[]): MachaEndpoint[] {
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const result: MachaEndpoint[] = [];
    for (const endpoint of endpoints) {
      const baseUrl = normalizeBaseUrl(endpoint.baseUrl);
      if (!baseUrl) continue;
      // One node may advertise several independently reachable API bases.
      // nodeId groups candidates but must never collapse endpoint identity.
      const id = endpoint.id || endpointId(baseUrl);
      if (seenIds.has(id) || seenUrls.has(baseUrl)) continue;
      seenIds.add(id);
      seenUrls.add(baseUrl);
      result.push({ ...endpoint, id, baseUrl });
    }
    return result;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
