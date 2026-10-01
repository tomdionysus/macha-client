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
  type MediaProbeCandidate,
  type UnmatchedDetail,
} from '@machafoundation/core';
import { DetailCard, DetailHeader, Facts } from '../../components/ListParts';
import { ConfirmModal } from '../../components/Modal';
import { fileName, formatAge, formatBytes, formatTimestamp } from '../ingest/format';
import { hintResultLabel, viewerErrorText } from '../../text/viewerText';
import { applyCandidatePicture, findCandidatePictures, type CandidatePicture } from './candidatePicture';
import { ManualEntry } from './ManualEntry';
import { likelyKind, ProviderMatch } from './ProviderMatch';

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

const KIND_NAME: Record<CatalogueKind, string> = {
  movie: 'movie', show: 'series', season: 'season', episode: 'episode', artist: 'artist', album: 'album', track: 'track',
};

/**
 * What a catalogue search looks for, by what the file most likely is:
 * everything it could be filed under, then the item it could be another
 * version of. Each kind is its own search, so twenty remixes of a track
 * cannot crowd its album and artist out of one shared limit.
 */
const SEARCH_KINDS: Record<MediaProbeCandidate['kind'], CatalogueKind[]> = {
  movie: ['movie'],
  episode: ['season', 'show', 'episode'],
  track: ['album', 'artist', 'track'],
};
const PER_KIND = 8;

/** Kinds whose picture is a square cover, not a tall poster. */
const SQUARE_ART: ReadonlySet<CatalogueKind> = new Set(['artist', 'album', 'track']);

const GROUP_NAME: Record<CatalogueKind, string> = {
  movie: 'Movies', show: 'Series', season: 'Seasons', episode: 'Episodes', artist: 'Artists', album: 'Albums', track: 'Tracks',
};

type Found = ReadonlyArray<readonly [CatalogueKind, CatalogueItem[]]>;

/** What a search result offers: a playable item takes the file; a parent opens manual entry with itself chosen. */
const PLACE_UNDER: Partial<Record<CatalogueKind, string>> = {
  album: 'Add a track to this album', artist: 'Add a new album by this artist', show: 'Add an episode to this series', season: 'Add an episode to this season',
};

function matchSubtitle(match: CatalogueItem): string {
  const parts: string[] = [KIND_NAME[match.kind]];
  if (match.year != null) parts.push(String(match.year));
  if (match.season_number != null && match.episode_number != null) {
    parts.push(`S${String(match.season_number).padStart(2, '0')}E${String(match.episode_number).padStart(2, '0')}`);
  }
  if (match.media_ids?.length) parts.push(match.media_ids.length === 1 ? '1 file' : `${match.media_ids.length} files`);
  return parts.join(' · ');
}

/** The image a catalogue item shows: its own, else the one the server resolves for it (an album's for a track). */
function displayArtworkUrl(item: CatalogueItem | undefined): string | undefined {
  if (!item) return undefined;
  const all = [...item.artwork, ...(item.effective_artwork ?? [])];
  const pick = (role: string) => all.find((art) => art.role === role && art.url)?.url;
  return pick('poster') ?? pick('thumbnail') ?? pick('cover') ?? all.find((art) => art.url)?.url;
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
  const [query, setQuery] = useState('');
  const [suggested, setSuggested] = useState<string>();
  const [reloads, setReloads] = useState(0);
  // Each candidate's picture by its index: undefined while asked, null for none found.
  const [pictures, setPictures] = useState<Record<number, CandidatePicture | null>>({});
  const [found, setFound] = useState<Found>();
  const [parent, setParent] = useState<CatalogueItem>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('candidates');
  const [reviewing, setReviewing] = useState<number>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    // The page needs only the file. Both calls make the server probe it, and
    // the second can be slow, so the page does not wait for it.
    void api.unmatchedDetail(fileId)
      .then((nextDetail) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setPictures({});
        // Pictures arrive behind the page, each as the provider answers.
        findCandidatePictures(api, nextDetail.probes).forEach((found, index) => {
          void found.then((picture) => { if (!cancelled) setPictures((current) => ({ ...current, [index]: picture ?? null })); });
        });
      })
      .catch((cause) => { if (!cancelled) setError(viewerErrorText(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // The server's own match list, of leaf items only, says which candidates
    // are already catalogued, and its query seeds the search. Without it every
    // candidate is offered and the search starts empty: nothing to report.
    void api.prospectiveMatches(fileId)
      .then((result) => {
        if (cancelled) return;
        setMatches(result.matches);
        setSuggested(result.query);
        setQuery((typed) => typed || result.query);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, fileId, reloads]);

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

  /**
   * Create a candidate as it stands, with its picture when one was found. A
   * picture refused after the file is catalogued says so and stays, with
   * every action held: the file is no longer unmatched.
   */
  const create = async (candidate: MediaProbeCandidate, picture: CandidatePicture | undefined) => {
    setBusy(true);
    setError(undefined);
    let applied;
    try {
      applied = await identifyUnmatched(api, fileId, { from: 'candidate', probe: candidate });
    } catch (cause) {
      setError(viewerErrorText(cause));
      setBusy(false);
      return;
    }
    if (picture && applied.applied === 'created') {
      try {
        await applyCandidatePicture(api, picture, applied.result);
      } catch (cause) {
        setError(`Created, but the picture could not be used: ${viewerErrorText(cause)}`);
        return;
      }
    }
    navigate(back);
  };

  const fileKind = detail ? likelyKind(detail, detail.probes[0]) : undefined;
  const searchCatalogue = useCallback(async (words: string) => {
    if (!fileKind || !words.trim()) return;
    setError(undefined);
    try {
      const kinds = SEARCH_KINDS[fileKind];
      const results = await Promise.all(kinds.map((kind) => catalogueApi.search(words.trim(), PER_KIND, undefined, { kinds: [kind] })));
      setFound(kinds.map((kind, index) => [kind, results[index] ?? []] as const).filter(([, items]) => items.length > 0));
    } catch (cause) {
      setError(viewerErrorText(cause));
    }
  }, [catalogueApi, fileKind]);

  // The search runs once with the server's suggested words, when its tab is open and they have arrived.
  useEffect(() => {
    if (tab === 'search' && found === undefined && suggested) void searchCatalogue(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening the tab or the words arriving
  }, [tab, suggested]);

  const placeUnder = (item: CatalogueItem) => { setParent(item); setReviewing(undefined); setTab('manual'); };

  const backLink = <Link className="back-button" to={back} data-tv-focusable="true">← Unmatched</Link>;
  if (!detail) {
    return (
      <section className="manage-screen detail-screen">
        {backLink}
        {error && <p className="manage-error" role="alert">{error}</p>}
        {error && !loading && <button className="secondary-button" type="button" onClick={() => setReloads((count) => count + 1)} data-tv-focusable="true">Try again</button>}
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
  const review = (index: number) => { setReviewing(index); setParent(undefined); setTab('manual'); };
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
                          <span className={`identify-art${candidate.kind === 'track' ? ' identify-art-square' : ''}`} aria-hidden="true">
                            {pictures[index] ? <img src={pictures[index].option.preview_url} alt="" loading="lazy" /> : null}
                          </span>
                          <div><strong>{candidateSummary(candidate)}</strong><span>{candidate.kind} · {candidate.generator} · score {candidate.score}</span></div>
                          <div className="identify-actions">
                            <button className="secondary-button" type="button" disabled={busy} onClick={() => review(index)} data-tv-focusable="true">Review</button>
                            {complete && <button className="primary-button" type="button" disabled={busy} onClick={() => void create(candidate, pictures[index] ?? undefined)} data-tv-focusable="true">Create</button>}
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
            <form className="manage-search-row" onSubmit={(event) => { event.preventDefault(); void searchCatalogue(query); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search the catalogue" data-tv-focusable="true" />
              <button className="secondary-button" type="submit" disabled={busy} data-tv-focusable="true">Search</button>
            </form>
            {found?.length === 0 && <p className="list-note">Nothing in the catalogue matches this search.</p>}
            {found?.map(([kind, items]) => (
              <section key={kind} className="identify-group" aria-label={GROUP_NAME[kind]}>
                {found.length > 1 && <h3>{GROUP_NAME[kind]}</h3>}
                <ul className="identify-matches">
                  {items.map((match) => {
                    const art = displayArtworkUrl(match);
                    const under = PLACE_UNDER[match.kind];
                    return (
                      <li key={match.id}>
                        <span className={`identify-art${SQUARE_ART.has(match.kind) ? ' identify-art-square' : ''}`} aria-hidden="true">{art ? <img src={art} alt="" loading="lazy" /> : null}</span>
                        <div><strong>{match.title}</strong><span>{matchSubtitle(match)}</span></div>
                        {under
                          ? <button className="secondary-button" type="button" disabled={busy} onClick={() => placeUnder(match)} data-tv-focusable="true">{under}</button>
                          // An item that already has a file gains this one beside it, as another
                          // version; the server never replaces what the item holds.
                          : (
                            <button className="secondary-button" type="button" disabled={busy} onClick={() => void apply({ from: 'catalogue', catalogueItemId: match.id })} data-tv-focusable="true">
                              {match.media_ids?.length ? 'Add as another version' : 'Use this'}
                            </button>
                          )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {tab === 'provider' && (
          <div role="tabpanel" id="identify-provider" aria-labelledby="identify-tab-provider">
            <ProviderMatch detail={detail} probe={reviewed} manage={api} onResolved={() => navigate(back)} />
          </div>
        )}

        {tab === 'manual' && (
          <div role="tabpanel" id="identify-manual" aria-labelledby="identify-tab-manual">
            {/* Keyed on the candidate under review and the parent chosen: the form
                seeds its fields once, at mount, so either change builds a new form. */}
            <ManualEntry
              key={`manual-${reviewing ?? 'blank'}-${parent?.id ?? 'none'}`}
              detail={detail}
              probe={reviewed}
              picture={pictures[reviewing ?? 0] ?? undefined}
              parent={parent}
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
