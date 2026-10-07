// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EndpointCandidate } from '@machafoundation/core';
import type { ClusterNodeStatus, ClusterStatusSnapshot } from '@machafoundation/core';
import type { IdentityAssociationResetResult, ManageApi } from '@machafoundation/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ClusterStatusApi } from '@machafoundation/core';
import { settle } from '../test/settle';
import { NodeStatusScreen, repairPaceText } from './StatusScreen';
import { acceptNodeIdentityAssociationReset, availableOfTotal, usedOfTotal, clientEndpointHealth, conditionStatedPerNode, identityResetAcceptanceMessage, nodeInboundCapable, nodeNotYetReady, nodeStatusLabel, StatusHeader, clusterTrafficText, statusNodeName, statusSectionVisibility, trafficClassLabel, trafficClassText, systemMemoryBytes, TELEMETRY_AGEING_MS, TELEMETRY_STALE_MS, telemetryAge, withoutRetiredNodeIdentity } from './StatusScreen';

function candidate(health: EndpointCandidate['health'], ready = true): EndpointCandidate {
  return {
    endpoint: { id: 'http://node', baseUrl: 'http://node', source: 'bootstrap' },
    health,
    ready,
    lapsed: false,
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
    // `retryAt` is on the registry's clock, which need not be `Date.now`; only `ready` decides.
    const cooling = candidate({ consecutiveFailures: 2, retryAt: Number.MAX_SAFE_INTEGER }, false);
    const eligible = candidate({ consecutiveFailures: 2, retryAt: Number.MAX_SAFE_INTEGER }, true);

    expect(clientEndpointHealth(cooling).label).toBe('Cooling down');
    expect(clientEndpointHealth(eligible).label).toBe('Retry eligible');
  });

  it('never calls a failing endpoint available, whatever it once managed', () => {
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
    // "unknown" is neither readiness nor evidence of unreadiness.
    expect(nodeNotYetReady(unknownPhase)).toBe(false);
    // An offline node is already labelled by state.
    expect(nodeNotYetReady(offlineRecovering)).toBe(false);

    expect(nodeStatusLabel(online)).toBe('online');
    expect(nodeStatusLabel(recovering)).toBe('online, recovering');
    expect(nodeStatusLabel(starting)).toBe('online, starting');
    expect(nodeStatusLabel(unknownPhase)).toBe('online');
  });
});

describe('cluster conditions the node pages already state', () => {
  // A node configured to accept no inbound connections is a normal, permanent topology, not a warning.
  it('drops the cluster-level count, which the node page states per node', () => {
    expect(conditionStatedPerNode('1 node accepts no inbound connections')).toBe(true);
    // The server counts them, so the count is not part of the match.
    expect(conditionStatedPerNode('2 nodes accept no inbound connections')).toBe(true);
  });

  it('shows everything it does not recognise, still as a warning', () => {
    // Unknown is not benign: an unrecognised condition keeps the amber.
    expect(conditionStatedPerNode('metadata quorum unavailable')).toBe(false);
    expect(conditionStatedPerNode('1 node offline')).toBe(false);
    expect(conditionStatedPerNode('')).toBe(false);
  });
});

describe('a node that accepts no inbound connections', () => {
  const node = (fields: Record<string, unknown>) => fields as unknown as ClusterNodeStatus;

  // `api_endpoint` is the HTTP URL clients dial; `inbound_capable` is whether peers can dial the
  // node's RPC plane. A node behind CGNAT can serve its API yet refuse peers, so neither derives
  // from the other.
  it('does not mistake an advertised API endpoint for inbound peer capability', () => {
    expect(nodeInboundCapable(node({ inbound_capable: false, api_endpoint: 'http://10.35.1.50:7438' }))).toBe(false);
    expect(nodeInboundCapable(node({ inbound_capable: true, api_endpoint: 'https://macnessa.macha.network' }))).toBe(true);
  });

  // Unknown is not false: a node too old to report the field has not said it refuses inbound connections.
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
    // A node never heard from is not an old reading.
    expect(aged(null)).toBeUndefined();
    expect(aged(Number.NaN)).toBeUndefined();
    expect(aged(600_000, 'unavailable' as never)).toBeUndefined();
  });
});

describe('machine memory reported separately from the node process footprint', () => {
  it('never answers with the process resident set, and says nothing rather than nothing-at-all', () => {
    // `rss_bytes` is the node process's footprint, not the machine's memory.
    expect(systemMemoryBytes({ rss_bytes: 402_653_184 })).toBeUndefined();

    expect(systemMemoryBytes({ memory_total_bytes: 68_719_476_736, rss_bytes: 402_653_184 }))
      .toBe(68_719_476_736);

    // A node that cannot determine its RAM reports nothing; a zero is treated the same.
    expect(systemMemoryBytes({ memory_total_bytes: 0 })).toBeUndefined();
    expect(systemMemoryBytes({})).toBeUndefined();
  });
});

describe('the storage and cache tiles (Tom, 2026-09-27)', () => {
  it('state what is used of the whole, then what is available of the whole', () => {
    const known = { capacity_bytes: 8 * 1024 ** 4, used_bytes: 2 * 1024 ** 4, free_bytes: 6 * 1024 ** 4 };
    const online = { capacity_bytes: 8 * 1024 ** 4, used_bytes: 2 * 1024 ** 4, free_bytes: 5 * 1024 ** 4 };
    expect(usedOfTotal(known)).toBe('2.00 TB / 8.00 TB');
    expect(availableOfTotal(online, known)).toBe('5.00 TB / 8.00 TB Available');
  });

});


describe('what a node card is called', () => {
  it("is the operator's name where the server sends one (server 0.70.0), else the host (Tom: show the names the server sends)", () => {
    expect(statusNodeName({ id: 'fi1-id-0123456789', host: 'corvus-fi-1', node_name: 'Corvus FI-1' } as ClusterNodeStatus)).toBe('Corvus FI-1');
    expect(statusNodeName({ id: 'fi1-id-0123456789', host: 'corvus-fi-1', node_name: null } as ClusterNodeStatus)).toBe('corvus-fi-1');
    expect(statusNodeName({ id: 'fi1-id-0123456789', host: 'corvus-fi-1', node_name: '  ' } as ClusterNodeStatus)).toBe('corvus-fi-1');
    expect(statusNodeName({ id: 'fi1-id-0123456789', host: '' } as ClusterNodeStatus)).toBe('fi1-id-01234');
  });
});

describe("a node's traffic to and from the other nodes (server 0.73.0)", () => {
  const traffic = {
    as_of_unix_ms: 1, window_ms: 6_000,
    classes: [
      { class: 'foreground', in_bytes: 0, out_bytes: 0, in_bytes_per_s: 1_048_576, out_bytes_per_s: 0 },
      { class: 'loader', in_bytes: 0, out_bytes: 0, in_bytes_per_s: 0, out_bytes_per_s: 3_145_728 },
      { class: 'control', in_bytes: 0, out_bytes: 0, in_bytes_per_s: 512, out_bytes_per_s: 512 },
    ],
  };

  it('adds up in and out across its classes, for the card', () => {
    expect(clusterTrafficText(traffic)).toBe('in 1.00 MB/s · out 3.00 MB/s');
  });

  it('says nothing it cannot measure: no report, or a first sample with no interval yet', () => {
    expect(clusterTrafficText(null)).toBeUndefined();
    expect(clusterTrafficText(undefined)).toBeUndefined();
    expect(clusterTrafficText({ ...traffic, window_ms: null })).toBeUndefined();
    expect(clusterTrafficText({ ...traffic, classes: [{ class: 'foreground', in_bytes: 0, out_bytes: 0, in_bytes_per_s: null, out_bytes_per_s: null }] })).toBeUndefined();
  });

  it('words each class, and shows one it does not know by its code', () => {
    expect(trafficClassLabel('foreground')).toBe('Playback');
    expect(trafficClassLabel('speculative')).toBe('Repair and sync');
    expect(trafficClassLabel('replication_v2')).toBe('replication_v2');
    expect(trafficClassText(traffic.classes[1])).toBe('in 0 B/s · out 3.00 MB/s');
  });
});

describe('repair pace, as each node states its own', () => {
  it('says what repair is giving way to, and shows a code it does not know as it came', () => {
    expect(repairPaceText({ pace: 'paced', paced_by: ['viewer', 'peer_viewer', 'loader'] })).toBe('Paced for viewers here, a viewer on another node, loading');
    expect(repairPaceText({ pace: 'paced', paced_by: ['playback', 'peer_playback'] })).toBe('Paced for playback here, playback on another node');
    expect(repairPaceText({ pace: 'paced', paced_by: ['mounted_filesystem', 'loader', 'ingest_v2'] })).toBe('Paced for a mounted filesystem, loading, ingest_v2');
    expect(repairPaceText({ pace: 'paced', paced_by: [] })).toBe('Paced');
    expect(repairPaceText({ pace: 'running', paced_by: [] })).toBe('Running');
    expect(repairPaceText({ pace: 'awaiting_credit' })).toBe('Waiting for transfer credit');
    expect(repairPaceText({ pace: 'unknown' })).toBe('Not yet run');
    expect(repairPaceText({ pace: 'draining' })).toBe('draining');
  });

  it('says nothing for a node that stated no pace, an older server among them', () => {
    expect(repairPaceText(undefined)).toBeUndefined();
    expect(repairPaceText({})).toBeUndefined();
  });

  it('asks the node itself for its pace on the node page, not whichever node answered the listing', async () => {
    const node = {
      id: 'node-a', state: 'online', roles: [], version: '0.87.0', host: '', port: 0,
      runtime: {}, storage: { used_bytes: 0, capacity_bytes: 0 }, cache: { used_bytes: 0, capacity_bytes: 0 },
    } as unknown as ClusterNodeStatus;
    const api = {
      node: vi.fn(async () => node),
      statusOf: vi.fn(async () => ({ diagnostics: { repair: { pace: 'paced', paced_by: ['loader'] } } }) as unknown as ClusterStatusSnapshot),
      checkConnectivity: vi.fn(),
    } as unknown as ClusterStatusApi;
    render(
      <MemoryRouter initialEntries={['/status/node-a']}>
        <Routes><Route path="/status/:nodeId" element={<NodeStatusScreen api={api} />} /></Routes>
      </MemoryRouter>,
    );
    await settle();
    await settle();
    expect(api.statusOf).toHaveBeenCalledWith('node-a');
    expect(screen.getByText('Repair').nextSibling?.textContent).toBe('Paced for loading');
  });
});

describe('a node this page may not reach', () => {
  it('says an http node is blocked from an https page, ahead of any health it has', () => {
    const blocked: EndpointCandidate = { ...candidate({ consecutiveFailures: 0, lastSuccessAt: 1 } as EndpointCandidate['health']), blockedByHost: 'insecure_from_secure_page' };
    expect(clientEndpointHealth(blocked).label).toBe('Blocked: http from an https page');
  });
});
