import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  identifyUnmatched,
  manualFromCandidate,
  routes,
  type CatalogueApi,
  type CatalogueItem,
  type CatalogueKind,
  type Identification,
  type ManageApi,
  type ManageCatalogueMatch,
  type ManualMetadata,
  type MediaProbeCandidate,
  type UnmatchedDetail,
} from '@machafoundation/core';
import { DetailCard, DetailHeader, Facts } from '../../components/ListParts';
import { ConfirmModal } from '../../components/Modal';
import { fileName, formatAge, formatBytes, formatTimestamp } from '../ingest/format';
import { hintResultLabel, viewerErrorText } from '../../text/viewerText';
import { NumberField, TextAreaField, TextField, wholeNumber } from './fields';
import { ParentPicker } from './ParentPicker';
import { likelyKind, ProviderMatch } from './ProviderMatch';

type ManualKind = ManualMetadata['kind'];

export function candidateSummary(candidate: MediaProbeCandidate): string {
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
 * business being offered as something to create.
 *
 * The two lists on this screen answer different questions — "what do we think
 * this file is" and "what already exists that it could be" — and where they
 * overlap the first one is dead weight: the same identity appears twice, once
 * matched and once to be created a second time. Deliberately conservative: a
 * field only rules a candidate out when both sides state it.
 */
function comparableTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameStatedNumber(left: number | null, right: number | null): boolean {
  return left == null || right == null || left === right;
}

export function candidateAlreadyCatalogued(candidate: MediaProbeCandidate, matches: readonly ManageCatalogueMatch[]): boolean {
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
  if (match.media_ids.length > 0) parts.push(match.media_ids.length === 1 ? '1 file' : `${match.media_ids.length} files`);
  return parts.join(' · ');
}

/** The image a catalogue item shows: its own, else the one the server resolves for it (an album's for a track). */
function displayArtworkUrl(item: CatalogueItem | undefined): string | undefined {
  if (!item) return undefined;
  const all = [...item.artwork, ...(item.effective_artwork ?? [])];
  const pick = (role: string) => all.find((art) => art.role === role && art.url)?.url;
  return pick('poster') ?? pick('thumbnail') ?? pick('cover') ?? all.find((art) => art.url)?.url;
}

/** The roles the server's own cataloguer uses for each kind's picture. */
const ARTWORK_ROLE: Record<ManualKind, string> = { movie: 'poster', episode: 'still', track: 'cover' };

/**
 * Manual entry: the kind's fields, seeded from a candidate when one was being
 * reviewed, and artwork uploaded to what it creates. Applied through core,
 * which routes it. A series, artist or album chosen from the catalogue is
 * sent by id, so the file joins the hierarchy already there; one only typed
 * is sent by name, and the server finds or creates it.
 */
function ManualEntry({ detail, probe, manage, catalogue, onResolved }: {
  detail: UnmatchedDetail;
  probe?: MediaProbeCandidate;
  manage: ManageApi;
  catalogue: CatalogueApi;
  onResolved: () => void;
}) {
  const [kind, setKind] = useState<ManualKind>(() => likelyKind(detail, probe));
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
  const [seriesItem, setSeriesItem] = useState<CatalogueItem>();
  const [artistItem, setArtistItem] = useState<CatalogueItem>();
  const [albumItem, setAlbumItem] = useState<CatalogueItem>();
  const [artwork, setArtwork] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** What the form says, or a sentence for what it is missing. */
  const metadata = (): ManualMetadata | string => {
    if (kind === 'movie') return { kind, title: title.trim(), year: wholeNumber(year), synopsis: synopsis.trim() || undefined };
    if (kind === 'episode') {
      const season = wholeNumber(seasonNumber);
      const episode = wholeNumber(episodeNumber);
      if (season == null || episode == null) return 'Season and episode numbers are required.';
      return {
        kind,
        ...(seriesItem ? { series_id: seriesItem.id } : { series: series.trim(), series_year: wholeNumber(seriesYear) }),
        season_number: season,
        episode_number: episode,
        title: title.trim() || undefined,
        synopsis: synopsis.trim() || undefined,
      };
    }
    if (artistItem && !albumItem && !album.trim()) return 'Choose one of the artist\'s albums, or name a new one.';
    return {
      kind,
      ...(albumItem ? { album_id: albumItem.id }
        : artistItem ? { artist_id: artistItem.id, album: album.trim() }
          : { artist: artist.trim(), album: album.trim() }),
      title: title.trim(),
      year: wholeNumber(year),
      disc_number: wholeNumber(discNumber),
      track_number: wholeNumber(trackNumber),
      synopsis: synopsis.trim() || undefined,
    };
  };

  const findIn = (kinds: CatalogueKind[]) => (query: string) => catalogue.search(query, 8, undefined, { kinds });

  const save = async () => {
    const entered = metadata();
    if (typeof entered === 'string') {
      setError(entered);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const applied = await identifyUnmatched(manage, detail.item.id, { from: 'manual', metadata: entered });
      if (artwork && applied.applied === 'created') {
        await catalogue.putArtwork(applied.result.leaf_item_id, ARTWORK_ROLE[kind], artwork.type || 'image/jpeg', artwork);
      }
      onResolved();
    } catch (cause) {
      setError(viewerErrorText(cause));
      setBusy(false);
    }
  };

  return (
    <form className="manage-manual-form" aria-label="Manual catalogue metadata" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>Type
        <select value={kind} onChange={(event) => setKind(event.target.value as ManualKind)} disabled={busy} data-tv-focusable="true">
          <option value="movie">Movie</option>
          <option value="episode">TV episode</option>
          <option value="track">Music track</option>
        </select>
      </label>
      {kind === 'episode' && (
        <>
          <ParentPicker label="Series in the catalogue" find={findIn(['show'])} chosen={seriesItem} onChoose={setSeriesItem} disabled={busy} />
          {!seriesItem && <TextField label="Series" value={series} onChange={setSeries} disabled={busy} />}
          <div className="manage-field-row">
            {!seriesItem && <NumberField label="Series year" value={seriesYear} onChange={setSeriesYear} disabled={busy} />}
            <NumberField label="Season" value={seasonNumber} onChange={setSeasonNumber} disabled={busy} />
            <NumberField label="Episode" value={episodeNumber} onChange={setEpisodeNumber} disabled={busy} />
          </div>
        </>
      )}
      {kind === 'track' && (
        <>
          <ParentPicker label="Artist in the catalogue" find={findIn(['artist'])} chosen={artistItem} onChoose={(item) => { setArtistItem(item); setAlbumItem(undefined); }} disabled={busy} />
          {!artistItem && <TextField label="Artist" value={artist} onChange={setArtist} disabled={busy} />}
          {/* An artist chosen offers its albums; keyed on it, so another artist reads afresh. */}
          {artistItem && <ParentPicker key={artistItem.id} label="Album in the catalogue" browse find={() => catalogue.list('album', artistItem.id)} chosen={albumItem} onChoose={setAlbumItem} disabled={busy} />}
          {!albumItem && <TextField label={artistItem ? 'Or a new album' : 'Album'} value={album} onChange={setAlbum} disabled={busy} />}
        </>
      )}
      <TextField label={kind === 'episode' ? 'Episode title' : kind === 'track' ? 'Track title' : 'Title'} value={title} onChange={setTitle} disabled={busy} />
      {kind !== 'episode' && <NumberField label="Year" value={year} onChange={setYear} disabled={busy} />}
      {kind === 'track' && (
        <div className="manage-field-row">
          <NumberField label="Disc" value={discNumber} onChange={setDiscNumber} disabled={busy} />
          <NumberField label="Track" value={trackNumber} onChange={setTrackNumber} disabled={busy} />
        </div>
      )}
      <TextAreaField label="Description" value={synopsis} onChange={setSynopsis} disabled={busy} />
      <label>Artwork<input type="file" accept="image/*" onChange={(event) => setArtwork(event.target.files?.[0])} disabled={busy} data-tv-focusable="true" /></label>
      {error && <p className="manage-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy} data-tv-focusable="true">
        {busy ? 'Saving…' : 'Save and create'}
      </button>
    </form>
  );
}

type Tab = 'candidates' | 'search' | 'provider' | 'manual';

/**
 * One unmatched file: what it is, and four ways to say what it should be —
 * one of the candidates inferred from it, an item already in the catalogue
 * (which gains it as another version if it has files), a record found at the
 * metadata provider, or metadata entered by hand. Every one is applied through core's `identifyUnmatched`, which routes
 * it; this screen calls no match or manual route itself. Whatever resolves the
 * file returns to the list.
 */
export function UnmatchedFilePage({ api, catalogueApi }: { api: ManageApi; catalogueApi: CatalogueApi }) {
  const { fileId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const back = `${routes.manageUnmatched}${search}`;
  const [detail, setDetail] = useState<UnmatchedDetail>();
  const [matches, setMatches] = useState<ManageCatalogueMatch[]>([]);
  const [matchItems, setMatchItems] = useState<Record<string, CatalogueItem>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('candidates');
  const [reviewing, setReviewing] = useState<number>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string>();

  const showMatches = useCallback((next: ManageCatalogueMatch[]) => {
    setMatches(next);
    // The match list carries no artwork URLs; the catalogue's own record of
    // each does. Read alongside, and a match without one simply shows none.
    void Promise.all(next.map((match) => catalogueApi.get(match.id).then((item) => [match.id, item] as const, () => undefined)))
      .then((entries) => setMatchItems(Object.fromEntries(entries.filter((entry): entry is readonly [string, CatalogueItem] => Boolean(entry)))));
  }, [catalogueApi]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void Promise.all([api.unmatchedDetail(fileId), api.prospectiveMatches(fileId)])
      .then(([nextDetail, result]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        showMatches(result.matches);
        setQuery(result.query);
      })
      .catch((cause) => { if (!cancelled) setError(viewerErrorText(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, fileId, showMatches]);

  const resolve = useCallback(async (action: () => Promise<unknown>) => {
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

  const apply = (identification: Identification) => resolve(() => identifyUnmatched(api, fileId, identification));

  const searchMatches = async () => {
    try {
      const result = await api.prospectiveMatches(fileId, query.trim() || undefined);
      showMatches(result.matches);
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
  const candidates = detail.probes
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !candidateAlreadyCatalogued(candidate, matches))
    .slice(0, 4);
  const now = Date.now();
  const review = (index: number) => { setReviewing(index); setTab('manual'); };
  const tabs: ReadonlyArray<readonly [Tab, string]> = [['candidates', 'Candidates'], ['search', 'Search the catalogue'], ['provider', 'Search online'], ['manual', 'Enter manually']];
  const reviewed = reviewing === undefined ? detail.probes[0] : detail.probes[reviewing];

  return (
    <section className="manage-screen detail-screen">
      {backLink}
      <DetailHeader
        kicker={hintResultLabel(item.result)}
        title={fileName(item.path)}
        actions={(
          <div className="detail-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void resolve(() => api.retry(item.id))} data-tv-focusable="true">Retry match</button>
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

      <section className="detail-card identify-panel" aria-labelledby="identify-heading">
        <h2 id="identify-heading">Identify this file</h2>
        <div className="identify-tabs" role="tablist" aria-label="Ways to identify this file">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" id={`identify-tab-${key}`} aria-selected={tab === key} aria-controls={`identify-${key}`} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)} data-tv-focusable="true">{label}</button>
          ))}
        </div>

        {tab === 'candidates' && (
          <div role="tabpanel" id="identify-candidates" aria-labelledby="identify-tab-candidates">
            {detail.probes.length === 0
              ? <p className="list-note">No usable metadata could be inferred from the file. Search the catalogue or enter it manually.</p>
              : candidates.length === 0
                ? <p className="list-note">Everything inferred from the file is already in the catalogue: search the catalogue to add it there.</p>
                : (
                  <ul className="identify-candidates">
                    {candidates.map(({ candidate, index }) => {
                      // Core decides whether a candidate says enough to create
                      // it as it stands; one that does not is reviewed first.
                      const complete = manualFromCandidate(candidate) !== undefined;
                      return (
                        <li key={`${candidate.generator}-${index}`}>
                          <div><strong>{candidateSummary(candidate)}</strong><span>{candidate.kind} · {candidate.generator} · score {candidate.score}</span></div>
                          <div className="identify-actions">
                            <button className="secondary-button" type="button" disabled={busy} onClick={() => review(index)} data-tv-focusable="true">Review</button>
                            {complete && <button className="primary-button" type="button" disabled={busy} onClick={() => void apply({ from: 'candidate', probe: candidate })} data-tv-focusable="true">Create</button>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
          </div>
        )}

        {tab === 'search' && (
          <div role="tabpanel" id="identify-search" aria-labelledby="identify-tab-search">
            <form className="manage-search-row" onSubmit={(event) => { event.preventDefault(); void searchMatches(); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search the catalogue" data-tv-focusable="true" />
              <button className="secondary-button" type="submit" disabled={busy} data-tv-focusable="true">Search</button>
            </form>
            {matches.length === 0 ? <p className="list-note">No existing catalogue items match this search.</p> : (
              <ul className="identify-matches">
                {matches.map((match) => {
                  const art = displayArtworkUrl(matchItems[match.id]);
                  return (
                    <li key={match.id}>
                      <span className="identify-art" aria-hidden="true">{art ? <img src={art} alt="" loading="lazy" /> : null}</span>
                      <div><strong>{match.title}</strong><span>{matchSubtitle(match)}</span></div>
                      {/* An item that already has a file gains this one beside it, as another version;
                          the server never replaces what the item holds. */}
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => void apply({ from: 'catalogue', catalogueItemId: match.id })} data-tv-focusable="true">
                        {match.media_ids.length > 0 ? 'Add as another version' : 'Use this'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === 'provider' && (
          <div role="tabpanel" id="identify-provider" aria-labelledby="identify-tab-provider">
            <ProviderMatch detail={detail} probe={reviewed} manage={api} onResolved={() => navigate(back)} />
          </div>
        )}

        {tab === 'manual' && (
          <div role="tabpanel" id="identify-manual" aria-labelledby="identify-tab-manual">
            {/* Keyed on the candidate under review: the form seeds its fields
                once, at mount, so reviewing another builds a new form. */}
            <ManualEntry
              key={`manual-${reviewing ?? 'blank'}`}
              detail={detail}
              probe={reviewed}
              manage={api}
              catalogue={catalogueApi}
              onResolved={() => navigate(back)}
            />
          </div>
        )}
      </section>

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
