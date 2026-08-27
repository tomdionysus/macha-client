import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { CatalogueApi } from '../api/CatalogueApi';
import { routes } from '../routing';
import type {
  MachaDfsDirectory,
  MachaDfsEntry,
  ManageApi,
  ManageCatalogueMatch,
  ManualMetadata,
  MediaProbeCandidate,
  UnmatchedDetail,
  UnmatchedFile,
} from '../api/ManageApi';

export type ManageSection = 'unmatched' | 'files' | 'settings';

interface Props {
  api: ManageApi;
  catalogueApi: CatalogueApi;
  section: ManageSection;
  settings: ReactNode;
  managementAvailable: boolean;
  onUnmatchedCountChange?: (count: number) => void;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit + 1 < units.length) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function joinPath(parent: string, name: string): string {
  if (parent === '/') return `/${name}`;
  return `${parent.replace(/\/+$/, '')}/${name}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateSummary(candidate: MediaProbeCandidate): string {
  if (candidate.kind === 'movie') return [candidate.title, candidate.year].filter(Boolean).join(' · ');
  if (candidate.kind === 'episode') {
    const position = candidate.season_number != null && candidate.episode_number != null
      ? `S${String(candidate.season_number).padStart(2, '0')}E${String(candidate.episode_number).padStart(2, '0')}`
      : '';
    return [candidate.series, position, candidate.title].filter(Boolean).join(' · ');
  }
  return [candidate.artist, candidate.album, candidate.title].filter(Boolean).join(' · ');
}

function matchSubtitle(match: ManageCatalogueMatch): string {
  const parts: string[] = [match.kind];
  if (match.year != null) parts.push(String(match.year));
  if (match.season_number != null && match.episode_number != null) {
    parts.push(`S${String(match.season_number).padStart(2, '0')}E${String(match.episode_number).padStart(2, '0')}`);
  }
  return parts.join(' · ');
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ManualMetadataForm({ detail, api, catalogueApi, onResolved }: {
  detail: UnmatchedDetail;
  api: ManageApi;
  catalogueApi: CatalogueApi;
  onResolved: () => void;
}) {
  const probe = detail.probes[0];
  const initialKind = probe?.kind ?? (detail.item.provider === 'tv' ? 'episode' : detail.item.provider === 'music' ? 'track' : 'movie');
  const [kind, setKind] = useState<'movie' | 'episode' | 'track'>(initialKind);
  const [title, setTitle] = useState(probe?.title ?? '');
  const [year, setYear] = useState(probe?.year?.toString() ?? '');
  const [synopsis, setSynopsis] = useState('');
  const [series, setSeries] = useState(probe?.series ?? '');
  const [seriesYear, setSeriesYear] = useState(probe?.year?.toString() ?? '');
  const [seasonNumber, setSeasonNumber] = useState(probe?.season_number?.toString() ?? '');
  const [episodeNumber, setEpisodeNumber] = useState(probe?.episode_number?.toString() ?? '');
  const [artist, setArtist] = useState(probe?.artist ?? '');
  const [album, setAlbum] = useState(probe?.album ?? '');
  const [discNumber, setDiscNumber] = useState(probe?.disc_number?.toString() ?? '');
  const [trackNumber, setTrackNumber] = useState(probe?.track_number?.toString() ?? '');
  const [artwork, setArtwork] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      let metadata: ManualMetadata;
      if (kind === 'movie') {
        metadata = { kind, title: title.trim(), year: numberOrUndefined(year), synopsis: synopsis.trim() || undefined };
      } else if (kind === 'episode') {
        const season = numberOrUndefined(seasonNumber);
        const episode = numberOrUndefined(episodeNumber);
        if (season == null || episode == null) throw new Error('Season and episode numbers are required.');
        metadata = {
          kind,
          series: series.trim(),
          series_year: numberOrUndefined(seriesYear),
          season_number: season,
          episode_number: episode,
          title: title.trim() || undefined,
          synopsis: synopsis.trim() || undefined,
        };
      } else {
        metadata = {
          kind,
          artist: artist.trim(),
          album: album.trim(),
          title: title.trim(),
          year: numberOrUndefined(year),
          disc_number: numberOrUndefined(discNumber),
          track_number: numberOrUndefined(trackNumber),
          synopsis: synopsis.trim() || undefined,
        };
      }
      const saved = await api.manual(detail.item.id, metadata);
      if (artwork) {
        const role = kind === 'movie' ? 'poster' : kind === 'episode' ? 'thumbnail' : 'cover';
        await catalogueApi.putArtwork(saved.leaf_item_id, role, artwork.type || 'image/jpeg', artwork);
      }
      onResolved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [album, api, artist, artwork, catalogueApi, detail.item.id, discNumber, episodeNumber, kind, onResolved, seasonNumber, series, seriesYear, synopsis, title, trackNumber, year]);

  return (
    <section className="manage-manual-form" aria-label="Manual catalogue metadata">
      <h3>Enter catalogue metadata</h3>
      <label>Type
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} disabled={busy} data-tv-focusable="true">
          <option value="movie">Movie</option>
          <option value="episode">TV episode</option>
          <option value="track">Music track</option>
        </select>
      </label>
      {kind === 'episode' && (
        <>
          <label>Series<input value={series} onChange={(event) => setSeries(event.target.value)} disabled={busy} /></label>
          <div className="manage-field-row">
            <label>Series year<input inputMode="numeric" value={seriesYear} onChange={(event) => setSeriesYear(event.target.value)} disabled={busy} /></label>
            <label>Season<input inputMode="numeric" value={seasonNumber} onChange={(event) => setSeasonNumber(event.target.value)} disabled={busy} /></label>
            <label>Episode<input inputMode="numeric" value={episodeNumber} onChange={(event) => setEpisodeNumber(event.target.value)} disabled={busy} /></label>
          </div>
        </>
      )}
      {kind === 'track' && (
        <>
          <label>Artist<input value={artist} onChange={(event) => setArtist(event.target.value)} disabled={busy} /></label>
          <label>Album<input value={album} onChange={(event) => setAlbum(event.target.value)} disabled={busy} /></label>
        </>
      )}
      <label>{kind === 'episode' ? 'Episode title' : kind === 'track' ? 'Track title' : 'Title'}
        <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
      </label>
      {kind !== 'episode' && (
        <label>Year<input inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} disabled={busy} /></label>
      )}
      {kind === 'track' && (
        <div className="manage-field-row">
          <label>Disc<input inputMode="numeric" value={discNumber} onChange={(event) => setDiscNumber(event.target.value)} disabled={busy} /></label>
          <label>Track<input inputMode="numeric" value={trackNumber} onChange={(event) => setTrackNumber(event.target.value)} disabled={busy} /></label>
        </div>
      )}
      <label>Description<textarea value={synopsis} onChange={(event) => setSynopsis(event.target.value)} disabled={busy} rows={4} /></label>
      <label>Artwork<input type="file" accept="image/*" onChange={(event) => setArtwork(event.target.files?.[0])} disabled={busy} /></label>
      {error && <p className="manage-error">{error}</p>}
      <button className="primary-button" type="button" onClick={() => void save()} disabled={busy} data-tv-focusable="true">
        {busy ? 'Saving…' : 'Save manual metadata'}
      </button>
    </section>
  );
}

function UnmatchedReview({ item, api, catalogueApi, onResolved }: {
  item: UnmatchedFile;
  api: ManageApi;
  catalogueApi: CatalogueApi;
  onResolved: () => void;
}) {
  const [detail, setDetail] = useState<UnmatchedDetail>();
  const [matches, setMatches] = useState<ManageCatalogueMatch[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string>();

  const loadMatches = useCallback(async (search?: string) => {
    const result = await api.prospectiveMatches(item.id, search?.trim() || undefined);
    setMatches(result.matches);
    if (!search) setQuery(result.query);
  }, [api, item.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void Promise.all([api.unmatchedDetail(item.id), api.prospectiveMatches(item.id)])
      .then(([nextDetail, result]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setMatches(result.matches);
        setQuery(result.query);
      })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, item.id]);

  const resolve = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onResolved();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }, [onResolved]);

  if (loading) return <div className="manage-review"><p>Loading match details…</p></div>;

  return (
    <div className="manage-review">
      {error && <p className="manage-error">{error}</p>}
      {detail?.probes?.length ? (
        <div className="manage-probe-list">
          <span className="manage-label">Inferred from file</span>
          {detail.probes.slice(0, 4).map((candidate, index) => (
            <div key={`${candidate.generator}-${index}`} className="manage-probe">
              <strong>{candidateSummary(candidate)}</strong>
              <span>{candidate.generator} · score {candidate.score}</span>
            </div>
          ))}
        </div>
      ) : <p>No usable metadata could be inferred from the file.</p>}

      <section className="manage-match-section">
        <h3>Prospective matches</h3>
        <form className="manage-search-row" onSubmit={(event) => { event.preventDefault(); void loadMatches(query).catch((cause) => setError(errorMessage(cause))); }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search catalogue" />
          <button className="secondary-button" type="submit" disabled={busy} data-tv-focusable="true">Search</button>
        </form>
        {matches.length === 0 ? <p className="manage-muted">No existing catalogue items match this search.</p> : (
          <div className="manage-match-list">
            {matches.map((match) => (
              <div key={match.id} className="manage-match-row">
                <div><strong>{match.title}</strong><span>{matchSubtitle(match)}</span></div>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void resolve(() => api.match(item.id, match.id))} data-tv-focusable="true">Use match</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="manage-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void resolve(() => api.retry(item.id))} data-tv-focusable="true">Retry match</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setManualOpen((value) => !value)} data-tv-focusable="true">{manualOpen ? 'Hide manual metadata' : 'Enter manually'}</button>
        <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => {
          if (window.confirm(`Delete ${item.path} from MachaDFS? This removes the media file.`)) void resolve(() => api.deleteUnmatched(item.id));
        }} data-tv-focusable="true">Delete media file</button>
      </div>

      {manualOpen && detail && <ManualMetadataForm detail={detail} api={api} catalogueApi={catalogueApi} onResolved={onResolved} />}
    </div>
  );
}

function UnmatchedManager({ api, catalogueApi, onCountChange }: {
  api: ManageApi;
  catalogueApi: CatalogueApi;
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<UnmatchedFile[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setError(undefined);
    try {
      const next = await api.unmatched();
      setItems(next);
      onCountChange?.(next.length);
      setSelected((current) => current && next.some((item) => item.id === current) ? current : undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, onCountChange]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <p>Loading unmatched files…</p>;

  return (
    <section className="manage-panel">
      <div className="manage-panel-heading">
        <div><h2>Unmatched files</h2><p>Only files whose catalogue matching completed without a match appear here.</p></div>
        <button className="secondary-button" type="button" onClick={() => void reload()} data-tv-focusable="true">Refresh</button>
      </div>
      {error && <p className="manage-error">{error}</p>}
      {items.length === 0 ? <div className="manage-empty">No files need matching.</div> : (
        <div className="manage-unmatched-list">
          {items.map((item) => (
            <article key={item.id} className={`manage-unmatched-item${selected === item.id ? ' selected' : ''}`}>
              <div className="manage-unmatched-summary">
                <div className="manage-file-main">
                  <strong>{fileName(item.path)}</strong>
                  <code>{item.path}</code>
                  <span>{formatBytes(item.size)} · {item.provider ?? 'catalogue'} · {item.result}</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => setSelected(selected === item.id ? undefined : item.id)} data-tv-focusable="true">
                  {selected === item.id ? 'Close' : 'Review'}
                </button>
              </div>
              {selected === item.id && <UnmatchedReview item={item} api={api} catalogueApi={catalogueApi} onResolved={() => void reload()} />}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FileManager({ api }: { api: ManageApi }) {
  const [directory, setDirectory] = useState<MachaDfsDirectory>();
  const [selected, setSelected] = useState<MachaDfsEntry>();
  const [destination, setDestination] = useState('');
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(undefined);
    try {
      setDirectory(await api.browse(path));
      setSelected(undefined);
      setDestination('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void browse('/'); }, [browse]);

  const mutate = useCallback(async (action: () => Promise<void>, refreshPath: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await browse(refreshPath);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [browse]);

  if (loading && !directory) return <p>Loading MachaDFS…</p>;

  return (
    <section className="manage-panel">
      <div className="manage-panel-heading">
        <div><h2>MachaDFS</h2><p>Browse and modify the Macha Distributed File System namespace. Rename and move operations change namespace metadata; media extents remain in place.</p></div>
        <button className="secondary-button" type="button" onClick={() => directory && void browse(directory.path)} data-tv-focusable="true">Refresh</button>
      </div>
      {error && <p className="manage-error">{error}</p>}
      {directory && (
        <>
          <div className="manage-pathbar">
            <code>{directory.path}</code>
            {directory.parent && <button className="secondary-button" type="button" onClick={() => void browse(directory.parent!)} disabled={busy} data-tv-focusable="true">Up</button>}
          </div>
          <div className="manage-new-folder">
            <input placeholder="New folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} disabled={busy} />
            <button className="secondary-button" type="button" disabled={busy || !folderName.trim()} onClick={() => {
              const path = joinPath(directory.path, folderName.trim());
              void mutate(() => api.mkdir(path), directory.path).then(() => setFolderName(''));
            }} data-tv-focusable="true">Create folder</button>
          </div>
          <div className="manage-fs-list" role="list">
            {directory.entries.map((entry) => (
              <div key={entry.path} className={`manage-fs-row${selected?.path === entry.path ? ' selected' : ''}`} role="listitem">
                <button className="manage-fs-select" type="button" onClick={() => {
                  setSelected(entry);
                  setDestination(entry.path);
                }} data-tv-focusable="true">
                  <span className="manage-fs-icon" aria-hidden="true">{entry.type === 'directory' ? '▸' : '•'}</span>
                  <span><strong>{entry.name}</strong><small>{entry.type === 'directory' ? 'Folder' : `${formatBytes(entry.size)}${entry.catalogue_item_ids.length ? ' · catalogued' : ''}`}</small></span>
                </button>
                {entry.type === 'directory' && <button className="secondary-button" type="button" onClick={() => void browse(entry.path)} data-tv-focusable="true">Open</button>}
              </div>
            ))}
            {directory.entries.length === 0 && <div className="manage-empty">This folder is empty.</div>}
          </div>
          {selected && (
            <div className="manage-fs-operation">
              <h3>{selected.name}</h3>
              <label>New path
                <input value={destination} onChange={(event) => setDestination(event.target.value)} disabled={busy} />
              </label>
              <div className="manage-actions">
                <button className="primary-button" type="button" disabled={busy || !destination.trim() || destination === selected.path} onClick={() => void mutate(() => api.rename(selected.path, destination.trim()), directory.path)} data-tv-focusable="true">Move / rename</button>
                <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => {
                  const noun = selected.type === 'directory' ? 'empty folder' : 'file';
                  if (window.confirm(`Delete ${noun} ${selected.path} from MachaDFS?`)) void mutate(() => api.deletePath(selected.path), directory.path);
                }} data-tv-focusable="true">Delete</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ManageScreen({ api, catalogueApi, section, settings, managementAvailable, onUnmatchedCountChange }: Props) {
  return (
    <div className="manage-screen">
      <h1>Manage</h1>
      <div className="manage-tabs" role="tablist" aria-label="Management sections">
        {managementAvailable && <NavLink to={routes.manage} end role="tab" aria-selected={section === 'unmatched'} data-tv-focusable="true" className={section === 'unmatched' ? 'active' : undefined}>Unmatched</NavLink>}
        {managementAvailable && <NavLink to={routes.manageFiles} role="tab" aria-selected={section === 'files'} data-tv-focusable="true" className={section === 'files' ? 'active' : undefined}>Files</NavLink>}
        <NavLink to={routes.settings} role="tab" aria-selected={section === 'settings'} data-tv-focusable="true" className={section === 'settings' ? 'active' : undefined}>Settings</NavLink>
      </div>
      {section === 'settings'
        ? settings
        : section === 'files'
          ? <FileManager api={api} />
          : <UnmatchedManager api={api} catalogueApi={catalogueApi} onCountChange={onUnmatchedCountChange} />}
    </div>
  );
}
