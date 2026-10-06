import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import { qualityLabel, type QualityCeiling, type QualityClass, type QualityPreference, type QualityPreferenceStore, type ServerApi, type ServerStatus } from '@machafoundation/core';
import { machaLogoUrl as logoUrl } from '../uiAssets';
import { useAsync } from '../hooks/useAsync';
import { routes } from '@machafoundation/core';
import { clientVersion } from '../version';
import { ConnectionForm } from '../components/ConnectionForm';
import { failureTrailEnabled, setFailureTrailEnabled } from '../diagnostics/failureTrailSetting';
import { presentedTime } from '../diagnostics/timestamps';
import { serverStatusText, viewerErrorText } from '../text/viewerText';

interface Props {
  api: MediaApi;
  serverApi: ServerApi;
  bootstrapEndpoints: readonly string[];
  /** See `ConnectionFormProps.usingHost`. */
  usingHost?: string;
  connectionNotice?: string;
  onSave: (urls: readonly string[]) => Promise<string | undefined>;
  /** The viewer's Maximum quality for this device; the web sets only `wifi`, which an unknown connection uses. */
  qualityPreferences?: QualityPreferenceStore;
  /** This device's cap on automatic play, as the runtime will read it. */
  qualityCeiling?: () => QualityCeiling | undefined;
}

/** The ceilings a viewer may set: every class a file is commonly found at. */
const MAXIMUM_QUALITY_CHOICES: readonly QualityClass[] = [2160, 1440, 1080, 720, 480];

/** What Automatic means on this device, or what the setting does. */
function maximumQualityNote(setting: QualityClass | undefined, ceiling: QualityCeiling | undefined): string {
  if (setting !== undefined) return `Play chooses up to ${qualityLabel(setting)} on this device. Any quality can still be picked on a title's page.`;
  if (ceiling) return `Automatic: Play chooses up to ${qualityLabel(ceiling.quality)}, the most this screen shows.`;
  return 'Automatic: Play chooses the best file, as this screen\'s size is not known.';
}

const noSubscription = () => () => {};
const NO_PREFERENCE: QualityPreference = {};
const noPreference = () => NO_PREFERENCE;

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
  return presentedTime(unixMs);
}

export function SettingsScreen({ api, serverApi, bootstrapEndpoints, usingHost, connectionNotice, onSave, qualityPreferences, qualityCeiling }: Props) {
  const [failureTrail, setFailureTrail] = useState(failureTrailEnabled);
  const preference = useSyncExternalStore(
    qualityPreferences?.subscribe ?? noSubscription,
    qualityPreferences?.getSnapshot ?? noPreference,
  );
  const maximum = preference.wifi;
  const setOfferAll = (offerAll: boolean) => {
    try {
      qualityPreferences?.setOfferAll(offerAll);
    } catch {
      // As for Maximum quality: the switch shows the setting still in force.
    }
  };
  const chooseMaximum = (quality: QualityClass | undefined) => {
    try {
      qualityPreferences?.set('wifi', quality);
    } catch {
      // Storage can throw (a private window); the screen keeps showing the old choice, which is still the one in force.
    }
  };
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
          {(server.error || serverStatusText(server.value)) && <p className="settings-status-error">{server.error ? viewerErrorText(server.error) : serverStatusText(server.value)}</p>}
        </article>

        <article className="settings-status-card">
          <span className="settings-status-label">Catalogue</span>
          <strong>{catalogueState}</strong>
          <dl>
            <div><dt>Items</dt><dd>{catalogue.value?.items ?? '-'}</dd></div>
            <div>
              <dt>Artwork</dt>
              <dd>{catalogue.value ? `${catalogue.value.local_artwork_objects}/${catalogue.value.artwork_objects} local` : '-'}</dd>
            </div>
            <div><dt>Generation</dt><dd>{catalogue.value?.metadata_generation ?? '-'}</dd></div>
            <div><dt>Last sync</dt><dd>{catalogue.value ? formatLastSync(catalogue.value.last_sync_unix_ms) : '-'}</dd></div>
          </dl>
          {(catalogue.error || catalogue.value?.error) && (
            <p className="settings-status-error">{catalogue.error ? viewerErrorText(catalogue.error) : catalogue.value?.error}</p>
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

      {qualityPreferences && <div className="settings-playback">
        <h2>Playback</h2>
        <div className="player-option-group">
          <span>Maximum quality</span>
          <div>
            <button type="button" data-tv-focusable="true" className={maximum === undefined ? 'selected' : undefined} onClick={() => chooseMaximum(undefined)}>Automatic</button>
            {MAXIMUM_QUALITY_CHOICES.map((quality) => (
              <button type="button" key={quality} data-tv-focusable="true" className={maximum === quality ? 'selected' : undefined} onClick={() => chooseMaximum(quality)}>{qualityLabel(quality)}</button>
            ))}
          </div>
          <small className="player-option-note">{maximumQualityNote(maximum, qualityCeiling?.())}</small>
        </div>
        <label className="settings-toggle">
          <span className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              data-tv-focusable="true"
              checked={preference.offerAll === true}
              onChange={(event) => setOfferAll(event.target.checked)}
            />
            <span className="settings-switch-track" aria-hidden="true" />
          </span>
          <span className="settings-toggle-label">Offer every quality and mode, even ones this device may not play</span>
        </label>
      </div>}

      <div className="settings-diagnostics">
        <h2>Diagnostics</h2>
        <label className="settings-toggle">
          <span className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              data-tv-focusable="true"
              checked={failureTrail}
              onChange={(event) => {
                setFailureTrailEnabled(event.target.checked);
                setFailureTrail(event.target.checked);
              }}
            />
            <span className="settings-switch-track" aria-hidden="true" />
          </span>
          <span className="settings-toggle-label">Show extended playback logging on errors</span>
        </label>
      </div>

      <div className="settings-connection">
        <h2>Connection</h2>
        <ConnectionForm bootstrapEndpoints={bootstrapEndpoints} usingHost={usingHost} onSave={onSave} notice={connectionNotice} />
      </div>
    </section>
  );
}
