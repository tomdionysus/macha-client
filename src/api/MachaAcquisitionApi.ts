import type {
  AcquisitionApi,
  AcquisitionSnapshot,
  IngestJob,
  IngestStatus,
  TorrentJob,
  TorrentStatus,
} from './AcquisitionApi';
import { parseErrorEnvelope } from './errorEnvelope';
import { mergeRequestHeaders } from './httpCompat';
import { isGatewayConnectionFailure, serverUnreachable } from './serverConnection';

interface IngestJobsEnvelope { jobs: IngestJob[]; }
interface TorrentJobsEnvelope { jobs: TorrentJob[]; }
interface IdEnvelope { id: string; }

export class MachaAcquisitionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'MachaAcquisitionApiError';
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

export class MachaAcquisitionApi implements AcquisitionApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly bearerToken?: string,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async snapshot(): Promise<AcquisitionSnapshot> {
    const [ingestStatus, torrentStatus, ingestJobs, torrentJobs] = await Promise.all([
      this.getJson<IngestStatus>('/api/v1/ingest/status'),
      this.getJson<TorrentStatus>('/api/v1/torrents/status'),
      this.getJson<IngestJobsEnvelope>('/api/v1/ingest/jobs'),
      this.getJson<TorrentJobsEnvelope>('/api/v1/torrents/jobs'),
    ]);
    return {
      ingestStatus,
      torrentStatus,
      ingestJobs: ingestJobs.jobs,
      torrentJobs: torrentJobs.jobs,
    };
  }

  async submitPath(path: string): Promise<string> {
    const response = await this.request<IdEnvelope>('/api/v1/ingest/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, remove_source: false }),
    });
    return response.id;
  }

  async submitMagnet(magnet: string): Promise<string> {
    const response = await this.request<IdEnvelope>('/api/v1/torrents/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet }),
    });
    return response.id;
  }

  pauseIngest(id: string): Promise<IngestJob> { return this.ingestAction(id, 'pause'); }
  resumeIngest(id: string): Promise<IngestJob> { return this.ingestAction(id, 'resume'); }
  cancelIngest(id: string): Promise<IngestJob> { return this.ingestAction(id, 'cancel'); }
  pauseTorrent(id: string): Promise<TorrentJob> { return this.torrentAction(id, 'pause'); }
  resumeTorrent(id: string): Promise<TorrentJob> { return this.torrentAction(id, 'resume'); }
  cancelTorrent(id: string): Promise<TorrentJob> { return this.torrentAction(id, 'cancel'); }

  private ingestAction(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<IngestJob> {
    return this.request(`/api/v1/ingest/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  }

  private torrentAction(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<TorrentJob> {
    return this.request(`/api/v1/torrents/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  }

  private getJson<T>(path: string): Promise<T> {
    return this.request(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = this.bearerToken?.trim();
    const headers = mergeRequestHeaders(init.headers, {
      Accept: 'application/json',
      Authorization: token ? `Bearer ${token}` : undefined,
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw serverUnreachable();
    }

    if (!response.ok) await this.throwResponseError(response);
    return await response.json() as T;
  }

  private async throwResponseError(response: Response): Promise<never> {
    let body: unknown;
    let bodyWasJson = false;
    try {
      body = await response.json() as unknown;
      bodyWasJson = true;
    } catch {
      // A proxy-generated gateway failure may not contain a Macha JSON envelope.
    }
    if (isGatewayConnectionFailure(response, bodyWasJson)) throw serverUnreachable();
    const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
    throw new MachaAcquisitionApiError(`Macha acquisition request failed: ${parsed.message}`, response.status, parsed.code);
  }
}

export class DemoAcquisitionApi implements AcquisitionApi {
  async snapshot(): Promise<AcquisitionSnapshot> {
    return {
      ingestStatus: {
        enabled: false,
        staging: { path: '', limit_bytes: 0, disk_bytes: 0, reserved_bytes: 0, accounted_bytes: 0 },
      },
      torrentStatus: { enabled: false, build_available: false, search_enabled: false },
      ingestJobs: [],
      torrentJobs: [],
    };
  }

  submitPath(): Promise<string> { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
  submitMagnet(): Promise<string> { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
  pauseIngest(): Promise<IngestJob> { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
  resumeIngest(): Promise<IngestJob> { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
  cancelIngest(): Promise<IngestJob> { return Promise.reject(new Error('Import is unavailable in demo mode.')); }
  pauseTorrent(): Promise<TorrentJob> { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
  resumeTorrent(): Promise<TorrentJob> { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
  cancelTorrent(): Promise<TorrentJob> { return Promise.reject(new Error('Torrent acquisition is unavailable in demo mode.')); }
}
