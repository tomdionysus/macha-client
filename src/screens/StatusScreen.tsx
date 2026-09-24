import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MetricTile } from '../components/MetricTile';
import { Link, useParams } from 'react-router-dom';
import type { Platform } from '@machafoundation/core';
import { DeviceCapabilities } from '../components/DeviceCapabilities';
import type {
  ClusterNodeStatus,
  ClusterStatusApi,
  ClusterStatusSnapshot,
  ConnectivityCheck,
  NodeRuntimeStatus,
  PublicConnectivityStatus,
} from '@machafoundation/core';
import { startupReadyCount, startupSubsystems } from '@machafoundation/core';
import { startupPhaseLabel, startupSubsystemLabel, viewerErrorText } from '../text/viewerText';
import type { IdentityAssociationResetResult, ManageApi } from '@machafoundation/core';
import { routes } from '@machafoundation/core';
import { usePollingTask } from '../hooks/usePollingTask';
import { EndpointRegistry, type EndpointCandidate } from '@machafoundation/core';
import { ConfirmModal } from '../components/Modal';
import { AsyncIconButton } from '../components/AsyncIconButton';
import { RefreshIcon } from '../components/ManageIcons';
import { probeKnownEndpoints } from '@machafoundation/core';
import type { AuthenticatedFetch } from '@machafoundation/core';
import { reportClusterReachable, reportClusterUnreachable } from '@machafoundation/core';
import { presentedTime, presentedTimeOfDay } from '../diagnostics/timestamps';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit + 1 < units.length) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
}

function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Physical RAM on the machine, distinct from `runtime.rss_bytes`, which is the
 * node process's own resident set and answers a different question entirely —
 * a few hundred MB on a 64 GB box.
 *
 * Absent from every node until the server reports it, and absent from older
 * nodes forever, which is the honest answer and renders as an em dash. Zero is
 * treated the same way: a node that cannot determine its own RAM should say
 * nothing rather than claim it has none.
 */
export function systemMemoryBytes(runtime: NodeRuntimeStatus): number | undefined {
  const reported = runtime.memory_total_bytes;
  return reported != null && Number.isFinite(reported) && reported > 0 ? reported : undefined;
}

function percentage(used: number, capacity: number): string {
  if (!capacity) return '0%';
  return `${Math.min(100, Math.max(0, used / capacity * 100)).toFixed(0)}%`;
}

function nodeName(node: ClusterNodeStatus): string {
  return node.host || node.id.slice(0, 12);
}

/**
 * When telemetry stopped being current, as a severity rather than a number.
 *
 * The figures beside it are honest measurements of the sending process — just
 * old — so a screenful of entirely plausible numbers can be half an hour out
 * of date with nothing on the page saying so. Colour is what makes the age
 * impossible to read past; the number alone was there before and was missed.
 *
 * No severity without an age, and none for `unavailable`. A node that has
 * never been heard from is not an old reading, and colouring an absence would
 * invent evidence where the honest answer is an em dash.
 */
export const TELEMETRY_AGEING_MS = 60_000;
export const TELEMETRY_STALE_MS = 300_000;

export type TelemetryAge = 'ageing' | 'stale';

export function telemetryAge(
  node: Pick<ClusterNodeStatus, 'live_age_ms' | 'telemetry_freshness'>,
): TelemetryAge | undefined {
  if (node.telemetry_freshness === 'unavailable') return undefined;
  const ageMs = node.live_age_ms;
  if (ageMs == null || !Number.isFinite(ageMs)) return undefined;
  if (ageMs > TELEMETRY_STALE_MS) return 'stale';
  if (ageMs > TELEMETRY_AGEING_MS) return 'ageing';
  return undefined;
}

function telemetryAgeClassName(node: ClusterNodeStatus): string | undefined {
  const age = telemetryAge(node);
  return age ? `telemetry-age ${age}` : undefined;
}

/**
 * Whether a node accepts inbound connections, as the node itself reports it.
 *
 * Read straight off `inbound_capable`, which is the field the cluster's own
 * `nodes_inbound_incapable` counter counts — so the node detail and the
 * cluster condition cannot disagree about which nodes they mean.
 *
 * **This is the cluster plane, not the API plane, and they are not the same
 * endpoint.** `api_endpoint` is the HTTP URL a *client* dials; inbound
 * capability is whether *peers* can dial this node's RPC plane. A node behind
 * CGNAT accepts no peer connections and still serves its HTTP API normally to
 * clients that can route to it. Measured on this cluster 2026-09-15,
 * `corvus-fi-1` reports `inbound_capable: false` while advertising
 * `http://10.35.1.50:7438` — a LAN address a browser in that building uses
 * happily and that is dead from anywhere else.
 *
 * So this says nothing about whether the client can reach the node, nothing
 * about discovery, and nothing about the failover pool: fi-1 is a discovered
 * endpoint and an eligible failover target for a client on its network. Both
 * errors were made here first — deriving the flag from `api_endpoint`, then
 * explaining the failover pool with the flag — and each one was wrong about
 * the single node in this cluster the label exists for.
 *
 * Tri-state on purpose. `undefined` is a node that did not say — a build older
 * than the field — and the screen says nothing rather than claiming a node
 * takes inbound connections it never mentioned. Unknown is not false.
 *
 * `inbound_capable` is not in core's `ClusterNodeStatus` yet; core owns the
 * wire model and this narrowing goes when it declares the field.
 */
export function nodeInboundCapable(node: ClusterNodeStatus): boolean | undefined {
  const reported = (node as ClusterNodeStatus & { inbound_capable?: unknown }).inbound_capable;
  return typeof reported === 'boolean' ? reported : undefined;
}

function freshnessLabel(node: ClusterNodeStatus): string {
  if (node.telemetry_freshness === 'live') return 'Live';
  if (node.telemetry_freshness === 'stale') return `Stale · ${formatDuration(node.live_age_ms)}`;
  if (!node.observed_at_unix_ms) return 'Last known';
  return `Last known · ${presentedTime(node.observed_at_unix_ms)}`;
}

// A node can be `state: 'online'` (connected and gossiping) while
// `phase: 'recovering'|'starting'` (not actually ready to serve). Surface that
// distinctly rather than collapsing it into a plain "online" label.
export function nodeNotYetReady(node: ClusterNodeStatus): boolean {
  return node.state === 'online' && (node.phase === 'recovering' || node.phase === 'starting');
}

export function nodeStatusLabel(node: ClusterNodeStatus): string {
  return nodeNotYetReady(node) ? `online, ${node.phase}` : node.state;
}

function nodeStatusClassName(node: ClusterNodeStatus): string {
  return nodeNotYetReady(node) ? `${node.state} ${node.phase}` : node.state;
}

/**
 * Conditions the node pages already state, per node, and better.
 *
 * `conditions` is free prose with no severity on the wire and the panel paints
 * every entry amber, so "1 node accepts no inbound connections" — a permanent,
 * intended topology — read as a fault at the top of Status on every visit. A
 * panel that cries wolf about a standing state teaches the reader to skip the
 * row that will one day carry something real.
 *
 * Styling it neutrally was the first attempt and was not enough: the line is
 * still the first thing on the screen, and it still says nothing actionable.
 * It is dropped now rather than recoloured because the fact is not lost — the
 * node's own page carries `Inbound RPC connections`, attributed to the node it
 * is about, which is more than the cluster-level count ever said.
 *
 * Matched on the stable half of the sentence, because the server counts the
 * nodes: "1 node accepts no inbound connections", "2 nodes accept…". Prose is
 * a poor thing to match on and a severity stated on the wire would be the
 * durable fix; until then the choice is between matching the sentence and
 * showing a permanent false alarm.
 *
 * Anything unrecognised is still shown, and still amber. Unknown is not benign.
 */
const CONDITIONS_STATED_PER_NODE: readonly RegExp[] = [/\bno inbound connections\b/i];

export function conditionStatedPerNode(condition: string): boolean {
  return CONDITIONS_STATED_PER_NODE.some((pattern) => pattern.test(condition));
}

function UsageBar({ used, capacity }: { used: number; capacity: number }) {
  const width = capacity ? Math.min(100, Math.max(0, used / capacity * 100)) : 0;
  return <div className="cluster-usage-bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>;
}

export function StatusHeader({ eyebrow, title = 'Status', health, refreshing, onRefresh }: {
  eyebrow: string;
  title?: string;
  health?: { className: string; label: string };
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return <header className="cluster-status-heading">
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {health && <div className={`cluster-health ${health.className}`}><span />{health.label}</div>}
    </div>
    <AsyncIconButton label="Refresh status" busy={refreshing} onClick={onRefresh} icon={<RefreshIcon />} />
  </header>;
}

/**
 * Whether a failing endpoint is still cooling down is the registry's question
 * to answer, not this screen's.
 *
 * It used to be decided here, by comparing `health.retryAt` against
 * `Date.now()` — which only held because `retryAt` happens to be stamped with a
 * wall clock. `EndpointRegistry` takes its clock as a constructor argument, so
 * that is a property of how it was constructed, not of what `retryAt` means: a
 * host that supplies a duration clock (an arbitrary origin restarting near zero
 * each load) puts the two on unrelated number lines. That would not throw and
 * would not look wrong. It would label cooling nodes retry-eligible and back,
 * plausibly, on the one screen someone reads when working out why a node is
 * misbehaving.
 *
 * `ready` is computed inside the registry against whatever clock it actually
 * holds, so there is nothing left to get wrong here, and nothing for this file
 * to know about how the registry measures time.
 */
export function clientEndpointHealth(candidate: EndpointCandidate): { className: string; label: string } {
  const { health, ready } = candidate;
  if (health.consecutiveFailures > 0) {
    return ready
      ? { className: 'degraded', label: 'Retry eligible' }
      : { className: 'cooling', label: 'Cooling down' };
  }
  return health.lastSuccessAt
    ? { className: 'available', label: 'Available' }
    : { className: 'untried', label: 'Not tried' };
}

export type StatusSection = 'overview' | 'client' | 'connectivity';

export function statusSectionVisibility(section: StatusSection) {
  return {
    overview: section === 'overview',
    client: section === 'client',
    connectivity: section === 'connectivity',
  };
}

function timestamp(value?: number): string {
  return presentedTime(value);
}

function ClientApiEndpoints({ registry }: { registry: EndpointRegistry }) {
  const [endpoints, setEndpoints] = useState(() => registry.snapshot());

  useEffect(() => {
    setEndpoints(registry.snapshot());
    return registry.subscribe(() => setEndpoints(registry.snapshot()));
  }, [registry]);

  return <>
    <div className="cluster-nodes-heading client-endpoints-heading">
      <h2>Client API endpoints</h2>
      <span>Local API checks and request evidence · {endpoints.length} known</span>
    </div>
    {endpoints.length === 0
      ? <div className="manage-empty">No client API endpoints are configured.</div>
      : <div className="client-endpoint-grid">{endpoints.map((candidate) => {
        const state = clientEndpointHealth(candidate);
        const { endpoint, health } = candidate;
        return <article className="node-detail-card client-endpoint-card" key={endpoint.id}>
          <div className="cluster-node-heading">
            <div><strong>{endpoint.nodeId ?? 'Unidentified node'}</strong><code>{endpoint.baseUrl || 'same origin'}</code></div>
            <span className={`cluster-state-pill ${state.className}`}>{state.label}</span>
          </div>
          <dl>
            <DetailItem label="Source">{endpoint.source}</DetailItem>
            <DetailItem label="Failures">{health.consecutiveFailures}</DetailItem>
            <DetailItem label="Last success">{timestamp(health.lastSuccessAt)}</DetailItem>
            <DetailItem label="Last failure">{timestamp(health.lastFailureAt)}</DetailItem>
            {/* No "Retry in" countdown. It was derived from `retryAt` and had
                the same clock problem the pill above just shed, and the seconds
                were never actionable anyway — "cooling down" against "retry
                eligible" is the whole of what a reader can use. */}
          </dl>
        </article>;
      })}</div>}
  </>;
}

function endpointLabel(endpoint?: { host: string; port: number }): string {
  if (!endpoint?.host || !endpoint.port) return '—';
  return `${endpoint.host}:${endpoint.port}`;
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function probeLabel(connectivity: PublicConnectivityStatus): string {
  const probe = connectivity.check.self_probe?.trim();
  if (!connectivity.check.checked_at_unix_ms || !probe) return 'Not checked';
  return probe.charAt(0).toUpperCase() + probe.slice(1);
}

function PublicConnectivity({ connectivity }: { connectivity: PublicConnectivityStatus }) {
  const upnp = connectivity.upnp;
  const external = upnp.external_address && upnp.external_port
    ? `${upnp.external_address}:${upnp.external_port}`
    : upnp.external_address ?? '—';
  const internal = upnp.lan_address && upnp.internal_port
    ? `${upnp.lan_address}:${upnp.internal_port}`
    : upnp.lan_address ?? '—';
  const source = connectivity.advertised.source || 'configured';

  return (
    <>
      <div className="cluster-nodes-heading cluster-connectivity-heading"><h2>Public connectivity</h2><span>Advertised via {source}</span></div>
      <div className="cluster-connectivity-grid">
        <article className="node-detail-card"><h2>Advertised endpoint</h2><dl>
          <DetailItem label="Effective"><code>{endpointLabel(connectivity.advertised)}</code></DetailItem>
          <DetailItem label="Configured"><code>{endpointLabel(connectivity.configured)}</code></DetailItem>
          <DetailItem label="Source">{source}</DetailItem>
          <DetailItem label="Self probe">{probeLabel(connectivity)}</DetailItem>
          <DetailItem label="Externally verified">{yesNo(connectivity.check.externally_verified)}</DetailItem>
          {connectivity.check.checked_at_unix_ms > 0 && <DetailItem label="Checked">{presentedTime(connectivity.check.checked_at_unix_ms)}</DetailItem>}
          {connectivity.check.error && <DetailItem label="Probe error"><span className="cluster-connectivity-error">{connectivity.check.error}</span></DetailItem>}
        </dl></article>

        <article className="node-detail-card"><h2>UPnP</h2><dl>
          <DetailItem label="Enabled">{yesNo(upnp.enabled)}</DetailItem>
          <DetailItem label="Support built">{yesNo(upnp.support_built)}</DetailItem>
          <DetailItem label="Gateway">{upnp.gateway_found ? 'Found' : 'Not found'}</DetailItem>
          <DetailItem label="Mapping">{upnp.mapping_active ? 'Active' : 'Inactive'}</DetailItem>
          <DetailItem label="External"><code>{external}</code></DetailItem>
          <DetailItem label="Internal"><code>{internal}</code></DetailItem>
          <DetailItem label="CGNAT / private WAN">{yesNo(upnp.private_wan)}</DetailItem>
          <DetailItem label="Mapping owned">{yesNo(upnp.mapping_owned)}</DetailItem>
          <DetailItem label="Lease">{upnp.lease_seconds ? `${upnp.lease_seconds}s` : 'Permanent / router default'}</DetailItem>
          {upnp.error && <DetailItem label="UPnP error"><span className="cluster-connectivity-error">{upnp.error}</span></DetailItem>}
        </dl></article>

        {(connectivity.external_ip.enabled || connectivity.external_ip.attempted) && <article className="node-detail-card"><h2>External IP fallback</h2><dl>
          <DetailItem label="Enabled">{yesNo(connectivity.external_ip.enabled)}</DetailItem>
          <DetailItem label="Attempted">{yesNo(connectivity.external_ip.attempted)}</DetailItem>
          <DetailItem label="Address"><code>{connectivity.external_ip.address ?? '—'}</code></DetailItem>
          {connectivity.external_ip.error && <DetailItem label="Lookup error"><span className="cluster-connectivity-error">{connectivity.external_ip.error}</span></DetailItem>}
        </dl></article>}
      </div>
    </>
  );
}

function NodeCard({ node, canManage, resetting, onReset }: { node: ClusterNodeStatus; canManage: boolean; resetting: boolean; onReset: (node: ClusterNodeStatus) => void }) {
  const canReset = canManage && Boolean(node.host && node.port);
  const memory = systemMemoryBytes(node.runtime);
  return (
    <article className={`cluster-node-card ${nodeStatusClassName(node)}`}>
      <Link className="cluster-node-card-link" to={routes.statusNode(node.id)} data-tv-focusable="true">
        <div className="cluster-node-heading">
          <div><strong>{nodeName(node)}</strong><code>{node.id.slice(0, 12)}</code></div>
          <span className={`cluster-state-pill ${nodeStatusClassName(node)}`}>{nodeStatusLabel(node)}</span>
        </div>
        {/* Version belongs on the card, not only on the node's own page. This
            cluster is deliberately not uniform and drifts apart in practice —
            gbni-2 sat on 0.38.1 while the others moved to 0.38.4 — and "which
            node is behind" is the first question when one of them behaves
            differently from the rest. Having to open each node in turn to
            compare a version is how that goes unnoticed. */}
        <div className="cluster-node-meta">
          <span>{node.roles.length ? node.roles.join(' · ') : 'node'}</span>
          <span className="cluster-node-version">{node.version || '—'}</span>
          <span className={telemetryAgeClassName(node)}>{freshnessLabel(node)}</span>
        </div>
        <dl className="cluster-node-stats">
          <div><dt>Storage</dt><dd>{formatBytes(node.storage.used_bytes)} / {formatBytes(node.storage.capacity_bytes)}</dd></div>
          <div><dt>Cache</dt><dd>{node.cache.capacity_bytes ? `${formatBytes(node.cache.used_bytes)} / ${formatBytes(node.cache.capacity_bytes)}` : '—'}</dd></div>
          <div><dt>Load</dt><dd>{node.runtime.load1 != null ? node.runtime.load1.toFixed(2) : '—'}</dd></div>
          {/* Cores sits beside Load deliberately: load1 is a per-core queue
              depth, so the two are only readable together across a cluster of
              non-uniform machines. Memory is the machine's RAM, not the
              node's footprint — see systemMemoryBytes. */}
          <div><dt>Cores</dt><dd>{node.runtime.cpu_cores ?? '—'}</dd></div>
          <div><dt>Memory</dt><dd>{memory != null ? formatBytes(memory) : '—'}</dd></div>
          <div><dt>Peers</dt><dd>{node.runtime.peers_active != null ? `${node.runtime.peers_active}/${node.runtime.peers_known ?? node.runtime.peers_active}` : '—'}</dd></div>
        </dl>
      </Link>
      {canManage && <div className="cluster-node-actions">
        <button className="secondary-button manage-danger" type="button" disabled={!canReset || resetting} onClick={() => onReset(node)} data-tv-focusable="true">
          {resetting ? 'Resetting…' : 'Reset association'}
        </button>
      </div>}
    </article>
  );
}

export function withoutRetiredNodeIdentity(snapshot: ClusterStatusSnapshot, retiredNodeId: string): ClusterStatusSnapshot {
  return { ...snapshot, nodes: snapshot.nodes.filter((node) => node.id !== retiredNodeId) };
}

export function identityResetAcceptanceMessage(result: IdentityAssociationResetResult): string {
  const auditState = result.audit_state ?? result.reset.audit_state;
  return auditState === 'queued'
    ? `Identity association reset accepted for ${result.reset.scope}; metadata audit is queued.`
    : `Identity association reset accepted for ${result.reset.scope} at epoch ${result.reset.epoch}.`;
}

export async function acceptNodeIdentityAssociationReset(
  manageApi: ManageApi,
  node: ClusterNodeStatus,
  onAccepted: (result: IdentityAssociationResetResult) => void,
  refreshOnce: () => Promise<void>,
): Promise<IdentityAssociationResetResult> {
  const result = await manageApi.resetNodeIdentityAssociation(node.id, node.host, node.port, 'Reset from Status node card');
  onAccepted(result);
  await refreshOnce();
  return result;
}

export function StatusScreen({ api, endpointRegistry, manageApi, platform, section, auth }: {
  api: ClusterStatusApi;
  endpointRegistry: EndpointRegistry;
  manageApi?: ManageApi;
  platform: Platform;
  section: StatusSection;
  auth: AuthenticatedFetch;
}) {
  const [snapshot, setSnapshot] = useState<ClusterStatusSnapshot>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [check, setCheck] = useState<ConnectivityCheck>();
  const [resettingNodeId, setResettingNodeId] = useState<string>();
  const [resetCandidate, setResetCandidate] = useState<ClusterNodeStatus>();
  const [managementMessage, setManagementMessage] = useState<string>();
  const retiredNodeIds = useRef(new Set<string>());

  const omitRetiredNodes = useCallback((value: ClusterStatusSnapshot) => {
    let operational = value;
    for (const nodeId of retiredNodeIds.current) operational = withoutRetiredNodeIdentity(operational, nodeId);
    return operational;
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(omitRetiredNodes(await api.status()));
      setError(undefined);
    } catch (cause) {
      setError(viewerErrorText(cause));
    }
  }, [api, omitRetiredNodes]);

  usePollingTask({
    load: () => api.status(),
    onValue: (value) => { setSnapshot(omitRetiredNodes(value)); setError(undefined); },
    onError: (cause) => setError(viewerErrorText(cause)),
    intervalMs: 5000,
    dependencies: [api, omitRetiredNodes],
    allowOverlap: true,
    enabled: section !== 'client',
  });

  const refreshPage = useCallback(async () => {
    setRefreshing(true);
    try {
      if (section === 'client') {
        const controller = new AbortController();
        const reachable = await probeKnownEndpoints(endpointRegistry, auth, controller.signal);
        if (endpointRegistry.snapshot().length > 0) {
          if (reachable > 0) reportClusterReachable(); else reportClusterUnreachable();
        }
      } else if (section === 'connectivity') {
        setCheck(await api.checkConnectivity());
        await refresh();
      } else {
        await refresh();
      }
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setRefreshing(false);
    }
  }, [api, auth, endpointRegistry, refresh, section]);

  const resetIdentityAssociation = useCallback(async (node: ClusterNodeStatus) => {
    if (!manageApi || !node.host || !node.port) return;
    setResettingNodeId(node.id);
    setManagementMessage(undefined);
    setError(undefined);
    try {
      await acceptNodeIdentityAssociationReset(manageApi, node, (result) => {
        retiredNodeIds.current.add(node.id);
        setSnapshot((current) => current ? withoutRetiredNodeIdentity(current, node.id) : current);
        setManagementMessage(identityResetAcceptanceMessage(result));
        setResetCandidate(undefined);
      }, refresh);
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setResettingNodeId(undefined);
    }
  }, [manageApi, refresh]);

  if (section === 'client') return <section className="cluster-status-screen">
    <StatusHeader eyebrow="This device" refreshing={refreshing} onRefresh={() => void refreshPage()} />
    <div className="settings-status-grid" aria-label="Playback support">
      <DeviceCapabilities platform={platform} />
    </div>
    <ClientApiEndpoints registry={endpointRegistry} />
  </section>;
  if (!snapshot && !error) return <section className="cluster-status-screen">
    <StatusHeader eyebrow="Macha cluster" title="Loading status…" refreshing={refreshing} onRefresh={() => void refreshPage()} />
  </section>;
  if (!snapshot) return <section className="cluster-status-screen error-status">
    <StatusHeader eyebrow="Macha cluster" refreshing={refreshing} onRefresh={() => void refreshPage()} />
    <p>Server status unavailable: {error}</p>
  </section>;

  const cluster = snapshot.cluster;
  const clusterConditions = cluster.conditions.filter((condition) => !conditionStatedPerNode(condition));
  const reachable = check?.results.filter((result) => result.reachable).length;
  const visible = statusSectionVisibility(section);
  return (
    <section className="cluster-status-screen">
      <StatusHeader eyebrow="Macha cluster" health={{ className: cluster.health, label: cluster.health }} refreshing={refreshing} onRefresh={() => void refreshPage()} />

      {error && <p className="manage-error">Live refresh failed: {error}. Showing the most recent status.</p>}
      {visible.overview && <>
      {snapshot.startup && snapshot.startup.phase !== 'ready' && <section className={`cluster-startup-panel ${snapshot.startup.phase}`}>
        <div className="cluster-startup-heading">
          <div><span>Local node startup</span><strong>{startupPhaseLabel(snapshot.startup)}</strong></div>
          <small>{startupReadyCount(snapshot.startup)}/8 planes ready</small>
        </div>
        <div className="cluster-startup-grid">
          {startupSubsystems(snapshot.startup).map((subsystem) => <div key={subsystem.key}>
            <span>{startupSubsystemLabel(subsystem.key)}</span><strong className={`cluster-startup-state ${subsystem.state}`}>{subsystem.state}</strong>
          </div>)}
        </div>
        {snapshot.startup.error && <p className="cluster-startup-error">{snapshot.startup.error}</p>}
      </section>}
      {clusterConditions.length > 0 && <div className="cluster-conditions">
        {clusterConditions.map((condition) => <span key={condition}>{condition}</span>)}
      </div>}
      <div className="metric-grid">
        <MetricTile label="Nodes" value={`${cluster.nodes_online} / ${cluster.nodes_known}`} detail="online" />
        <MetricTile label="Metadata" value={cluster.metadata_availability === 'writable' ? 'Writable' : cluster.metadata_availability === 'read-only' ? 'Read-only' : 'Unavailable'} detail={`${cluster.metadata_voters_online}/${cluster.metadata_voters} voters · ${cluster.metadata_quorum_required} required`} />
        <MetricTile label="Durable storage" value={`${formatBytes(cluster.storage_online.capacity_bytes)} / ${formatBytes(cluster.storage_known.capacity_bytes)}`} detail={`${formatBytes(cluster.storage_known.used_bytes)} known used`} />
        <MetricTile label="Cache" value={cluster.cache_known.capacity_bytes ? `${formatBytes(cluster.cache_online.capacity_bytes)} / ${formatBytes(cluster.cache_known.capacity_bytes)}` : 'None'} detail={cluster.cache_known.capacity_bytes ? `${formatBytes(cluster.cache_known.used_bytes)} known used` : undefined} />
      </div>

      <div className="cluster-capacity-grid">
        <article className="cluster-capacity-card">
          <div><span>Known durable usage</span><strong>{formatBytes(cluster.storage_known.used_bytes)} / {formatBytes(cluster.storage_known.capacity_bytes)} · {percentage(cluster.storage_known.used_bytes, cluster.storage_known.capacity_bytes)}</strong></div>
          <UsageBar used={cluster.storage_known.used_bytes} capacity={cluster.storage_known.capacity_bytes} />
          {cluster.storage_online.capacity_bytes < cluster.storage_known.capacity_bytes && <small>{formatBytes(cluster.storage_online.capacity_bytes)} currently online</small>}
        </article>
        {cluster.cache_known.capacity_bytes > 0 && <article className="cluster-capacity-card">
          <div><span>Cache usage</span><strong>{formatBytes(cluster.cache_known.used_bytes)} / {formatBytes(cluster.cache_known.capacity_bytes)} · {percentage(cluster.cache_known.used_bytes, cluster.cache_known.capacity_bytes)}</strong></div>
          <UsageBar used={cluster.cache_known.used_bytes} capacity={cluster.cache_known.capacity_bytes} />
        </article>}
      </div>

      {managementMessage && <p className="cluster-check-result reachable">{managementMessage}</p>}
      <div className="cluster-nodes-heading"><h2>Nodes</h2><span>Metadata generation {cluster.metadata_generation}</span></div>
      <div className="cluster-node-grid">{snapshot.nodes.map((node) => <NodeCard key={node.id} node={node} canManage={Boolean(manageApi)} resetting={resettingNodeId === node.id} onReset={setResetCandidate} />)}</div>
      </>}

      {visible.connectivity && <>
        {check && <p className="cluster-check-result">Connectivity: {reachable}/{check.results.length} nodes reachable · checked {presentedTimeOfDay(check.checked_at_unix_ms)}</p>}
        {snapshot.connectivity
          ? <PublicConnectivity connectivity={snapshot.connectivity} />
          : <div className="manage-empty">Connectivity status is not available from this node.</div>}
      </>}
      <ConfirmModal
        open={Boolean(resetCandidate)}
        title="Reset identity association?"
        confirmLabel="Reset association"
        destructive
        busy={Boolean(resettingNodeId)}
        onCancel={() => setResetCandidate(undefined)}
        onConfirm={() => { if (resetCandidate) void resetIdentityAssociation(resetCandidate); }}
      >
        <p>Reset the cluster-wide association <code>{resetCandidate?.host}:{resetCandidate?.port}</code> → <code>{resetCandidate?.id}</code>?</p>
        <p>This removes the stale association from membership and RPC routing. It does not delete node state or MachaDFS data.</p>
      </ConfirmModal>
    </section>
  );
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function NodeStatusScreen({ api }: { api: ClusterStatusApi }) {
  const { nodeId } = useParams<{ nodeId: string }>();
  const [node, setNode] = useState<ClusterNodeStatus>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [check, setCheck] = useState<ConnectivityCheck>();

  const refresh = useCallback(async () => {
    if (!nodeId) return;
    try {
      setNode(await api.node(nodeId));
      setError(undefined);
    } catch (cause) {
      setError(viewerErrorText(cause));
    }
  }, [api, nodeId]);

  const refreshPage = useCallback(async () => {
    if (!nodeId) return;
    setRefreshing(true);
    try {
      setCheck(await api.checkConnectivity(nodeId));
      await refresh();
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setRefreshing(false);
    }
  }, [api, nodeId, refresh]);

  usePollingTask({
    load: () => api.node(nodeId!),
    onValue: (value) => { setNode(value); setError(undefined); },
    onError: (cause) => setError(viewerErrorText(cause)),
    intervalMs: 5000,
    dependencies: [api, nodeId],
    allowOverlap: true,
    enabled: Boolean(nodeId),
  });

  if (!node && !error) return <section className="cluster-status-screen node-status-screen"><StatusHeader eyebrow="Cluster node" title="Loading node status…" refreshing={refreshing} onRefresh={() => void refreshPage()} /></section>;
  if (!node) return <section className="cluster-status-screen node-status-screen error-status"><StatusHeader eyebrow="Cluster node" title="Node unavailable" refreshing={refreshing} onRefresh={() => void refreshPage()} /><p>{error}</p><Link to={routes.status}>← Overview</Link></section>;

  const runtime = node.runtime;
  const memory = systemMemoryBytes(runtime);
  const connectivity = check?.results[0];
  const inboundCapable = nodeInboundCapable(node);
  return (
    <section className="cluster-status-screen node-status-screen">
      <Link className="back-button" to={routes.status} data-tv-focusable="true">← Overview</Link>
      <StatusHeader eyebrow="Cluster node" title={nodeName(node)} health={{ className: nodeNotYetReady(node) ? 'recovering' : node.state === 'online' ? 'healthy' : node.state === 'retired' ? 'degraded' : 'critical', label: nodeStatusLabel(node) }} refreshing={refreshing} onRefresh={() => void refreshPage()} />
      {error && <p className="manage-error">Live refresh failed: {error}</p>}
      {connectivity && <p className={`cluster-check-result ${connectivity.reachable ? 'reachable' : 'unreachable'}`}>Connectivity: {connectivity.reachable ? 'reachable' : 'unreachable'}{connectivity.error ? ` · ${connectivity.error}` : ''}</p>}

      <div className="node-detail-grid">
        <article className="node-detail-card"><h2>Overview</h2><dl>
          <DetailItem label="Node ID"><code>{node.id}</code></DetailItem>
          <DetailItem label="Version">{node.version || '—'}</DetailItem>
          {/* The URL a client actually dials. Until server 0.36.4 this line
              showed `host:port`, which is the node's internal RPC bind address
              — one port away from the API on this cluster (7437 against 7438),
              close enough to look right and wrong enough to send an operator
              somewhere with nothing listening. Both are shown now, each under
              its own name, because the RPC pair is still what an identity
              reset is keyed on and an operator reading this card may need it. */}
          {/* "—" read as "this screen has nothing to tell you". An absent
              endpoint is not an absent reading: it is the node saying it has
              no HTTP API for a client to dial, which is why core's discovery
              leaves it out of the client's endpoint registry.
              Deliberately independent of inbound peer capability below — a
              node can advertise a perfectly good API endpoint and still accept
              no peer connections, which is exactly what fi-1 does. */}
          <DetailItem label="API endpoint">{node.api_endpoint?.includes('://') ? node.api_endpoint : 'None advertised'}</DetailItem>
          <DetailItem label="RPC address">{node.host ? `${node.host}:${node.port}` : '—'}</DetailItem>
          {/* Its own line, directly under the RPC address it is about, because
              it is a standing property of the node rather than a qualifier on
              something else. A plain Yes/No states it without implying a
              verdict: a No here is a normal topology, not a fault, and it says
              nothing about whether a client can reach this node's API — that
              is the line above, on the other plane. An em dash is a node that
              did not report the field, which is not the same as a No. */}
          <DetailItem label="Inbound RPC connections">
            {inboundCapable === undefined ? '—' : yesNo(inboundCapable)}
          </DetailItem>
          <DetailItem label="Failure domain">{node.failure_domain || '—'}</DetailItem>
          <DetailItem label="Roles">{node.roles.join(', ') || '—'}</DetailItem>
          <DetailItem label="Telemetry"><span className={telemetryAgeClassName(node)}>{freshnessLabel(node)}</span></DetailItem>
          <DetailItem label="Uptime">{runtime.uptime_ms != null ? formatDuration(runtime.uptime_ms) : '—'}</DetailItem>
        </dl></article>
        <article className="node-detail-card"><h2>Storage</h2><dl>
          <DetailItem label="MachaDFS used">{formatBytes(node.storage.used_bytes)}</DetailItem>
          <DetailItem label="Capacity">{formatBytes(node.storage.capacity_bytes)}</DetailItem>
          <DetailItem label="Free">{formatBytes(node.storage.free_bytes)}</DetailItem>
          <DetailItem label="Backends online">{node.storage_backends_online}</DetailItem>
          <DetailItem label="Cache used">{node.cache.capacity_bytes ? formatBytes(node.cache.used_bytes) : '—'}</DetailItem>
          <DetailItem label="Cache capacity">{node.cache.capacity_bytes ? formatBytes(node.cache.capacity_bytes) : '—'}</DetailItem>
        </dl></article>
        <article className="node-detail-card"><h2>Runtime</h2><dl>
          <DetailItem label="CPU">{runtime.process_cpu_percent != null ? `${runtime.process_cpu_percent.toFixed(1)}%` : '—'}</DetailItem>
          <DetailItem label="Cores">{runtime.cpu_cores ?? '—'}</DetailItem>
          <DetailItem label="Load (1m)">{runtime.load1 != null ? runtime.load1.toFixed(2) : '—'}</DetailItem>
          <DetailItem label="System memory">{memory != null ? formatBytes(memory) : '—'}</DetailItem>
          {/* Named "Process RSS" rather than "RSS" now that machine memory sits
              directly above it: two byte counts an order of magnitude apart,
              and the shorter label left the reader to know which was which. */}
          <DetailItem label="Process RSS">{runtime.rss_bytes != null ? formatBytes(runtime.rss_bytes) : '—'}</DetailItem>
          <DetailItem label="Peers">{runtime.peers_active != null ? `${runtime.peers_active}/${runtime.peers_known ?? runtime.peers_active} active` : '—'}</DetailItem>
          <DetailItem label="RPC reused">{runtime.rpc_connections_reused ?? '—'}</DetailItem>
          <DetailItem label="RPC canonical">{runtime.rpc_connections_canonical ?? '—'}</DetailItem>
        </dl></article>
        <article className="node-detail-card"><h2>Metadata</h2><dl>
          <DetailItem label="Generation">{node.metadata_generation}</DetailItem>
          <DetailItem label="Voter">{node.roles.includes('metadata-voter') ? 'Yes' : 'No'}</DetailItem>
          <DetailItem label="Observed">{presentedTime(node.observed_at_unix_ms)}</DetailItem>
          <DetailItem label="Live age"><span className={telemetryAgeClassName(node)}>{node.live_age_ms != null ? formatDuration(node.live_age_ms) : '—'}</span></DetailItem>
          {node.identity_association_reset && <>
            <DetailItem label="Last identity reset">{presentedTime(node.identity_association_reset.reset_at_unix_ms)}</DetailItem>
            <DetailItem label="Reset epoch">{node.identity_association_reset.epoch}</DetailItem>
            <DetailItem label="Reset scope">{node.identity_association_reset.scope}</DetailItem>
            {node.identity_association_reset.audit_state && <DetailItem label="Audit state">{node.identity_association_reset.audit_state}</DetailItem>}
            {node.identity_association_reset.metadata_persisted != null && <DetailItem label="Metadata persisted">{node.identity_association_reset.metadata_persisted ? 'Yes' : 'Pending'}</DetailItem>}
          </>}
        </dl></article>
      </div>
    </section>
  );
}
