import type { EndpointCandidate } from '@machafoundation/core';

export interface PlayerNodeChoice {
  /** The `nodeId` once the node has advertised one, else the endpoint id. */
  id: string;
  /** Every endpoint that reaches this node. */
  endpointIds: string[];
  label: string;
  /** Hover text: the full addresses, and why the node is not choosable. */
  detail: string;
  /** Serving the generation on screen. */
  active: boolean;
  /** Out of any failure cooldown. */
  ready: boolean;
}

/**
 * The host, as the rest of the client names a node. The port is added only when two endpoints
 * share a host; an unparseable URL is shown as configured.
 */
function nodeLabel(baseUrl: string, sharedHosts: ReadonlySet<string>): string {
  if (!baseUrl) return 'same origin';
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  return sharedHosts.has(url.hostname) && url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

function hostname(baseUrl: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

/** The host, never the whole URL, for status lines; an unparseable address is shown as it is. */
export function nodeName(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  // `||`, not `??`: an address that parses with no host (a `file:` URL) gives an empty string.
  return hostname(endpoint) || endpoint;
}

/**
 * The nodes the viewer can send this stream to.
 *
 * Grouped by node: endpoints sharing a `nodeId` (a LAN address and an advertised name, say) are
 * one pill. An endpoint with no `nodeId` stands alone, as merging on a guess could join two nodes.
 *
 * Sorted by label, never by the registry's order: that is a live ranking, and a list in it would
 * rearrange itself under the pointer. The node id breaks ties.
 */
export function playerNodeChoices(
  candidates: readonly EndpointCandidate[],
  activeEndpointId?: string,
  /** The cluster's name for the node behind an endpoint, where core knows it. */
  nameOf?: (endpointId: string) => string | undefined,
): PlayerNodeChoice[] {
  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    const host = hostname(candidate.endpoint.baseUrl);
    if (host) seen.set(host, (seen.get(host) ?? 0) + 1);
  }
  const shared = new Set([...seen].filter(([, count]) => count > 1).map(([host]) => host));

  const byNode = new Map<string, EndpointCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.endpoint.nodeId ?? candidate.endpoint.id;
    const group = byNode.get(key);
    if (group) group.push(candidate);
    else byNode.set(key, [candidate]);
  }

  const choices = [...byNode].map(([id, group]) => {
    const active = activeEndpointId !== undefined && group.some((candidate) => candidate.endpoint.id === activeEndpointId);
    const ready = group.some((candidate) => candidate.ready);
    const addresses = group.map((candidate) => candidate.endpoint.baseUrl || 'same origin');
    return {
      id,
      endpointIds: group.map((candidate) => candidate.endpoint.id),
      label: group.map((candidate) => nameOf?.(candidate.endpoint.id)).find(Boolean) ?? nodeLabel(preferredAddress(group), shared),
      detail: active
        ? `${addresses.join(', ')} (serving this stream)`
        : ready ? addresses.join(', ') : `${addresses.join(', ')} (cooling down after a failure)`,
      active,
      ready,
    };
  });

  return choices.sort((left, right) => COLLATOR.compare(left.label, right.label) || COLLATOR.compare(left.id, right.id));
}

/** Numeric-aware, so `10.9` sorts before `10.10`. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The address that names a node on its pill: a hostname beats an IP, whatever the group's order. */
function preferredAddress(group: readonly EndpointCandidate[]): string {
  const named = group.find((candidate) => {
    const host = hostname(candidate.endpoint.baseUrl);
    return host !== undefined && !/^[\d.]+$/.test(host) && !/^\[?[\da-f:]+\]?$/i.test(host);
  });
  return (named ?? group[0]).endpoint.baseUrl;
}
