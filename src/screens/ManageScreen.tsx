import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { routes } from '@machafoundation/core';
import { BulkActions, DetailCard, DetailHeader, Facts, ListHeading, Pager, runBulkOperation, SelectPageBox, SelectRowBox, useListSelection } from '../components/ListParts';
import { pageSlice } from '../lists/paging';
import { SortControl, SortHeader, useListSort } from '../components/ListSortControls';
import { sortRows, type ListSort, type SortKeyDef } from '../lists/listSort';
import { formatAge, formatBytes, formatTimestamp } from './ingest/format';
import { ConfirmModal, Modal } from '../components/Modal';
import { FileIcon, FolderIcon, OpenIcon, RefreshIcon, UpIcon } from '../components/ManageIcons';
import { AsyncIconButton } from '../components/AsyncIconButton';
import type { CatalogueApi } from '@machafoundation/core';
import type {
  MachaDfsDirectory,
  MachaDfsEntry,
  ManageApi,
  ManageCatalogueMatch,
  ManualMetadata,
  MediaProbeCandidate,
  UnmatchedDetail,
  UnmatchedFile,
} from '@machafoundation/core';
import { hintResultLabel, viewerErrorText } from '../text/viewerText';

export type ManageSection = 'unmatched' | 'files' | 'users';

interface Props {
  api: ManageApi;
  section: ManageSection;
  users: ReactNode;
}

function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function joinPath(parent: string, name: string): string {
  if (parent === '/') return `/${name}`;
  return `${parent.replace(/\/+$/, '')}/${name}`;
}

export function pathBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const names = path.split('/').filter(Boolean);
  return [
    { label: 'MachaDFS', path: '/' },
    ...names.map((label, index) => ({ label, path: `/${names.slice(0, index + 1).join('/')}` })),
  ];
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

/**
 * Whether an inferred candidate is already in the catalogue, and so has no
 * business being offered as something to type in by hand.
 *
 * The two lists on this screen answer different questions — "what do we think
 * this file is" and "what already exists that it could be" — and where they
 * overlap the first one is dead weight: the same identity appears twice, once
 * with a working "Use match" button and once without. The inferred list is
 * only useful for identities the catalogue does not have yet.
 *
 * Deliberately conservative. A field is only allowed to rule a candidate *out*
 * when both sides state it, so a match missing a year does not keep a probe
 * alive on a difference neither side actually claimed.
 */
function comparableTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameStatedNumber(left: number | null, right: number | null): boolean {
  return left == null || right == null || left === right;
}

export function candidateAlreadyCatalogued(
  candidate: MediaProbeCandidate,
  matches: readonly ManageCatalogueMatch[],
): boolean {
  const title = comparableTitle(candidate.title);
  if (!title) return false;
  return matches.some((match) => match.kind === candidate.kind
    && comparableTitle(match.title) === title
    && sameStatedNumber(match.year, candidate.year)
    && sameStatedNumber(match.season_number, candidate.season_number)
    && sameStatedNumber(match.episode_number, candidate.episode_number)
    && sameStatedNumber(match.track_number, candidate.track_number));
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

function ManualMetadataForm({ detail, probe, api, catalogueApi, onResolved }: {
  detail: UnmatchedDetail;
  /** The inferred candidate to seed from. The best-scoring one unless the reader picked another. */
  probe?: MediaProbeCandidate;
  api: ManageApi;
  catalogueApi: CatalogueApi;
  onResolved: () => void;
}) {
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
      setError(viewerErrorText(cause));
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

type UnmatchedSortKey = 'updated' | 'name' | 'size' | 'result' | 'attempts';

const UNMATCHED_SORT_KEYS: readonly SortKeyDef<UnmatchedSortKey>[] = [
  { key: 'updated', label: 'Last attempt', direction: 'desc' },
  { key: 'name', label: 'Name', direction: 'asc' },
  { key: 'size', label: 'Size', direction: 'desc' },
  { key: 'result', label: 'Result', direction: 'asc' },
  { key: 'attempts', label: 'Attempts', direction: 'desc' },
];

const DEFAULT_UNMATCHED_SORT: ListSort<UnmatchedSortKey> = { key: 'updated', direction: 'desc' };

function unmatchedSortValue(item: UnmatchedFile, key: UnmatchedSortKey): number | string | undefined {
  switch (key) {
    case 'updated': return item.updated_unix_ms || undefined;
    case 'name': return fileName(item.path) || undefined;
    case 'size': return item.size > 0 ? item.size : undefined;
    case 'result': return item.result || undefined;
    case 'attempts': return item.attempts;
  }
}

/** The unmatched files in the order asked for, stable for the same files. */
export function sortUnmatched(items: readonly UnmatchedFile[], sort: ListSort<UnmatchedSortKey>): UnmatchedFile[] {
  return sortRows(items, sort, unmatchedSortValue, (item) => fileName(item.path), (item) => item.id);
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '/';
}

/**
 * The unmatched files as a list in the torrent list's style: one slim row per
 * file, sortable by column, the order kept in the address, and each file on
 * its own page. Selection and the bulk retry and delete stay, since this is
 * the page where many files are dealt with at once.
 */
function UnmatchedManager({ api }: { api: ManageApi }) {
  const navigate = useNavigate();
  const { sort, setSort, sortBy, page, setPage, search } = useListSort(UNMATCHED_SORT_KEYS, DEFAULT_UNMATCHED_SORT);
  const [items, setItems] = useState<UnmatchedFile[]>([]);
  const selection = useListSelection(items);
  const { checked } = selection;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setError(undefined);
    try {
      const next = await api.unmatched();
      setItems(next);
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const retryChecked = useCallback(async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    setError(undefined);
    const failed = await runBulkOperation(ids, (id) => api.retry(id));
    await reload();
    if (failed) setError(`${failed} of ${ids.length} files could not be queued for matching.`);
    setBusy(false);
  }, [api, checked, reload]);

  const deleteChecked = useCallback(async () => {
    const ids = deleteIds;
    if (ids.length === 0) return;
    setBusy(true);
    setError(undefined);
    const failed = await runBulkOperation(ids, (id) => api.deleteUnmatched(id));
    setDeleteIds([]);
    await reload();
    if (failed) setError(`${failed} of ${ids.length} files could not be deleted.`);
    setBusy(false);
  }, [api, deleteIds, reload]);

  const sorted = useMemo(() => sortUnmatched(items, sort), [items, sort]);
  const paged = pageSlice(sorted, page);
  const rows = paged.items;
  const now = Date.now();

  if (loading) return <p className="ingest-loading">Loading unmatched files…</p>;

  /** The whole row opens the file, except where a control inside it was the target. */
  const openRow = (event: MouseEvent<HTMLTableRowElement>, item: UnmatchedFile) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, label')) return;
    navigate(`${routes.manageUnmatchedFile(item.id)}${search}`);
  };

  return (
    <section className="unmatched-list" aria-labelledby="unmatched-heading">
      <ListHeading id="unmatched-heading" title="Unmatched files" count={items.length}>
        <div className="list-heading-controls">
          <SortControl keys={UNMATCHED_SORT_KEYS} sort={sort} onChange={setSort} />
          <AsyncIconButton label="Refresh unmatched files" busy={refreshing} disabled={busy} onClick={() => void refresh()} icon={<RefreshIcon />} />
        </div>
      </ListHeading>
      <p className="list-note">Files whose catalogue matching finished without a match.</p>
      {error && <p className="manage-error">{error}</p>}
      <BulkActions label="Selected unmatched file actions" selection={selection} disabled={busy}>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void retryChecked()} data-tv-focusable="true">Retry matching</button>
        <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => setDeleteIds([...checked])} data-tv-focusable="true">Delete files</button>
      </BulkActions>
      {items.length === 0 ? <p className="list-empty">No files need matching.</p> : (
        <div className="data-table-scroll">
          <table className="data-table unmatched-table" aria-labelledby="unmatched-heading">
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <SelectPageBox ids={rows.map((item) => item.id)} selection={selection} disabled={busy} />
                </th>
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={sortBy} className="col-name" />
                <th scope="col" className="col-folder col-optional">Folder</th>
                <SortHeader label="Size" sortKey="size" sort={sort} onSort={sortBy} className="col-size" />
                <SortHeader label="Result" sortKey="result" sort={sort} onSort={sortBy} className="col-status" />
                <th scope="col" className="col-provider col-optional">Provider</th>
                <SortHeader label="Attempts" sortKey="attempts" sort={sort} onSort={sortBy} className="col-attempts col-optional" />
                <SortHeader label="Last attempt" sortKey="updated" sort={sort} onSort={sortBy} className="col-added col-optional" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const name = fileName(item.path);
                return (
                  <tr key={item.id} className={checked.has(item.id) ? 'selected' : undefined} onClick={(event) => openRow(event, item)}>
                    <td className="col-check">
                      <SelectRowBox id={item.id} name={name} selection={selection} disabled={busy} />
                    </td>
                    <td className="col-name">
                      <Link to={`${routes.manageUnmatchedFile(item.id)}${search}`} data-tv-focusable="true" title={item.path}>{name}</Link>
                    </td>
                    <td className="col-folder col-optional" title={folderOf(item.path)}>{folderOf(item.path)}</td>
                    <td className="col-size">{formatBytes(item.size)}</td>
                    <td className="col-status">{hintResultLabel(item.result)}</td>
                    <td className="col-provider col-optional">{item.provider ?? 'catalogue'}</td>
                    <td className="col-attempts col-optional">{item.attempts}</td>
                    <td className="col-added col-optional" title={formatTimestamp(item.updated_unix_ms)}>{formatAge(item.updated_unix_ms, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager label="Unmatched files pages" {...paged} total={sorted.length} onPage={setPage} />
      <ConfirmModal
        open={deleteIds.length > 0}
        title={deleteIds.length === 1 ? 'Delete media file?' : `Delete ${deleteIds.length} media files?`}
        confirmLabel={deleteIds.length === 1 ? 'Delete file' : 'Delete files'}
        destructive
        busy={busy}
        onCancel={() => setDeleteIds([])}
        onConfirm={() => void deleteChecked()}
      >
        <p>This permanently removes {deleteIds.length === 1 ? 'the selected file' : 'the selected files'} from MachaDFS.</p>
      </ConfirmModal>
    </section>
  );
}

/**
 * One unmatched file's own page, in the torrent page's style: what the file
 * is, what the probes inferred that is not yet in the catalogue, the
 * catalogue items it might be, and the manual form. Whatever resolves it
 * (a match, a retry, a new entry, deletion) returns to the list.
 */
export function UnmatchedFilePage({ api, catalogueApi }: { api: ManageApi; catalogueApi: CatalogueApi }) {
  const { fileId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const back = `${routes.manageUnmatched}${search}`;
  const [detail, setDetail] = useState<UnmatchedDetail>();
  const [matches, setMatches] = useState<ManageCatalogueMatch[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualProbeIndex, setManualProbeIndex] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string>();
  const manualFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (manualOpen) manualFormRef.current?.scrollIntoView({ block: 'nearest' });
  }, [manualOpen, manualProbeIndex]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void Promise.all([api.unmatchedDetail(fileId), api.prospectiveMatches(fileId)])
      .then(([nextDetail, result]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setMatches(result.matches);
        setQuery(result.query);
      })
      .catch((cause) => { if (!cancelled) setError(viewerErrorText(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, fileId]);

  const resolve = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      navigate(back);
    } catch (cause) {
      setError(viewerErrorText(cause));
      setBusy(false);
    }
  }, [back, navigate]);

  const searchMatches = async () => {
    try {
      const result = await api.prospectiveMatches(fileId, query.trim() || undefined);
      setMatches(result.matches);
    } catch (cause) {
      setError(viewerErrorText(cause));
    }
  };

  const backLink = <Link className="back-button" to={back} data-tv-focusable="true">← Unmatched</Link>;
  if (!detail) {
    return (
      <section className="manage-screen detail-screen">
        {backLink}
        {error && <p className="manage-error" role="alert">{error}</p>}
        {loading ? <p className="ingest-loading">Loading file…</p> : !error && <p className="list-empty">This file is no longer unmatched.</p>}
      </section>
    );
  }

  const { item } = detail;
  // Indices are kept alongside, because the manual form is seeded by index
  // into the unfiltered probe list.
  const newCandidates = detail.probes
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !candidateAlreadyCatalogued(candidate, matches))
    .slice(0, 4);
  const now = Date.now();

  return (
    <section className="manage-screen detail-screen">
      {backLink}
      <DetailHeader
        kicker={hintResultLabel(item.result)}
        title={fileName(item.path)}
        actions={(
          <div className="detail-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void resolve(() => api.retry(item.id))} data-tv-focusable="true">Retry match</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setManualOpen((value) => !value)} data-tv-focusable="true">{manualOpen ? 'Hide manual entry' : 'Enter manually'}</button>
            <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => setDeleteOpen(true)} data-tv-focusable="true">Delete file</button>
          </div>
        )}
      />
      {error && <p className="manage-error" role="alert">{error}</p>}

      <DetailCard id="unmatched-file-heading" title="File">
        <Facts rows={[
          ['Path', <code>{item.path}</code>],
          ['Size', formatBytes(item.size)],
          ['Provider', item.provider ?? 'catalogue'],
          ['Result', hintResultLabel(item.result)],
          ['Attempts', String(item.attempts)],
          ['Last attempt', `${formatTimestamp(item.updated_unix_ms)} (${formatAge(item.updated_unix_ms, now)})`],
          ...(item.media_id ? [['Media', <code>{item.media_id}</code>] as const] : []),
        ]} />
      </DetailCard>

      <div className="unmatched-choices">
        <DetailCard id="unmatched-candidates-heading" title="Not in the catalogue">
          {detail.probes.length === 0
            ? <p className="list-note">No usable metadata could be inferred from the file.</p>
            : newCandidates.length === 0
              ? <p className="list-note">Everything inferred from the file is already in the catalogue: use a match.</p>
              : (
                <div className="manage-probe-list">
                  <p className="list-note">Choose one to create it in the catalogue.</p>
                  {newCandidates.map(({ candidate, index }) => (
                    <button
                      key={`${candidate.generator}-${index}`}
                      type="button"
                      className={`manage-probe ${manualOpen && manualProbeIndex === index ? 'chosen' : ''}`}
                      data-tv-focusable="true"
                      aria-pressed={manualOpen && manualProbeIndex === index}
                      disabled={busy}
                      onClick={() => { setManualProbeIndex(index); setManualOpen(true); }}
                    >
                      <strong>{candidateSummary(candidate)}</strong>
                      <span>{candidate.generator} · score {candidate.score}</span>
                    </button>
                  ))}
                </div>
              )}
        </DetailCard>

        <DetailCard id="unmatched-matches-heading" title="Prospective matches">
          <form className="manage-search-row" onSubmit={(event) => { event.preventDefault(); void searchMatches(); }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search catalogue" />
            <button className="secondary-button" type="submit" disabled={busy} data-tv-focusable="true">Search</button>
          </form>
          {matches.length === 0 ? <p className="list-note">No existing catalogue items match this search.</p> : (
            <div className="manage-match-list">
              {matches.map((match) => (
                <div key={match.id} className="manage-match-row">
                  <div><strong>{match.title}</strong><span>{matchSubtitle(match)}</span></div>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => void resolve(() => api.match(item.id, match.id))} data-tv-focusable="true">Use match</button>
                </div>
              ))}
            </div>
          )}
        </DetailCard>
      </div>

      {manualOpen && (
        // Keyed on the candidate: the form seeds its fields from it once, at
        // mount, so choosing another has to build a new form rather than leave
        // the first one's values sitting in it. Scrolled to on open because it
        // renders below the cards, and choosing a candidate above and seeing
        // nothing move reads as a button that does nothing.
        <div ref={manualFormRef}>
          <DetailCard id="unmatched-manual-heading" title="Enter manually">
            <ManualMetadataForm
              key={`manual-${manualProbeIndex}`}
              detail={detail}
              probe={detail.probes[manualProbeIndex]}
              api={api}
              catalogueApi={catalogueApi}
              onResolved={() => navigate(back)}
            />
          </DetailCard>
        </div>
      )}

      <ConfirmModal
        open={deleteOpen}
        title="Delete media file?"
        confirmLabel="Delete file"
        destructive
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => { setDeleteOpen(false); void resolve(() => api.deleteUnmatched(item.id)); }}
      >
        <p>This permanently removes the file from MachaDFS.</p>
      </ConfirmModal>
    </section>
  );
}

function FileManager({ api }: { api: ManageApi }) {
  const [directory, setDirectory] = useState<MachaDfsDirectory>();
  const [selected, setSelected] = useState<MachaDfsEntry>();
  const [destination, setDestination] = useState('');
  const [folderName, setFolderName] = useState('');
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
      setError(viewerErrorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void browse('/'); }, [browse]);

  const mutate = useCallback(async (action: () => Promise<void>, refreshPath: string): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await browse(refreshPath);
      return true;
    } catch (cause) {
      setError(viewerErrorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, [browse]);

  if (loading && !directory) return <p>Loading MachaDFS…</p>;

  return (
    <section className="manage-panel">
      <div className="manage-panel-heading">
        <div><h2>MachaDFS</h2><p>Browse and modify the Macha Distributed File System namespace. Rename and move operations change namespace metadata; media extents remain in place.</p></div>
        <AsyncIconButton label="Refresh folder" busy={loading} disabled={busy || !directory} onClick={() => directory && void browse(directory.path)} icon={<RefreshIcon />} />
      </div>
      {error && <p className="manage-error">{error}</p>}
      {directory && (
        <>
          <div className="manage-pathbar">
            <nav className="manage-breadcrumbs" aria-label="MachaDFS path">
              {pathBreadcrumbs(directory.path).map((segment, index, segments) => <span key={segment.path}>
                {index > 0 && <span className="manage-path-separator" aria-hidden="true">/</span>}
                {index === segments.length - 1
                  ? <span aria-current="page">{segment.label}</span>
                  : <a href={`?path=${encodeURIComponent(segment.path)}`} onClick={(event) => { event.preventDefault(); void browse(segment.path); }}>{segment.label}</a>}
              </span>)}
            </nav>
            <div className="manage-path-actions">
              {directory.parent && <button className="secondary-button manage-icon-button" type="button" onClick={() => void browse(directory.parent!)} disabled={busy} aria-label="Up one folder" title="Up" data-tv-focusable="true"><UpIcon /></button>}
              <button className="secondary-button" type="button" onClick={() => setCreateFolderOpen(true)} disabled={busy} data-tv-focusable="true">Create folder</button>
            </div>
          </div>
          <div className="manage-fs-list" role="list">
            {directory.entries.map((entry) => (
              <div key={entry.path} className={`manage-fs-row${selected?.path === entry.path ? ' selected' : ''}`} role="listitem">
                <button className="manage-fs-select" type="button" onClick={() => {
                  setSelected(entry);
                  setDestination(entry.path);
                }} data-tv-focusable="true">
                  <span className="manage-fs-icon" aria-hidden="true">{entry.type === 'directory' ? <FolderIcon /> : <FileIcon />}</span>
                  <span><strong>{entry.name}</strong><small>{entry.type === 'directory' ? 'Folder' : `${formatBytes(entry.size)}${entry.catalogue_item_ids.length ? ' · catalogued' : ''}`}</small></span>
                </button>
                {entry.type === 'directory' && <button className="secondary-button manage-icon-button" type="button" onClick={() => void browse(entry.path)} aria-label={`Open ${entry.name}`} title="Open" data-tv-focusable="true"><OpenIcon /></button>}
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
                <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => setDeleteOpen(true)} data-tv-focusable="true">Delete</button>
              </div>
            </div>
          )}
          <Modal
            open={createFolderOpen}
            title="Create folder"
            onClose={busy ? () => undefined : () => { setCreateFolderOpen(false); setFolderName(''); }}
            actions={<>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => { setCreateFolderOpen(false); setFolderName(''); }} data-tv-focusable="true">Cancel</button>
              <button className="primary-button" type="button" disabled={busy || !folderName.trim()} onClick={() => {
                const path = joinPath(directory.path, folderName.trim());
                void mutate(() => api.mkdir(path), directory.path).then((created) => {
                  if (created) { setCreateFolderOpen(false); setFolderName(''); }
                });
              }} data-tv-focusable="true">{busy ? 'Creating…' : 'Create'}</button>
            </>}
          >
            <label className="modal-field">Folder name
              <input value={folderName} onChange={(event) => setFolderName(event.target.value)} disabled={busy} onKeyDown={(event) => {
                if (event.key === 'Enter' && folderName.trim() && !busy) {
                  const path = joinPath(directory.path, folderName.trim());
                  void mutate(() => api.mkdir(path), directory.path).then((created) => {
                    if (created) { setCreateFolderOpen(false); setFolderName(''); }
                  });
                }
              }} />
            </label>
          </Modal>
          <ConfirmModal
            open={deleteOpen && Boolean(selected)}
            title={`Delete ${selected?.type === 'directory' ? 'folder' : 'file'}?`}
            confirmLabel={selected?.type === 'directory' ? 'Delete folder' : 'Delete file'}
            destructive
            busy={busy}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={() => {
              if (!selected) return;
              void mutate(() => api.deletePath(selected.path), directory.path).then((deleted) => {
                if (deleted) setDeleteOpen(false);
              });
            }}
          >
            <p><code>{selected?.path}</code> will be removed from MachaDFS. A non-empty folder may be rejected by the server.</p>
          </ConfirmModal>
        </>
      )}
    </section>
  );
}

export function ManageScreen({ api, section, users }: Props) {
  return (
    <div className={`manage-screen manage-screen-${section}`}>
      <h1>Manage</h1>
      {section === 'users'
        ? users
        : section === 'files'
          ? <FileManager api={api} />
          : <UnmatchedManager api={api} />}
    </div>
  );
}
