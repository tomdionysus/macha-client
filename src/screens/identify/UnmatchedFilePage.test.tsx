// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogueApi, CatalogueItem, CatalogueKind, ManageApi, ManageCatalogueMatch, MediaProbeCandidate, ProviderArtworkOption, ProviderSearchResult, UnmatchedFile,
} from '@machafoundation/core';
import { UnmatchedFilePage } from './UnmatchedFilePage';
import { settle } from '../../test/settle';

const file: UnmatchedFile = {
  id: 'f1', path: '/incoming/some.file.mkv', provider: 'movies', media_id: 'media-f1', result: 'no_provider_match',
  attempts: 2, updated_unix_ms: 0, size: 1_000_000, mtime_ns: 0, current: true,
};

const probe = (overrides: Partial<MediaProbeCandidate>): MediaProbeCandidate => ({
  kind: 'movie', score: 80, generator: 'filename', title: 'A Film', year: 2001, series: '', season_number: null, episode_number: null,
  artist: '', album: '', disc_number: null, track_number: null, evidence: [], ...overrides,
} as MediaProbeCandidate);

const item = (id: string, kind: CatalogueKind, title: string, overrides: Partial<CatalogueItem> = {}) => (
  { id, kind, title, year: null, artwork: [], effective_artwork: [], media_ids: [], ...overrides }
) as unknown as CatalogueItem;

const SERIES = item('tmdb:tv:42', 'show', 'A Series', { year: 2010 });
const ARTIST = item('mb:artist:1', 'artist', 'A Band');
const ALBUM = item('mb:album:7', 'album', 'A Record', { year: 1999 });

const series: ProviderSearchResult = { ref: 'tmdb:tv:42', provider: 'tmdb', kind: 'show', title: 'A Series', year: 2010, overview: 'What it is about.', catalogue_item_id: 'tmdb:tv:42' };
const record: ProviderSearchResult = { ref: 'musicbrainz:release:r1', provider: 'musicbrainz', kind: 'album', title: 'A Record', year: 1999, artist: 'A Band' };
const pictures: ProviderArtworkOption[] = [
  { option_id: 'o1', role: 'cover', width: 500, height: 500, language: null, preview_url: 'https://provider/o1.jpg' },
  { option_id: 'o2', role: 'cover', width: 1200, height: 1200, language: null, preview_url: 'https://provider/o2.jpg' },
];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function show(probes: MediaProbeCandidate[], options: {
  matches?: ManageCatalogueMatch[];
  found?: CatalogueItem[];
  providerResults?: ProviderSearchResult[];
  artwork?: ProviderArtworkOption[];
} = {}) {
  const manage = {
    unmatchedDetail: vi.fn(async () => ({ item: file, probes })),
    prospectiveMatches: vi.fn(async () => ({ query: 'a film', matches: options.matches ?? [] })),
    match: vi.fn(async () => undefined),
    manual: vi.fn(async () => ({ leaf_item_id: 'new-item', items: [] })),
    matchProvider: vi.fn(async () => ({
      leaf_item_id: 'leaf-1',
      items: [{ id: 'leaf-1', kind: 'track' }, { id: 'album-1', kind: 'album' }] as ManageCatalogueMatch[],
    })),
    providerSearch: vi.fn(async () => options.providerResults ?? [series]),
    providerArtwork: vi.fn(async () => options.artwork ?? []),
    chooseArtwork: vi.fn(async () => ({})),
    retry: vi.fn(),
    deleteUnmatched: vi.fn(),
  } as unknown as ManageApi;
  const catalogue = {
    search: vi.fn(async (_query: string, _limit: number, _signal: unknown, filter: { kinds: CatalogueKind[] }) => (
      (options.found ?? [SERIES, ARTIST, ALBUM]).filter((candidate) => filter.kinds.includes(candidate.kind))
    )),
    putArtwork: vi.fn(),
  } as unknown as CatalogueApi;
  render(
    <MemoryRouter initialEntries={['/manage/unmatched/f1']}>
      <Routes>
        <Route path="/manage/unmatched/:fileId" element={<UnmatchedFilePage api={manage} catalogueApi={catalogue} />} />
        <Route path="/manage/unmatched" element={<p>the list</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return { manage, catalogue };
}

const sent = (manage: ManageApi) => vi.mocked(manage.manual).mock.calls[0]?.[1];
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save and create' }));
const alert = () => screen.getByRole('alert').textContent;

async function find(label: string, words: string) {
  fireEvent.change(screen.getByLabelText(`Search for ${label}`), { target: { value: words } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
}

describe('identifying an unmatched file', () => {
  it('creates a candidate that says enough, in one press, through core', async () => {
    const { manage } = show([probe({})]);
    await settle();
    const row = (screen.getByText('A Film · 2001')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Create' }));
    await settle();
    screen.getByText('the list');
    expect(manage.manual).toHaveBeenCalledWith('f1', expect.objectContaining({ kind: 'movie', title: 'A Film', year: 2001 }));
  });

  it('offers only a review for a candidate that does not, and fills the manual form from it', async () => {
    show([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: null })]);
    await settle();
    const row = (screen.getByText(/A Series/)).closest('li') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Create' })).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('tab', { name: 'Enter manually' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Series') as HTMLInputElement).value).toBe('A Series');
    expect((screen.getByLabelText('Episode title') as HTMLInputElement).value).toBe('Pilot');
  });

  it('asks for the numbers an episode needs before sending anything', async () => {
    const { manage } = show([]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Enter manually' }));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'episode' } });
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'A Series' } });
    save();
    await settle();
    expect(alert()).toBe('Season and episode numbers are required.');
    expect(manage.manual).not.toHaveBeenCalled();
  });
});

describe('searching the catalogue for a file', () => {
  it('looks for a track, and every album and artist it could go under, with the server\'s suggested words', async () => {
    const { catalogue } = show([probe({ kind: 'track', title: 'A Song', artist: 'A Band' })]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Search the catalogue' }));
    await settle();
    // One search per kind, so tracks cannot crowd albums and artists out of a shared limit.
    for (const kind of ['album', 'artist', 'track']) expect(catalogue.search).toHaveBeenCalledWith('a film', 8, undefined, { kinds: [kind] });
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Albums', 'Artists']);
    expect(within(screen.getByRole('region', { name: 'Albums' })).getByRole('button', { name: 'Add a track to this album' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Artists' })).getByRole('button', { name: 'Add a new album by this artist' })).toBeTruthy();
  });

  it('adds the file as another version of an item that has files, with its picture', async () => {
    const withFile = item('item-2', 'movie', 'A Film', {
      year: 2001, media_ids: ['m-existing'], effective_artwork: [{ role: 'poster', id: 'a', mime_type: 'image/jpeg', url: 'https://node/art/a?sig=1' }],
    });
    const { manage } = show([], { found: [item('item-1', 'movie', 'Another Film'), withFile] });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Search the catalogue' }));
    await settle();
    const row = (screen.getByText('A Film')).closest('li') as HTMLElement;
    expect(within(row).getByText(/1 file/)).toBeTruthy();
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://node/art/a?sig=1');
    expect(within(screen.getByText('Another Film').closest('li') as HTMLElement).getByRole('button', { name: 'Use this' })).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Add as another version' }));
    await settle();
    screen.getByText('the list');
    expect(manage.match).toHaveBeenCalledWith('f1', 'item-2');
  });

  it('files a track under an album found there, by its id', async () => {
    const { manage } = show([probe({ kind: 'track', title: 'A Song', artist: 'A Band', album: 'A Record', track_number: 3 })]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Search the catalogue' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add a track to this album' }));
    expect(screen.getByRole('tab', { name: 'Enter manually' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('An album in the catalogue') as HTMLInputElement).checked).toBe(true);
    save();
    await settle();
    expect(sent(manage)).toMatchObject({ kind: 'track', album_id: 'mb:album:7', title: 'A Song', track_number: 3 });
    expect(sent(manage)).not.toHaveProperty('artist');
    expect(sent(manage)).not.toHaveProperty('album');
  });
});

describe('where a manual entry goes', () => {
  async function manually(probes: MediaProbeCandidate[]) {
    const shown = show(probes);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Enter manually' }));
    return shown;
  }

  it('creates a new artist and album by name, and asks for both', async () => {
    const { manage } = await manually([probe({ kind: 'track', title: 'A Song', artist: '', album: '' })]);
    expect((screen.getByLabelText('A new artist and album') as HTMLInputElement).checked).toBe(true);
    save();
    await settle();
    expect(alert()).toBe('Name the album.');
    fireEvent.change(screen.getByLabelText('Album'), { target: { value: 'A Record' } });
    save();
    await settle();
    expect(alert()).toBe('Name the artist.');
    expect(manage.manual).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'A Band' } });
    save();
    await settle();
    expect(sent(manage)).toMatchObject({ kind: 'track', artist: 'A Band', album: 'A Record', title: 'A Song' });
  });

  it('creates a new album under an artist chosen from the catalogue', async () => {
    const { manage, catalogue } = await manually([probe({ kind: 'track', title: 'A Song', artist: 'A Band', album: 'A New Record' })]);
    fireEvent.click(screen.getByLabelText('A new album, by an artist in the catalogue'));
    save();
    await settle();
    expect(alert()).toBe('Choose the artist this album is by.');
    await find('artist', 'band');
    expect(catalogue.search).toHaveBeenCalledWith('band', 8, undefined, { kinds: ['artist'] });
    expect((screen.getByLabelText('New album') as HTMLInputElement).value).toBe('A New Record');
    save();
    await settle();
    expect(sent(manage)).toMatchObject({ kind: 'track', artist_id: 'mb:artist:1', album: 'A New Record' });
    expect(sent(manage)).not.toHaveProperty('artist');
  });

  it('adds a track to an album chosen from the catalogue', async () => {
    const { manage } = await manually([probe({ kind: 'track', title: 'A Song', artist: 'A Band', album: 'A Record' })]);
    fireEvent.click(screen.getByLabelText('An album in the catalogue'));
    save();
    await settle();
    expect(alert()).toBe('Choose the album this track belongs to.');
    await find('album', 'record');
    save();
    await settle();
    expect(sent(manage)).toMatchObject({ kind: 'track', album_id: 'mb:album:7', title: 'A Song' });
  });

  it('files an episode under a series chosen from the catalogue, with its season number', async () => {
    const { manage } = await manually([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: 2 })]);
    fireEvent.click(screen.getByLabelText('A series in the catalogue'));
    await find('series', 'series');
    expect(screen.queryByLabelText('Series year')).toBeNull();
    save();
    await settle();
    expect(sent(manage)).toEqual({ kind: 'episode', series_id: 'tmdb:tv:42', season_number: 1, episode_number: 2, title: 'Pilot', synopsis: undefined });
  });
});

describe('matching to a record found online', () => {
  async function online(probes: MediaProbeCandidate[], options: Parameters<typeof show>[1] = {}) {
    const shown = show(probes, options);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Search online' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await settle();
    return shown;
  }

  it('asks for the episode before picking a series, then matches with it', async () => {
    const { manage } = await online([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: null })]);
    expect(manage.providerSearch).toHaveBeenCalledWith('A Series', 'show', { year: undefined, artist: undefined });
    const row = screen.getByText('A Series · 2010').closest('li') as HTMLElement;
    expect(within(row).getByText('TMDB · already in the catalogue')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(alert()).toBe('Enter the season and episode this file is.');
    expect(manage.providerArtwork).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Episode'), { target: { value: '4' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(manage.providerArtwork).toHaveBeenCalledWith('tmdb:tv:42', 'still', { season_number: 1, episode_number: 4 });
    expect(within(row).getByText(/no pictures to choose from/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    screen.getByText('the list');
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'tmdb:tv:42', season_number: 1, episode_number: 4 });
    expect(manage.chooseArtwork).not.toHaveBeenCalled();
  });

  it('puts the cover chosen from the provider\'s pictures on the album the match wrote', async () => {
    const { manage } = await online([probe({ kind: 'track', title: 'A Song', album: 'A Record', track_number: 2 })], { providerResults: [record], artwork: pictures });
    const row = screen.getByText('A Record · 1999').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(manage.providerArtwork).toHaveBeenCalledWith('musicbrainz:release:r1', 'cover', { season_number: undefined, episode_number: undefined });
    fireEvent.click(within(row).getByRole('button', { name: 'Picture 2, 1200 by 1200' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Match with this picture' }));
    await settle();
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'musicbrainz:release:r1', track_number: 2 });
    expect(manage.chooseArtwork).toHaveBeenCalledWith('album-1', 'cover', 'o2');
    screen.getByText('the list');
  });

  it('says so, and stays, when the match is made but the picture is refused', async () => {
    const { manage } = await online([probe({ kind: 'track', title: 'A Song', album: 'A Record', track_number: 2 })], { providerResults: [record], artwork: pictures });
    vi.mocked(manage.chooseArtwork).mockRejectedValueOnce(new Error('gone'));
    const row = screen.getByText('A Record · 1999').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    fireEvent.click(within(row).getByRole('button', { name: 'Picture 1, 500 by 500' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Match with this picture' }));
    await settle();
    expect(alert()).toMatch(/^Matched, but the chosen picture could not be used/);
    expect(screen.queryByText('the list')).toBeNull();
    expect((within(row).getByRole('button', { name: 'Match with this picture' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
