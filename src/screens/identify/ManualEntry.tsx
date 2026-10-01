import { useState } from 'react';
import {
  identifyUnmatched,
  type CatalogueApi,
  type CatalogueItem,
  type CatalogueKind,
  type ManageApi,
  type ManualMetadata,
  type MediaProbeCandidate,
  type UnmatchedDetail,
} from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { applyCandidatePicture, pictureSource, type CandidatePicture } from './providerLookup';
import { NumberField, TextAreaField, TextField, wholeNumber } from './fields';
import { ParentPicker } from './ParentPicker';
import { likelyKind } from './ProviderMatch';

type ManualKind = ManualMetadata['kind'];

/** The roles the server's own cataloguer uses for each kind's picture. */
const ARTWORK_ROLE: Record<ManualKind, string> = { movie: 'poster', episode: 'still', track: 'cover' };

/**
 * Where a new episode or track goes: under something the catalogue already
 * holds, sent by id so the file joins that hierarchy, or under parents named
 * here, which the server finds or creates by name.
 */
export type Placement = 'album' | 'artist' | 'series' | 'new';

const TRACK_PLACEMENTS: ReadonlyArray<readonly [Placement, string]> = [
  ['album', 'An album in the catalogue'],
  ['artist', 'A new album, by an artist in the catalogue'],
  ['new', 'A new artist and album'],
];
const EPISODE_PLACEMENTS: ReadonlyArray<readonly [Placement, string]> = [
  ['series', 'A series in the catalogue'],
  ['new', 'A new series'],
];

/** The placement a parent chosen elsewhere (a catalogue search) puts the form in. */
const PLACEMENT_OF: Partial<Record<CatalogueKind, Placement>> = { album: 'album', artist: 'artist', show: 'series', season: 'series' };

/**
 * Manual entry: the kind's fields, seeded from a candidate when one was being
 * reviewed, the place it goes in the catalogue, and artwork uploaded to what
 * it creates. Applied through core, which routes it. `parent` arrives chosen
 * when the viewer picked an album, artist, series or season from a catalogue
 * search; `picture` is the provider's picture found for the candidate under
 * review, offered for what this creates.
 */
export function ManualEntry({ detail, probe, picture, parent, manage, catalogue, onResolved }: {
  detail: UnmatchedDetail;
  probe?: MediaProbeCandidate;
  picture?: CandidatePicture;
  parent?: CatalogueItem;
  manage: ManageApi;
  catalogue: CatalogueApi;
  onResolved: () => void;
}) {
  const [kind, setKind] = useState<ManualKind>(() => (
    parent ? (parent.kind === 'album' || parent.kind === 'artist' ? 'track' : 'episode') : likelyKind(detail, probe)
  ));
  const [placement, setPlacement] = useState<Placement>(() => (parent && PLACEMENT_OF[parent.kind]) || 'new');
  const [seriesItem, setSeriesItem] = useState(parent?.kind === 'show' || parent?.kind === 'season' ? parent : undefined);
  const [artistItem, setArtistItem] = useState(parent?.kind === 'artist' ? parent : undefined);
  const [albumItem, setAlbumItem] = useState(parent?.kind === 'album' ? parent : undefined);
  const [title, setTitle] = useState(probe?.title ?? '');
  const [year, setYear] = useState(probe?.year?.toString() ?? '');
  const [synopsis, setSynopsis] = useState('');
  const [series, setSeries] = useState(probe?.series ?? '');
  const [seriesYear, setSeriesYear] = useState(probe?.year?.toString() ?? '');
  const [seasonNumber, setSeasonNumber] = useState(() => (parent?.kind === 'season' ? parent.season_number : probe?.season_number)?.toString() ?? '');
  const [episodeNumber, setEpisodeNumber] = useState(probe?.episode_number?.toString() ?? '');
  const [artist, setArtist] = useState(probe?.artist ?? '');
  const [album, setAlbum] = useState(probe?.album ?? '');
  const [discNumber, setDiscNumber] = useState(probe?.disc_number?.toString() ?? '');
  const [trackNumber, setTrackNumber] = useState(probe?.track_number?.toString() ?? '');
  const [artwork, setArtwork] = useState<File | undefined>();
  const [usePicture, setUsePicture] = useState(true);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** What the form says, or a sentence for what it is missing. */
  const metadata = (): ManualMetadata | string => {
    if (kind === 'movie') return { kind, title: title.trim(), year: wholeNumber(year), synopsis: synopsis.trim() || undefined };
    if (kind === 'episode') {
      const season = wholeNumber(seasonNumber);
      const episode = wholeNumber(episodeNumber);
      const inSeason = placement === 'series' && seriesItem?.kind === 'season';
      if (placement === 'series' && !seriesItem) return 'Choose the series this episode belongs to.';
      if ((!inSeason && season == null) || episode == null) return 'Season and episode numbers are required.';
      return {
        kind,
        ...(inSeason ? { season_id: seriesItem.id }
          : placement === 'series' && seriesItem ? { series_id: seriesItem.id, season_number: season }
            : { series: series.trim(), series_year: wholeNumber(seriesYear), season_number: season }),
        episode_number: episode,
        title: title.trim() || undefined,
        synopsis: synopsis.trim() || undefined,
      };
    }
    if (placement === 'album' && !albumItem) return 'Choose the album this track belongs to.';
    if (placement === 'artist' && !artistItem) return 'Choose the artist this album is by.';
    if (placement !== 'album' && !album.trim()) return 'Name the album.';
    if (placement === 'new' && !artist.trim()) return 'Name the artist.';
    return {
      kind,
      ...(placement === 'album' && albumItem ? { album_id: albumItem.id }
        : placement === 'artist' && artistItem ? { artist_id: artistItem.id, album: album.trim() }
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
      if (applied.applied === 'created') {
        try {
          if (artwork) await catalogue.putArtwork(applied.result.leaf_item_id, ARTWORK_ROLE[kind], artwork.type || 'image/jpeg', artwork);
          else if (offered && usePicture) await applyCandidatePicture(manage, offered, applied.result);
        } catch (cause) {
          // The file is catalogued; only its picture failed, so say that and hold the form.
          setCreated(true);
          setError(`Created, but the picture could not be used: ${viewerErrorText(cause)}`);
          return;
        }
      }
      onResolved();
    } catch (cause) {
      setError(viewerErrorText(cause));
      setBusy(false);
    }
  };

  // The candidate's picture fits only what it was found for, and a cover is
  // never put on an album the catalogue already holds: that album has its own.
  const offered = picture && picture.kind === kind && !(kind === 'track' && placement === 'album') ? picture : undefined;

  const placements = kind === 'track' ? TRACK_PLACEMENTS : kind === 'episode' ? EPISODE_PLACEMENTS : [];
  const changeKind = (next: ManualKind) => { setKind(next); setPlacement('new'); setError(undefined); };

  return (
    <form className="manage-manual-form" aria-label="Manual catalogue metadata" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>Type
        <select value={kind} onChange={(event) => changeKind(event.target.value as ManualKind)} disabled={busy} data-tv-focusable="true">
          <option value="movie">Movie</option>
          <option value="episode">TV episode</option>
          <option value="track">Music track</option>
        </select>
      </label>
      {placements.length > 0 && (
        <fieldset className="identify-placement" disabled={busy}>
          <legend>{kind === 'track' ? 'Where this track goes' : 'Where this episode goes'}</legend>
          {placements.map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="placement" value={value} checked={placement === value} onChange={() => { setPlacement(value); setError(undefined); }} data-tv-focusable="true" />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {kind === 'episode' && (
        <>
          {placement === 'series' && <ParentPicker label="Series" find={findIn(['show'])} chosen={seriesItem} onChoose={setSeriesItem} disabled={busy} />}
          {placement === 'new' && (
            <div className="manage-field-row">
              <TextField label="Series" value={series} onChange={setSeries} disabled={busy} />
              <NumberField label="Series year" value={seriesYear} onChange={setSeriesYear} disabled={busy} />
            </div>
          )}
          <div className="manage-field-row">
            {/* A season chosen gives the episode its number. */}
            {!(placement === 'series' && seriesItem?.kind === 'season') && <NumberField label="Season" value={seasonNumber} onChange={setSeasonNumber} disabled={busy} />}
            <NumberField label="Episode" value={episodeNumber} onChange={setEpisodeNumber} disabled={busy} />
          </div>
        </>
      )}
      {kind === 'track' && (
        <>
          {placement === 'album' && <ParentPicker label="Album" find={findIn(['album'])} chosen={albumItem} onChoose={setAlbumItem} disabled={busy} />}
          {placement === 'artist' && <ParentPicker label="Artist" find={findIn(['artist'])} chosen={artistItem} onChoose={setArtistItem} disabled={busy} />}
          {placement === 'new' && <TextField label="Artist" value={artist} onChange={setArtist} disabled={busy} />}
          {placement !== 'album' && <TextField label={placement === 'artist' ? 'New album' : 'Album'} value={album} onChange={setAlbum} disabled={busy} />}
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
      {offered && (
        <div className="identify-offered-picture">
          <img src={offered.option.preview_url} alt="" />
          <label>
            <input type="checkbox" checked={usePicture && !artwork} disabled={busy || Boolean(artwork)} onChange={(event) => setUsePicture(event.target.checked)} data-tv-focusable="true" />
            {`Use this ${offered.role} from ${pictureSource(offered)}`}
          </label>
          {artwork && <span className="list-note">The uploaded image is used instead.</span>}
        </div>
      )}
      <label>{offered ? 'Or upload artwork' : 'Artwork'}<input type="file" accept="image/*" onChange={(event) => setArtwork(event.target.files?.[0])} disabled={busy} data-tv-focusable="true" /></label>
      {error && <p className="manage-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy || created} data-tv-focusable="true">
        {busy ? 'Saving…' : 'Save and create'}
      </button>
    </form>
  );
}
