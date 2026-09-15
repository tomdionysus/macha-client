// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EndpointCandidate } from '@machafoundation/core';
import type { ClusterNodeStatus, ClusterStatusSnapshot } from '@machafoundation/core';
import type { IdentityAssociationResetResult, ManageApi } from '@machafoundation/core';
import { acceptNodeIdentityAssociationReset, clientEndpointHealth, conditionIsInformational, identityResetAcceptanceMessage, nodeInboundCapable, nodeNotYetReady, nodeStatusLabel, StatusHeader, statusSectionVisibility, systemMemoryBytes, TELEMETRY_AGEING_MS, TELEMETRY_STALE_MS, telemetryAge, withoutRetiredNodeIdentity } from './StatusScreen';

function candidate(health: EndpointCandidate['health'], ready = true): EndpointCandidate {
  return {
    endpoint: { id: 'http://node', baseUrl: 'http://node', source: 'bootstrap' },
    health,
    ready,
  };
}

describe('client API endpoint status', () => {
  it('distinguishes no evidence, success, active cooldown and elapsed cooldown', () => {
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 0 })).label).toBe('Not tried');
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 0, lastSuccessAt: 900 })).label).toBe('Available');
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 1 }, false)).label).toBe('Cooling down');
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 1 }, true)).label).toBe('Retry eligible');
  });

  it('takes the cooldown answer from the registry rather than recomputing it', () => {
    // This used to compare `health.retryAt` against `Date.now()`, which was
    // right only because App.tsx happens to inject `Date.now` as the registry's
    // clock. The registry's default is a duration clock whose origin restarts
    // near zero every load, so the comparison was one constructor argument away
    // from silently inverting — and inverting plausibly, on the screen someone
    // reads when a node is misbehaving.
    //
    // `ready` now decides, so a `retryAt` from any clock at all changes nothing.
    const cooling = candidate({ consecutiveFailures: 2, retryAt: Number.MAX_SAFE_INTEGER }, false);
    const eligible = candidate({ consecutiveFailures: 2, retryAt: Number.MAX_SAFE_INTEGER }, true);

    expect(clientEndpointHealth(cooling).label).toBe('Cooling down');
    expect(clientEndpointHealth(eligible).label).toBe('Retry eligible');
  });

  it('never calls a failing endpoint available, whatever it once managed', () => {
    // A node with a success behind it and failures in front of it is failing.
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 1, lastSuccessAt: 900 }, false)).label)
      .toBe('Cooling down');
  });
});

describe('status section routing', () => {
  it('renders exactly one top-level status section per route', () => {
    for (const section of ['overview', 'client', 'connectivity'] as const) {
      const visibility = statusSectionVisibility(section);
      expect(Object.values(visibility).filter(Boolean)).toHaveLength(1);
      expect(visibility[section]).toBe(true);
    }
  });

  it('uses the shared icon refresh control instead of a connectivity text action', () => {
    render(<StatusHeader eyebrow="Macha cluster" refreshing={false} onRefresh={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Refresh status' }).querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('Check connectivity')).toBeNull();
  });
});

describe('per-node phase distinct from connection state', () => {
  it('surfaces recovering/starting phase alongside an online state instead of collapsing to plain "online"', () => {
    const online = { state: 'online' } as ClusterNodeStatus;
    const ready = { state: 'online', phase: 'ready' } as ClusterNodeStatus;
    const recovering = { state: 'online', phase: 'recovering' } as ClusterNodeStatus;
    const starting = { state: 'online', phase: 'starting' } as ClusterNodeStatus;
    const unknownPhase = { state: 'online', phase: 'unknown' } as ClusterNodeStatus;
    const offlineRecovering = { state: 'offline', phase: 'recovering' } as ClusterNodeStatus;

    expect(nodeNotYetReady(online)).toBe(false);
    expect(nodeNotYetReady(ready)).toBe(false);
    expect(nodeNotYetReady(recovering)).toBe(true);
    expect(nodeNotYetReady(starting)).toBe(true);
    // Honestly-reported "unknown" is not a claim of readiness, but it isn't
    // evidence of unreadiness either — never guess past what the node reported.
    expect(nodeNotYetReady(unknownPhase)).toBe(false);
    // A node that isn't even online is already distinctly labelled by state.
    expect(nodeNotYetReady(offlineRecovering)).toBe(false);

    expect(nodeStatusLabel(online)).toBe('online');
    expect(nodeStatusLabel(recovering)).toBe('online, recovering');
    expect(nodeStatusLabel(starting)).toBe('online, starting');
    expect(nodeStatusLabel(unknownPhase)).toBe('online');
  });
});

describe('cluster conditions that are configuration rather than fault', () => {
  /**
   * A node configured to accept no inbound connections is a normal topology —
   * this cluster has one on its own LAN — and it is permanent. Painting it
   * amber on every visit to Status trains the reader to skip the row that will
   * one day carry something real.
   */
  it('does not warn about a node that accepts no inbound connections', () => {
    expect(conditionIsInformational('1 node accepts no inbound connections')).toBe(true);
    // The server counts them, so the count is not part of the match.
    expect(conditionIsInformational('2 nodes accept no inbound connections')).toBe(true);
  });

  it('keeps warning about everything it does not recognise', () => {
    // Unknown is not benign. A condition this helper has never seen must keep
    // the amber, or the next genuinely bad one arrives wearing grey.
    expect(conditionIsInformational('metadata quorum unavailable')).toBe(false);
    expect(conditionIsInformational('1 node offline')).toBe(false);
    expect(conditionIsInformational('')).toBe(false);
  });
});

describe('a node that accepts no inbound connections', () => {
  const node = (fields: Record<string, unknown>) => fields as unknown as ClusterNodeStatus;

  /**
   * The case this was originally got wrong, kept as the first test because it
   * is the only one that distinguishes the two plausible implementations.
   *
   * They are two planes, not two names for one. `api_endpoint` is the HTTP URL
   * a client dials; `inbound_capable` is whether peers can dial this node's
   * RPC plane. A node behind CGNAT refuses peer connections and still serves
   * its API to clients that can route to it. Measured on the deployed cluster
   * 2026-09-15, `corvus-fi-1` reports `inbound_capable: false` while
   * advertising `http://10.35.1.50:7438` — usable from inside that building,
   * dead from anywhere else. Deriving one from the other calls that node
   * inbound-capable, which is backwards, on the one node in the cluster the
   * label exists for.
   */
  it('does not mistake an advertised API endpoint for inbound peer capability', () => {
    expect(nodeInboundCapable(node({ inbound_capable: false, api_endpoint: 'http://10.35.1.50:7438' }))).toBe(false);
    expect(nodeInboundCapable(node({ inbound_capable: true, api_endpoint: 'https://macnessa.macha.network' }))).toBe(true);
  });

  /**
   * Unknown is not false. A node too old to report the field has not said it
   * refuses inbound connections, and printing that it does would be the client
   * inventing a fact — the same rule the roles and `mutable` handling follow.
   */
  it('says nothing for a node that did not report the field', () => {
    expect(nodeInboundCapable(node({ api_endpoint: 'https://node.example' }))).toBeUndefined();
    expect(nodeInboundCapable(node({ inbound_capable: 'false' }))).toBeUndefined();
    expect(nodeInboundCapable(node({ inbound_capable: null }))).toBeUndefined();
  });
});

describe('asynchronous node identity reset', () => {
  const oldNode = { id: 'old-id', host: '10.44.1.50', port: 57401 } as ClusterNodeStatus;
  const replacement = { id: 'replacement-id', host: '10.44.1.50', port: 57402 } as ClusterNodeStatus;
  const queued: IdentityAssociationResetResult = {
    reset: {
      scope: '[10.44.1.50]:57401', host: '10.44.1.50', port: 57401,
      stale_node_id: 'old-id', epoch: 2, reset_at_unix_ms: 1,
      reset_by_node_id: 'manager-id', reason: null,
    },
    audit_state: 'queued',
    metadata_persisted: false,
  };

  it('treats queued audit and non-persisted metadata as accepted work', () => {
    expect(identityResetAcceptanceMessage(queued)).toBe(
      'Identity association reset accepted for [10.44.1.50]:57401; metadata audit is queued.',
    );
    expect(identityResetAcceptanceMessage({ ...queued, audit_state: undefined, metadata_generation: 44 })).toContain('accepted');
  });

  it('removes only the retired node ID and preserves a same-host replacement identity', () => {
    const snapshot = { nodes: [oldNode, replacement] } as ClusterStatusSnapshot;
    expect(withoutRetiredNodeIdentity(snapshot, oldNode.id).nodes).toEqual([replacement]);
  });

  it('publishes quick acceptance before one prompt status refresh completes', async () => {
    let finishRefresh!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const resetNodeIdentityAssociation = vi.fn().mockResolvedValue(queued);
    const manageApi = { resetNodeIdentityAssociation } as unknown as ManageApi;
    let markAccepted!: () => void;
    const accepted = new Promise<void>((resolve) => { markAccepted = resolve; });
    const onAccepted = vi.fn(() => markAccepted());

    const workflow = acceptNodeIdentityAssociationReset(manageApi, oldNode, onAccepted, refresh);
    await accepted;

    expect(onAccepted).toHaveBeenCalledWith(queued);
    expect(refresh).toHaveBeenCalledOnce();
    expect(resetNodeIdentityAssociation).toHaveBeenCalledOnce();
    finishRefresh();
    await expect(workflow).resolves.toBe(queued);
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('telemetry age, coloured rather than merely printed', () => {
  const aged = (live_age_ms: number | null, telemetry_freshness = 'stale' as const) =>
    telemetryAge({ live_age_ms, telemetry_freshness });

  it('stays quiet until a reading is genuinely old, then escalates', () => {
    expect(aged(0)).toBeUndefined();
    expect(aged(TELEMETRY_AGEING_MS)).toBeUndefined();
    expect(aged(TELEMETRY_AGEING_MS + 1)).toBe('ageing');
    expect(aged(TELEMETRY_STALE_MS)).toBe('ageing');
    expect(aged(TELEMETRY_STALE_MS + 1)).toBe('stale');
  });

  it('never colours an absence, which would invent evidence rather than age it', () => {
    // A node never heard from is not an old reading. Both of these render an
    // em dash, and an em dash is not a warning.
    expect(aged(null)).toBeUndefined();
    expect(aged(Number.NaN)).toBeUndefined();
    expect(aged(600_000, 'unavailable' as never)).toBeUndefined();
  });
});

describe('machine memory reported separately from the node process footprint', () => {
  it('never answers with the process resident set, and says nothing rather than nothing-at-all', () => {
    // The whole reason this helper exists. `rss_bytes` is the only byte count
    // the server sent for most of this project's life, and it is the node's
    // own footprint — a few hundred MB on a machine with 64 GB. Rendering it
    // under "Memory" would be wrong by two orders of magnitude and look
    // entirely plausible.
    expect(systemMemoryBytes({ rss_bytes: 402_653_184 })).toBeUndefined();

    expect(systemMemoryBytes({ memory_total_bytes: 68_719_476_736, rss_bytes: 402_653_184 }))
      .toBe(68_719_476_736);

    // A node that cannot determine its own RAM reports nothing; the server
    // guards on nonzero for exactly this reason. Should one ever send a zero
    // anyway, "—" is the truth and "0 B" is a claim it has no memory.
    expect(systemMemoryBytes({ memory_total_bytes: 0 })).toBeUndefined();
    expect(systemMemoryBytes({})).toBeUndefined();
  });
});
