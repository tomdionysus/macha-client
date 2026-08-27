import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  ClusterNodeStatus,
  ClusterStatusApi,
  ClusterStatusSnapshot,
  ConnectivityCheck,
} from '../api/ClusterStatusApi';
import type { ManageApi } from '../api/ManageApi';
import { routes } from '../routing';

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

function NodeCard({ node }: { node: ClusterNodeStatus }) {
  return (
    <Link className={`cluster-node-card ${node.state}`} to={routes.statusNode(node.id)} data-tv-focusable="true">
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
  );
}

export function StatusScreen({ api, manageApi }: { api: ClusterStatusApi; manageApi?: ManageApi }) {
  const [snapshot, setSnapshot] = useState<ClusterStatusSnapshot>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConnectivityCheck>();
  const [resettingIdentity, setResettingIdentity] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string>();
  const [resetHost, setResetHost] = useState('');
  const [resetPort, setResetPort] = useState('');
  const [resetNodeId, setResetNodeId] = useState('');

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.status());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const checkConnectivity = useCallback(async () => {
    setChecking(true);
    try {
      setCheck(await api.checkConnectivity());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  }, [api, refresh]);

  const resetIdentityAssociation = useCallback(async () => {
    if (!manageApi) return;
    const host = resetHost.trim();
    if (!host) {
      setError('Host/IP is required to reset an identity association.');
      return;
    }
    const portText = resetPort.trim();
    const port = portText ? Number(portText) : undefined;
    if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError('Port must be between 1 and 65535, or left blank to clear all ports on the host.');
      return;
    }
    const nodeId = resetNodeId.trim();
    if (nodeId && !/^[0-9a-fA-F]{32}$/.test(nodeId)) {
      setError('Node ID must be 32 hexadecimal characters, or left blank when unknown.');
      return;
    }
    const scope = port ? `${host}:${port}` : `${host}:*`;
    const identity = nodeId ? `NodeId ${nodeId}` : 'whatever stale NodeId is associated there';
    const confirmed = window.confirm(`Reset cluster-wide identity association for ${scope}?\n\nThis invalidates ${identity} from live membership and RPC routing across the cluster. Old gossip is suppressed, but a freshly authenticated peer may establish a new association. It does not delete node state or MachaDFS data.`);
    if (!confirmed) return;

    setResettingIdentity(true);
    setManagementMessage(undefined);
    setError(undefined);
    try {
      const result = await manageApi.resetIdentityAssociation({
        host,
        port,
        node_id: nodeId || undefined,
        reason: 'Reset from Status UI',
      });
      setManagementMessage(`Identity association reset committed for ${result.reset.scope} at epoch ${result.reset.epoch}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResettingIdentity(false);
    }
  }, [manageApi, refresh, resetHost, resetNodeId, resetPort]);

  if (!snapshot && !error) return <div className="status-screen">Loading cluster status…</div>;
  if (!snapshot) return <div className="status-screen error-status"><h1>Status unavailable</h1><p>{error}</p></div>;

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

      {manageApi && <article className="cluster-management-card">
        <div className="cluster-management-heading">
          <div><p className="eyebrow">Management</p><h2>Reset node identity association</h2></div>
          <span>Cluster-wide</span>
        </div>
        <p className="manage-muted">Clear a stale endpoint/IP → NodeId association without deleting node state. Node ID and port are optional: leave Node ID blank if it is unknown, and leave port blank to clear all associations for that host/IP.</p>
        <div className="cluster-management-fields">
          <label>Host / IP<input value={resetHost} onChange={(event) => setResetHost(event.target.value)} placeholder="10.44.1.50" data-tv-focusable="true" /></label>
          <label>Port (optional)<input value={resetPort} onChange={(event) => setResetPort(event.target.value)} inputMode="numeric" placeholder="57401" data-tv-focusable="true" /></label>
          <label>Node ID (optional)<input value={resetNodeId} onChange={(event) => setResetNodeId(event.target.value)} placeholder="32 hex characters" data-tv-focusable="true" /></label>
        </div>
        {managementMessage && <p className="cluster-check-result reachable">{managementMessage}</p>}
        <button className="secondary-button manage-danger" type="button" disabled={resettingIdentity || !resetHost.trim()} onClick={() => void resetIdentityAssociation()} data-tv-focusable="true">
          {resettingIdentity ? 'Resetting…' : 'Reset identity association'}
        </button>
      </article>}

      <div className="cluster-nodes-heading"><h2>Nodes</h2><span>Metadata generation {cluster.metadata_generation}</span></div>
      <div className="cluster-node-grid">{snapshot.nodes.map((node) => <NodeCard key={node.id} node={node} />)}</div>
    </section>
  );
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function NodeStatusScreen({ api, manageApi }: { api: ClusterStatusApi; manageApi?: ManageApi }) {
  const { nodeId } = useParams<{ nodeId: string }>();
  const [node, setNode] = useState<ClusterNodeStatus>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConnectivityCheck>();
  const [resettingIdentity, setResettingIdentity] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string>();

  const refresh = useCallback(async () => {
    if (!nodeId) return;
    try {
      setNode(await api.node(nodeId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api, nodeId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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
          void api.checkConnectivity(nodeId).then(setCheck).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setChecking(false));
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
        </dl></article>
        {manageApi && <article className="node-detail-card node-management-card"><h2>Management</h2>
          <p className="manage-muted">Cluster-wide identity operations affect membership and RPC routing, not MachaDFS data or persisted node status.</p>
          {node.identity_association_reset && <dl>
            <DetailItem label="Last identity reset">{new Date(node.identity_association_reset.reset_at_unix_ms).toLocaleString()}</DetailItem>
            <DetailItem label="Reset epoch">{node.identity_association_reset.epoch}</DetailItem>
            <DetailItem label="Reset scope">{node.identity_association_reset.scope}</DetailItem>
          </dl>}
          {managementMessage && <p className="cluster-check-result reachable">{managementMessage}</p>}
          <button className="secondary-button manage-danger" type="button" disabled={resettingIdentity || !node.host || !node.port} onClick={() => {
            if (!nodeId || !node.host || !node.port) return;
            const endpoint = `${node.host}:${node.port}`;
            const confirmed = window.confirm(`Reset the cluster-wide identity association ${endpoint} → ${node.id}?\n\nThis removes the stale endpoint-to-NodeId association from membership and RPC routing across the cluster. It does not delete node state or MachaDFS data.`);
            if (!confirmed) return;
            setResettingIdentity(true);
            setManagementMessage(undefined);
            setError(undefined);
            void manageApi.resetIdentityAssociation({ host: node.host, port: node.port, node_id: node.id, reason: 'Reset from Status UI' })
              .then((result) => {
                setManagementMessage(`Identity association reset committed at epoch ${result.reset.epoch}.`);
                return refresh();
              })
              .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
              .finally(() => setResettingIdentity(false));
          }} data-tv-focusable="true">{resettingIdentity ? 'Resetting…' : 'Reset node identity association'}</button>
        </article>}
      </div>
    </section>
  );
}
