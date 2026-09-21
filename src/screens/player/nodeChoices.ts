import type { EndpointCandidate } from '@machafoundation/core';

export interface PlayerNodeChoice {
  /** The node's identity: its `nodeId` once a node has advertised one. */
  id: string;
  /** Every endpoint that reaches this node, because a viewer picks a node. */
  endpointIds: string[];
  /** What the pill says. */
  label: string;
  /** What hovering it says: the whole origin, and why it is not choosable. */
  detail: string;
  /** This is the node serving the generation on screen right now. */
  active: boolean;
  /** Out of any failure cooldown, so asking for it is worth doing. */
  ready: boolean;
}

/**
 * **The host, because that is what the rest of the client calls a node.** The
 * Status screen's node cards read `node.host`, and the player's own status
 * line already names the streaming node as an origin. A pill has room for
 * neither a URL nor a node ID, and `MachaEndpoint` carries no display name at
 * all, so the host is the only short thing a viewer can recognise.
 *
 * The port comes back only when two endpoints share a host, because then it is
 * the whole distinction; carrying it always would put `:7438` on every pill to
 * no purpose. Nothing is invented when the URL will not parse — the raw string
 * is the label, which at least matches what the viewer configured.
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

/**
 * The nodes the viewer can send this stream to, in the registry's own order.
 *
 * **Grouped by node, not by endpoint.** One node is commonly two entries — a
 * LAN address and an advertised name — and offering both as separate pills
 * asks the viewer to choose between two doors onto the same machine, which is
 * not a choice anybody has. Entries sharing a `nodeId` collapse into one pill;
 * an entry with no `nodeId` yet stands alone, because the client genuinely
 * does not know whose it is and guessing would merge two real nodes.
 *
 * **Sorted by name, deliberately, and never by rank.** The registry's order
 * is a live ranking — it moves as latency, throughput and cooldowns move — so
 * a list in that order re-arranges itself under the pointer on the way to a
 * click, and the node a viewer picks is not the one they aimed at. Sorting by
 * the label makes the position of a node a property of the cluster rather
 * than of this second's measurements: the same nodes always draw in the same
 * order, and with dozens of them a viewer can find one by where it is.
 *
 * Numeric-aware, because these are mostly addresses and hostnames with
 * numbers in: `10.9` sorts before `10.10`, and `node-2` before `node-10`.
 * The node id breaks ties so two nodes sharing a label never swap places.
 */
export function playerNodeChoices(
  candidates: readonly EndpointCandidate[],
  activeEndpointId?: string,
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
      label: nodeLabel(preferredAddress(group), shared),
      detail: active
        ? `${addresses.join(', ')} — serving this stream`
        : ready ? addresses.join(', ') : `${addresses.join(', ')} — cooling down after a failure`,
      active,
      ready,
    };
  });

  return choices.sort((left, right) => COLLATOR.compare(left.label, right.label) || COLLATOR.compare(left.id, right.id));
}

/** Numeric-aware and case-insensitive: these are addresses, not prose. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Which of a node's addresses names it on the pill.
 *
 * A name beats an IP: `macnessa.macha.network` is what an operator calls that
 * machine, `10.44.1.50` is where it happens to live this week. Order within
 * the group decides nothing, so this does not depend on which door the
 * registry happened to list first.
 */
function preferredAddress(group: readonly EndpointCandidate[]): string {
  const named = group.find((candidate) => {
    const host = hostname(candidate.endpoint.baseUrl);
    return host !== undefined && !/^[\d.]+$/.test(host) && !/^\[?[\da-f:]+\]?$/i.test(host);
  });
  return (named ?? group[0]).endpoint.baseUrl;
}
