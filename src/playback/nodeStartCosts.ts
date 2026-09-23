import type { PlaybackResolver } from '@machafoundation/core';

/**
 * What it costs each node to start a stream, measured by this viewer.
 *
 * **Session create to first fragment.** A node produces a generation
 * sequentially from the position it was asked for at create, so everything
 * between the request and the first fragment is time the viewer travels while
 * the node has produced nothing. Measured live 2026-09-23 on gbni-1: create
 * 3.3 s, first fragment a further 12.3 s, and a handover that asked for the
 * viewer's position started 15.6 s behind a join receding at 1x. No node
 * states this figure, and its start timeout is a ceiling rather than an
 * expectation (core, 2026-09-23), so it is measured here.
 *
 * **The latest figure, and only while it is fresh.** A node under load is
 * slower now than it was, so the newest measurement wins, and one older than
 * `START_COST_STALE_MS` answers nothing rather than a guess. Never a
 * constant: a figure frozen in a client is the `look_ahead_ms` fault.
 *
 * Keyed by origin, because that is what a session URL and an endpoint share.
 * A node reachable at two addresses is asked about by all of them.
 */

/** Past this a measurement describes the node as it was, not as it is. */
export const START_COST_STALE_MS = 10 * 60_000;
/** A session whose first fragment never came is not waited on forever. */
const PENDING_LIMIT_MS = 5 * 60_000;

export interface NodeStartCost {
  costMs: number;
  ageMs: number;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export class NodeStartCosts {
  private readonly pending = new Map<string, number>();
  private readonly measured = new Map<string, { costMs: number; atMs: number }>();

  /** One clock for both ends, so a span is never taken across two. */
  constructor(readonly now: () => number) {}

  /** A session for this source URL was asked for at `startedAtMs`. */
  requested(sourceUrl: string, startedAtMs: number): void {
    const now = this.now();
    for (const [url, at] of this.pending) if (now - at > PENDING_LIMIT_MS) this.pending.delete(url);
    this.pending.set(sourceUrl, startedAtMs);
  }

  /**
   * The first media fragment of this source arrived. Later ones are not start
   * cost. Answers the measurement it made, if this was the one to make it.
   */
  firstFragment(sourceUrl: string): number | undefined {
    const startedAtMs = this.pending.get(sourceUrl);
    if (startedAtMs === undefined) return undefined;
    this.pending.delete(sourceUrl);
    const origin = originOf(sourceUrl);
    if (!origin) return undefined;
    const now = this.now();
    const costMs = Math.round(now - startedAtMs);
    this.measured.set(origin, { costMs, atMs: now });
    return costMs;
  }

  /** The freshest measurement across a node's addresses, or nothing. */
  forNode(baseUrls: readonly string[]): NodeStartCost | undefined {
    const now = this.now();
    let freshest: { costMs: number; atMs: number } | undefined;
    for (const baseUrl of baseUrls) {
      const origin = originOf(baseUrl);
      const entry = origin ? this.measured.get(origin) : undefined;
      if (entry && (!freshest || entry.atMs > freshest.atMs)) freshest = entry;
    }
    if (!freshest || now - freshest.atMs > START_COST_STALE_MS) return undefined;
    return { costMs: freshest.costMs, ageMs: Math.round(now - freshest.atMs) };
  }
}

/** Shared by the resolver wrapper and the player, which see the two ends. */
export const nodeStartCosts = new NodeStartCosts(() => performance.now());

function sessionSourceUrl(value: unknown): string | undefined {
  const url = (value as { source?: { url?: unknown } } | undefined)?.source?.url;
  return typeof url === 'string' ? url : undefined;
}

/**
 * The resolver core is given, with every session-producing call timed.
 *
 * Generic over the interface rather than naming its methods: whichever call
 * resolves to a session (a start, a failover, a regeneration, a move, a
 * standby) is stamped with when it was asked for, so a method core adds later
 * is measured without this being edited. Everything else passes through, and
 * an optional method the inner resolver lacks stays absent, because core
 * branches on whether it exists.
 */
export function measureStartCosts(resolver: PlaybackResolver, costs: NodeStartCosts = nodeStartCosts): PlaybackResolver {
  return new Proxy(resolver, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const startedAtMs = costs.now();
        const result = value.apply(target, args);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          void (result as Promise<unknown>).then((resolved) => {
            const url = sessionSourceUrl(resolved);
            if (url) costs.requested(url, startedAtMs);
          }, () => undefined);
        }
        return result;
      };
    },
  });
}
