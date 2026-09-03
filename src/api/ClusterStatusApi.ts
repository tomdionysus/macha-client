import type { IdentityAssociationReset } from './ManageApi';
import { authenticatedRequestHeaders, normalizeBaseUrl, readResponseBody } from './httpCompat';
import { isGatewayConnectionFailure, serverUnreachable } from './serverConnection';

export type TelemetryFreshness = 'live' | 'stale' | 'last_known' | 'unavailable';
export type NodeState = 'online' | 'offline' | 'retired';
export type ClusterHealth = 'healthy' | 'recovering' | 'degraded' | 'critical';
export type MetadataAvailability = 'unavailable' | 'read-only' | 'writable';

export type StartupPhase = 'starting' | 'recovering' | 'ready' | 'failed';
export type StartupSubsystemState = 'starting' | 'recovering' | 'ready' | 'failed';

export interface ClusterStartupStatus {
  phase: StartupPhase;
  control_plane: StartupSubsystemState;
  api: StartupSubsystemState;
  data_storage: StartupSubsystemState;
  control_storage: StartupSubsystemState;
  cache: StartupSubsystemState;
  retention: StartupSubsystemState;
  metadata: StartupSubsystemState;
  services: StartupSubsystemState;
  started_at_unix_ms: number;
  ready_at_unix_ms: number | null;
  error: string | null;
}

export interface ByteUsage {
  capacity_bytes: number;
  used_bytes: number;
  free_bytes: number;
}

export interface NodeRuntimeStatus {
  uptime_ms?: number;
  rss_bytes?: number;
  process_cpu_percent?: number;
  load1?: number;
  peers_known?: number;
  peers_active?: number;
  rpc_connections_created?: number;
  rpc_connections_reused?: number;
  rpc_connections_canonical?: number;
}

export interface ClusterNodeStatus {
  id: string;
  state: NodeState;
  telemetry_freshness: TelemetryFreshness;
  observed_at_unix_ms: number;
  live_age_ms: number | null;
  version: string;
  host: string;
  port: number;
  failure_domain: string;
  metadata_generation: number;
  storage: ByteUsage;
  cache: ByteUsage;
  storage_backends_online: number;
  roles: string[];
  runtime: NodeRuntimeStatus;
  identity_association_reset: IdentityAssociationReset | null;
}

export interface ClusterSummaryStatus {
  health: ClusterHealth;
  conditions: string[];
  nodes_known: number;
  nodes_online: number;
  metadata_generation: number;
  metadata_voters: number;
  metadata_voters_online: number;
  metadata_quorum_required: number;
  metadata_availability: MetadataAvailability;
  metadata_read_available: boolean;
  metadata_quorum_available: boolean;
  metadata_write_available: boolean;
  metadata_quorum_validated: boolean;
  metadata_quorum_validated_at_unix_ms: number;
  storage_known: ByteUsage;
  storage_online: ByteUsage;
  cache_known: ByteUsage;
  cache_online: ByteUsage;
}

export interface ConnectivityEndpoint {
  host: string;
  port: number;
  source?: string;
}

export interface UpnpConnectivityStatus {
  enabled: boolean;
  support_built: boolean;
  gateway_found: boolean;
  mapping_active: boolean;
  mapping_created: boolean;
  mapping_owned: boolean;
  private_wan: boolean;
  lan_address: string | null;
  external_address: string | null;
  internal_port: number;
  external_port: number;
  lease_seconds: number;
  igd_status: number;
  error: string | null;
}

export interface ExternalIpConnectivityStatus {
  enabled: boolean;
  attempted: boolean;
  address: string | null;
  error: string | null;
}

export interface PublicConnectivityCheckStatus {
  enabled: boolean;
  self_probe: string;
  error: string | null;
  checked_at_unix_ms: number;
  externally_verified: boolean;
}

export interface PublicConnectivityStatus {
  configured: ConnectivityEndpoint;
  advertised: ConnectivityEndpoint;
  upnp: UpnpConnectivityStatus;
  external_ip: ExternalIpConnectivityStatus;
  check: PublicConnectivityCheckStatus;
}

export interface ClusterStatusSnapshot {
  cluster: ClusterSummaryStatus;
  startup?: ClusterStartupStatus;
  nodes: ClusterNodeStatus[];
  connectivity?: PublicConnectivityStatus;
  generated_at_unix_ms: number;
}

export interface ConnectivityResult {
  node_id: string;
  reachable: boolean;
  error?: string;
}

export interface ConnectivityCheck {
  results: ConnectivityResult[];
  connectivity?: PublicConnectivityStatus;
  checked_at_unix_ms: number;
}

export interface ClusterStatusApi {
  status(): Promise<ClusterStatusSnapshot>;
  node(id: string): Promise<ClusterNodeStatus>;
  checkConnectivity(nodeId?: string): Promise<ConnectivityCheck>;
}

export class MachaClusterStatusApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'MachaClusterStatusApiError';
  }
}

export class MachaClusterStatusApi implements ClusterStatusApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly bearerToken?: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async request<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
    const headers = authenticatedRequestHeaders(undefined, this.bearerToken);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers });
    } catch {
      throw serverUnreachable();
    }

    const { body, wasJson } = await readResponseBody(response);
    if (isGatewayConnectionFailure(response, wasJson)) throw serverUnreachable();
    if (!response.ok) {
      const record = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : undefined;
      const message = typeof record?.message === 'string'
        ? record.message
        : `${response.status} ${response.statusText}`;
      throw new MachaClusterStatusApiError(message, response.status);
    }
    return body as T;
  }

  status(): Promise<ClusterStatusSnapshot> {
    return this.request('/api/v1/status', 'GET');
  }

  node(id: string): Promise<ClusterNodeStatus> {
    return this.request(`/api/v1/status/nodes/${encodeURIComponent(id)}`, 'GET');
  }

  checkConnectivity(nodeId?: string): Promise<ConnectivityCheck> {
    const path = nodeId
      ? `/api/v1/status/nodes/${encodeURIComponent(nodeId)}/connectivity/check`
      : '/api/v1/status/connectivity/check';
    return this.request(path, 'POST');
  }
}

const demoNode: ClusterNodeStatus = {
  id: '00000000000000000000000000000001',
  state: 'online',
  telemetry_freshness: 'live',
  observed_at_unix_ms: Date.now(),
  live_age_ms: 0,
  version: 'demo',
  host: 'demo',
  port: 0,
  failure_domain: 'demo',
  metadata_generation: 1,
  storage: { capacity_bytes: 8 * 1024 ** 4, used_bytes: 3.2 * 1024 ** 4, free_bytes: 4.8 * 1024 ** 4 },
  cache: { capacity_bytes: 512 * 1024 ** 3, used_bytes: 112 * 1024 ** 3, free_bytes: 400 * 1024 ** 3 },
  storage_backends_online: 1,
  roles: ['storage', 'cache', 'metadata-voter'],
  runtime: { uptime_ms: 3_600_000, rss_bytes: 128 * 1024 ** 2, process_cpu_percent: 2.4, load1: 0.18, peers_known: 1, peers_active: 1 },
  identity_association_reset: null,
};

export class DemoClusterStatusApi implements ClusterStatusApi {
  async status(): Promise<ClusterStatusSnapshot> {
    const node = { ...demoNode, observed_at_unix_ms: Date.now() };
    return {
      cluster: {
        health: 'healthy', conditions: [], nodes_known: 1, nodes_online: 1,
        metadata_generation: 1, metadata_voters: 1, metadata_voters_online: 1,
        metadata_quorum_required: 1, metadata_availability: 'writable',
        metadata_read_available: true, metadata_quorum_available: true,
        metadata_write_available: true, metadata_quorum_validated: true,
        metadata_quorum_validated_at_unix_ms: Date.now(),
        storage_known: node.storage, storage_online: node.storage,
        cache_known: node.cache, cache_online: node.cache,
      },
      startup: {
        phase: 'ready', control_plane: 'ready', api: 'ready', data_storage: 'ready',
        control_storage: 'ready', cache: 'ready', retention: 'ready', metadata: 'ready',
        services: 'ready', started_at_unix_ms: Date.now() - 3_600_000,
        ready_at_unix_ms: Date.now() - 3_599_000, error: null,
      },
      nodes: [node],
      generated_at_unix_ms: Date.now(),
    };
  }

  async node(id: string): Promise<ClusterNodeStatus> {
    if (id !== demoNode.id) throw new Error('Unknown demo node');
    return { ...demoNode, observed_at_unix_ms: Date.now() };
  }

  async checkConnectivity(nodeId?: string): Promise<ConnectivityCheck> {
    return {
      results: [{ node_id: nodeId ?? demoNode.id, reachable: true }],
      checked_at_unix_ms: Date.now(),
    };
  }
}
