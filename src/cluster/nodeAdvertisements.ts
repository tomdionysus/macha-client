import type { ClusterNodeStatus, EndpointAdvertisement, EndpointCandidate } from '@machafoundation/core';

function origin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function hostAndPort(value: string): { host: string; port: number } | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  return { host: url.hostname, port };
}

/**
 * Which endpoints are doors onto the same node.
 *
 * **Core stamps node identity from one URL, and a node has more than one.**
 * The health cycle advertises each node's `api_endpoint`, so the endpoint a
 * viewer typed as a LAN address stays *Unidentified node* for ever while the
 * advertised name beside it is identified — and the two are one machine. Every
 * surface that groups by node then shows it twice.
 *
 * So this matches the node's `host:port` as well as its advertised endpoint,
 * and returns an advertisement naming **only endpoints the registry already
 * has**. That last part is the whole reason this builds a list rather than
 * handing core the obvious `http://host:port`: `applyAdvertisement` adds any
 * advertised URL it cannot match as a newly discovered endpoint, so guessing
 * at URL forms would invent endpoints nobody can reach.
 */
export function nodeIdentityAdvertisements(
  nodes: readonly ClusterNodeStatus[],
  known: readonly EndpointCandidate[],
): EndpointAdvertisement[] {
  const advertisements: EndpointAdvertisement[] = [];
  for (const node of nodes) {
    const advertised = node.api_endpoint ? origin(node.api_endpoint) : undefined;
    const apiBaseUrls = known
      .map((candidate) => candidate.endpoint.baseUrl)
      .filter((baseUrl) => {
        if (!baseUrl) return false;
        if (advertised !== undefined && origin(baseUrl) === advertised) return true;
        const parts = hostAndPort(baseUrl);
        return parts !== undefined && parts.host === node.host && parts.port === node.port;
      });
    if (apiBaseUrls.length > 0) advertisements.push({ nodeId: node.id, apiBaseUrls });
  }
  return advertisements;
}
