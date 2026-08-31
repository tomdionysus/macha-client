import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  ClusterNodeStatus,
  ClusterStatusApi,
  ClusterStatusSnapshot,
  ConnectivityCheck,
  PublicConnectivityStatus,
} from '../api/ClusterStatusApi';
import { startupPhaseLabel, startupReadyCount, startupSubsystems } from '../api/startupStatus';
import type { ManageApi } from '../api/ManageApi';
import { routes } from '../routing';
import { usePollingTask } from '../hooks/usePollingTask';
import { errorMessage } from '../utils/errors';
import { EndpointRegistry, type EndpointCandidate } from '../cluster/EndpointRegistry';

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

function percentage(used: number, capacity: number): string {
  if (!capacity) return '0%';
  return `${Math.min(100, Math.max(0, used / capacity * 100)).toFixed(0)}%`;
}

function nodeName(node: ClusterNodeStatus): string {
  return node.host || node.id.slice(0, 12);
}

function freshnessLabel(node: ClusterNodeStatus): string {
  if (node.telemetry_freshness === 'live') return 'Live';
  if (node.telemetry_freshness === 'stale') return `Stale · ${formatDuration(node.live_age_ms)}`;
  if (!node.observed_at_unix_ms) return 'Last known';
  return `Last known · ${new Date(node.observed_at_unix_ms).toLocaleString()}`;
}

function UsageBar({ used, capacity }: { used: number; capacity: number }) {
  const width = capacity ? Math.min(100, Math.max(0, used / capacity * 100)) : 0;
  return <div className="cluster-usage-bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>;
}

function ClusterMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="cluster-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

export function clientEndpointHealth(candidate: EndpointCandidate, now = Date.now()): { className: string; label: string } {
  const { health } = candidate;
  if (health.consecutiveFailures > 0) {
    return (health.retryAt ?? 0) > now
      ? { className: 'cooling', label: 'Cooling down' }
      : { className: 'degraded', label: 'Retry eligible' };
  }
  return health.lastSuccessAt
    ? { className: 'available', label: 'Available' }
    : { className: 'untried', label: 'Not tried' };
}

function timestamp(value?: number): string {
  return value ? new Date(value).toLocaleString() : '—';
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
        const cooldownMs = Math.max(0, (health.retryAt ?? 0) - Date.now());
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
            {cooldownMs > 0 && <DetailItem label="Retry in">{formatDuration(cooldownMs)}</DetailItem>}
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
          {connectivity.check.checked_at_unix_ms > 0 && <DetailItem label="Checked">{new Date(connectivity.check.checked_at_unix_ms).toLocaleString()}</DetailItem>}
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
  return (
    <article className={`cluster-node-card ${node.state}`}>
      <Link className="cluster-node-card-link" to={routes.statusNode(node.id)} data-tv-focusable="true">
        <div className="cluster-node-heading">
          <div><strong>{nodeName(node)}</strong><code>{node.id.slice(0, 12)}</code></div>
          <span className={`cluster-state-pill ${node.state}`}>{node.state}</span>
        </div>
        <div className="cluster-node-meta">
          <span>{node.roles.length ? node.roles.join(' · ') : 'node'}</span>
          <span>{freshnessLabel(node)}</span>
        </div>
        <dl className="cluster-node-stats">
          <div><dt>Storage</dt><dd>{formatBytes(node.storage.used_bytes)} / {formatBytes(node.storage.capacity_bytes)}</dd></div>
          <div><dt>Cache</dt><dd>{node.cache.capacity_bytes ? `${formatBytes(node.cache.used_bytes)} / ${formatBytes(node.cache.capacity_bytes)}` : '—'}</dd></div>
          <div><dt>Load</dt><dd>{node.runtime.load1 != null ? node.runtime.load1.toFixed(2) : '—'}</dd></div>
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

export function StatusScreen({ api, endpointRegistry, manageApi }: { api: ClusterStatusApi; endpointRegistry: EndpointRegistry; manageApi?: ManageApi }) {
  const [snapshot, setSnapshot] = useState<ClusterStatusSnapshot>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConnectivityCheck>();
  const [resettingNodeId, setResettingNodeId] = useState<string>();
  const [managementMessage, setManagementMessage] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.status());
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api]);

  usePollingTask({
    load: () => api.status(),
    onValue: (value) => { setSnapshot(value); setError(undefined); },
    onError: (cause) => setError(errorMessage(cause)),
    intervalMs: 5000,
    dependencies: [api],
    allowOverlap: true,
  });

  const checkConnectivity = useCallback(async () => {
    setChecking(true);
    try {
      setCheck(await api.checkConnectivity());
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setChecking(false);
    }
  }, [api, refresh]);

  const resetIdentityAssociation = useCallback(async (node: ClusterNodeStatus) => {
    if (!manageApi || !node.host || !node.port) return;
    const endpoint = `${node.host}:${node.port}`;
    const confirmed = window.confirm(`Reset the cluster-wide identity association ${endpoint} → ${node.id}?\n\nThis removes the stale endpoint-to-NodeId association from membership and RPC routing across the cluster. Old gossip is suppressed, but a freshly authenticated peer may establish a new association. It does not delete node state or MachaDFS data.`);
    if (!confirmed) return;

    setResettingNodeId(node.id);
    setManagementMessage(undefined);
    setError(undefined);
    try {
      const result = await manageApi.resetNodeIdentityAssociation(node.id, node.host, node.port, 'Reset from Status node card');
      setManagementMessage(`Identity association reset committed for ${result.reset.scope} at epoch ${result.reset.epoch}.`);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResettingNodeId(undefined);
    }
  }, [manageApi, refresh]);

  if (!snapshot && !error) return <div className="status-screen">Loading cluster status…</div>;
  if (!snapshot) return <section className="cluster-status-screen error-status"><h1>Server status unavailable</h1><p>{error}</p><ClientApiEndpoints registry={endpointRegistry} /></section>;

  const cluster = snapshot.cluster;
  const reachable = check?.results.filter((result) => result.reachable).length;
  return (
    <section className="cluster-status-screen">
      <header className="cluster-status-heading">
        <div>
          <p className="eyebrow">Macha cluster</p>
          <h1>Status</h1>
          <div className={`cluster-health ${cluster.health}`}><span />{cluster.health}</div>
        </div>
        <button className="secondary-button" type="button" onClick={() => void checkConnectivity()} disabled={checking} data-tv-focusable="true">
          {checking ? 'Checking…' : 'Check connectivity'}
        </button>
      </header>

      {error && <p className="manage-error">Live refresh failed: {error}. Showing the most recent status.</p>}
      {snapshot.startup && snapshot.startup.phase !== 'ready' && <section className={`cluster-startup-panel ${snapshot.startup.phase}`}>
        <div className="cluster-startup-heading">
          <div><span>Local node startup</span><strong>{startupPhaseLabel(snapshot.startup)}</strong></div>
          <small>{startupReadyCount(snapshot.startup)}/8 planes ready</small>
        </div>
        <div className="cluster-startup-grid">
          {startupSubsystems(snapshot.startup).map((subsystem) => <div key={subsystem.key}>
            <span>{subsystem.label}</span><strong className={`cluster-startup-state ${subsystem.state}`}>{subsystem.state}</strong>
          </div>)}
        </div>
        {snapshot.startup.error && <p className="cluster-startup-error">{snapshot.startup.error}</p>}
      </section>}
      {cluster.conditions.length > 0 && <div className="cluster-conditions">{cluster.conditions.map((condition) => <span key={condition}>{condition}</span>)}</div>}
      {check && <p className="cluster-check-result">Connectivity: {reachable}/{check.results.length} nodes reachable · checked {new Date(check.checked_at_unix_ms).toLocaleTimeString()}</p>}

      <div className="cluster-metric-grid">
        <ClusterMetric label="Nodes" value={`${cluster.nodes_online} / ${cluster.nodes_known}`} detail="online" />
        <ClusterMetric label="Metadata" value={cluster.metadata_availability === 'writable' ? 'Writable' : cluster.metadata_availability === 'read-only' ? 'Read-only' : 'Unavailable'} detail={`${cluster.metadata_voters_online}/${cluster.metadata_voters} voters · ${cluster.metadata_quorum_required} required`} />
        <ClusterMetric label="Durable storage" value={`${formatBytes(cluster.storage_online.capacity_bytes)} / ${formatBytes(cluster.storage_known.capacity_bytes)}`} detail={`${formatBytes(cluster.storage_known.used_bytes)} known used`} />
        <ClusterMetric label="Cache" value={cluster.cache_known.capacity_bytes ? `${formatBytes(cluster.cache_online.capacity_bytes)} / ${formatBytes(cluster.cache_known.capacity_bytes)}` : 'None'} detail={cluster.cache_known.capacity_bytes ? `${formatBytes(cluster.cache_known.used_bytes)} known used` : undefined} />
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

      <ClientApiEndpoints registry={endpointRegistry} />

      {managementMessage && <p className="cluster-check-result reachable">{managementMessage}</p>}

      {snapshot.connectivity && <PublicConnectivity connectivity={snapshot.connectivity} />}

      <div className="cluster-nodes-heading"><h2>Nodes</h2><span>Metadata generation {cluster.metadata_generation}</span></div>
      <div className="cluster-node-grid">{snapshot.nodes.map((node) => <NodeCard key={node.id} node={node} canManage={Boolean(manageApi)} resetting={resettingNodeId === node.id} onReset={(target) => void resetIdentityAssociation(target)} />)}</div>
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
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConnectivityCheck>();

  const refresh = useCallback(async () => {
    if (!nodeId) return;
    try {
      setNode(await api.node(nodeId));
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api, nodeId]);

  usePollingTask({
    load: () => api.node(nodeId!),
    onValue: (value) => { setNode(value); setError(undefined); },
    onError: (cause) => setError(errorMessage(cause)),
    intervalMs: 5000,
    dependencies: [api, nodeId],
    allowOverlap: true,
    enabled: Boolean(nodeId),
  });

  if (!node && !error) return <div className="status-screen">Loading node status…</div>;
  if (!node) return <div className="status-screen error-status"><h1>Node unavailable</h1><p>{error}</p><Link to={routes.status}>← Cluster status</Link></div>;

  const runtime = node.runtime;
  const connectivity = check?.results[0];
  return (
    <section className="cluster-status-screen node-status-screen">
      <Link className="back-button" to={routes.status} data-tv-focusable="true">← Cluster status</Link>
      <header className="cluster-status-heading">
        <div><p className="eyebrow">Cluster node</p><h1>{nodeName(node)}</h1><div className={`cluster-health ${node.state === 'online' ? 'healthy' : 'critical'}`}><span />{node.state}</div></div>
        <button className="secondary-button" type="button" disabled={checking} onClick={() => {
          if (!nodeId) return;
          setChecking(true);
          void api.checkConnectivity(nodeId).then(setCheck).then(refresh).catch((cause) => setError(errorMessage(cause))).finally(() => setChecking(false));
        }} data-tv-focusable="true">{checking ? 'Checking…' : 'Check connectivity'}</button>
      </header>
      {error && <p className="manage-error">Live refresh failed: {error}</p>}
      {connectivity && <p className={`cluster-check-result ${connectivity.reachable ? 'reachable' : 'unreachable'}`}>Connectivity: {connectivity.reachable ? 'reachable' : 'unreachable'}{connectivity.error ? ` · ${connectivity.error}` : ''}</p>}

      <div className="node-detail-grid">
        <article className="node-detail-card"><h2>Overview</h2><dl>
          <DetailItem label="Node ID"><code>{node.id}</code></DetailItem>
          <DetailItem label="Version">{node.version || '—'}</DetailItem>
          <DetailItem label="Endpoint">{node.host ? `${node.host}:${node.port}` : '—'}</DetailItem>
          <DetailItem label="Failure domain">{node.failure_domain || '—'}</DetailItem>
          <DetailItem label="Roles">{node.roles.join(', ') || '—'}</DetailItem>
          <DetailItem label="Telemetry">{freshnessLabel(node)}</DetailItem>
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
          <DetailItem label="Load (1m)">{runtime.load1 != null ? runtime.load1.toFixed(2) : '—'}</DetailItem>
          <DetailItem label="RSS">{runtime.rss_bytes != null ? formatBytes(runtime.rss_bytes) : '—'}</DetailItem>
          <DetailItem label="Peers">{runtime.peers_active != null ? `${runtime.peers_active}/${runtime.peers_known ?? runtime.peers_active} active` : '—'}</DetailItem>
          <DetailItem label="RPC reused">{runtime.rpc_connections_reused ?? '—'}</DetailItem>
          <DetailItem label="RPC canonical">{runtime.rpc_connections_canonical ?? '—'}</DetailItem>
        </dl></article>
        <article className="node-detail-card"><h2>Metadata</h2><dl>
          <DetailItem label="Generation">{node.metadata_generation}</DetailItem>
          <DetailItem label="Voter">{node.roles.includes('metadata-voter') ? 'Yes' : 'No'}</DetailItem>
          <DetailItem label="Observed">{node.observed_at_unix_ms ? new Date(node.observed_at_unix_ms).toLocaleString() : '—'}</DetailItem>
          <DetailItem label="Live age">{node.live_age_ms != null ? formatDuration(node.live_age_ms) : '—'}</DetailItem>
          {node.identity_association_reset && <>
            <DetailItem label="Last identity reset">{new Date(node.identity_association_reset.reset_at_unix_ms).toLocaleString()}</DetailItem>
            <DetailItem label="Reset epoch">{node.identity_association_reset.epoch}</DetailItem>
            <DetailItem label="Reset scope">{node.identity_association_reset.scope}</DetailItem>
          </>}
        </dl></article>
      </div>
    </section>
  );
}
