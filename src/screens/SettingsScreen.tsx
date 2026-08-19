import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MediaApi } from '../api/MediaApi';
import type { ServerApi, ServerStatus } from '../api/MachaServerApi';
import logoUrl from '../assets/macha-logo.svg?url';
import { useAsync } from '../hooks/useAsync';
import { routes } from '../routing';
import { clientVersion } from '../version';

interface Props {
  api: MediaApi;
  serverApi: ServerApi;
  serverUrl: string;
  apiToken: string;
  connectionNotice?: string;
  onSave: (url: string, token: string) => void;
}

function booleanField(status: ServerStatus | undefined, name: string): boolean | undefined {
  const value = status?.playback[name];
  return typeof value === 'boolean' ? value : undefined;
}

function playbackState(status: ServerStatus | undefined): string {
  if (!status) return 'Unknown';
  if (!status.playbackAvailable) return 'Unavailable';
  if (booleanField(status, 'enabled') === false) return 'Disabled';
  if (booleanField(status, 'ready') === false || booleanField(status, 'available') === false) return 'Not ready';
  return 'Ready';
}

function formatLastSync(unixMs: number): string {
  if (!unixMs) return 'Never';
  return new Date(unixMs).toLocaleString();
}

export function SettingsScreen({ api, serverApi, serverUrl, apiToken, connectionNotice, onSave }: Props) {
  const [url, setUrl] = useState(serverUrl);
  const [token, setToken] = useState(apiToken);
  const server = useAsync(() => serverApi.status(), [serverApi]);
  const catalogue = useAsync(() => api.status(), [api]);

  const serverState = server.loading ? 'Checking…' : server.error ? 'Unavailable' : 'Online';
  const catalogueState = catalogue.loading
    ? 'Checking…'
    : catalogue.error
      ? 'Unavailable'
      : catalogue.value?.ready
        ? 'Ready'
        : catalogue.value?.enabled
          ? 'Synchronising'
          : 'Disabled';

  const overallState = connectionNotice
    ? 'Server unavailable'
    : server.error
    ? 'Server unavailable'
    : catalogue.error
      ? 'Server online; catalogue unavailable'
      : catalogue.value?.ready
        ? 'Ready'
        : catalogue.loading || server.loading
          ? 'Checking system state…'
          : 'Server online; catalogue synchronising';

  return (
    <section className="settings">
      <div className="settings-hero">
        <img className="settings-logo" src={logoUrl} alt="" />
        <div className="settings-brand-copy">
          <p className="eyebrow">Media server</p>
          <h1>Macha</h1>
          <p className="settings-overall-state">{overallState}</p>
        </div>
        <Link className="primary-button sponsor-button" data-tv-focusable="true" to={routes.sponsor}>
          Donate / Sponsor
        </Link>
      </div>

      <div className="settings-status-grid" aria-label="System status">
        <article className="settings-status-card">
          <span className="settings-status-label">Server</span>
          <strong>{serverState}</strong>
          <dl>
            <div><dt>Version</dt><dd>{server.value?.version ?? (server.loading ? 'Checking…' : 'Not reported')}</dd></div>
            <div><dt>Playback</dt><dd>{server.error ? 'Unavailable' : playbackState(server.value)}</dd></div>
          </dl>
          {(server.error || server.value?.message) && <p className="settings-status-error">{server.error?.message ?? server.value?.message}</p>}
        </article>

        <article className="settings-status-card">
          <span className="settings-status-label">Catalogue</span>
          <strong>{catalogueState}</strong>
          <dl>
            <div><dt>Items</dt><dd>{catalogue.value?.items ?? '—'}</dd></div>
            <div>
              <dt>Artwork</dt>
              <dd>{catalogue.value ? `${catalogue.value.local_artwork_objects}/${catalogue.value.artwork_objects} local` : '—'}</dd>
            </div>
            <div><dt>Generation</dt><dd>{catalogue.value?.metadata_generation ?? '—'}</dd></div>
            <div><dt>Last sync</dt><dd>{catalogue.value ? formatLastSync(catalogue.value.last_sync_unix_ms) : '—'}</dd></div>
          </dl>
          {(catalogue.error || catalogue.value?.error) && (
            <p className="settings-status-error">{catalogue.error?.message ?? catalogue.value?.error}</p>
          )}
        </article>

        <article className="settings-status-card settings-version-card">
          <span className="settings-status-label">Client</span>
          <strong>Web client</strong>
          <dl>
            <div><dt>Version</dt><dd>{clientVersion}</dd></div>
          </dl>
        </article>
      </div>

      <div className="settings-connection">
        <h2>Connection</h2>
        {connectionNotice && (server.error || !server.value?.playbackAvailable) && (
          <p className="settings-status-error" role="alert">{connectionNotice}</p>
        )}
        <label htmlFor="server-url">Macha API</label>
        <div className="settings-line">
          <input
            id="server-url"
            data-tv-focusable="true"
            value={url}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
            placeholder="same origin"
            spellCheck={false}
          />
        </div>
        <label htmlFor="api-token">Bearer token <span className="muted">(optional)</span></label>
        <div className="settings-line">
          <input
            id="api-token"
            data-tv-focusable="true"
            type="password"
            value={token}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setToken(event.target.value)}
            spellCheck={false}
          />
          <button data-tv-focusable="true" onClick={() => onSave(url, token)}>Save</button>
        </div>
        <p>No account or cloud service. An empty API URL means same-origin <code>/api/v1/…</code>.</p>
      </div>
    </section>
  );
}
