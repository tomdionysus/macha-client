// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogueApi, CatalogueItem, CatalogueKind, ManageApi, ManageCatalogueMatch, MediaProbeCandidate, ProviderArtworkOption, ProviderReleaseTrack, ProviderSearchResult, UnmatchedFile,
} from '@machafoundation/core';
import { endpointFailure, MachaConnectionError } from '@machafoundation/core';
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
  /** The first read of the file fails. */
  detailFails?: boolean;
  /** The server's catalogue suggestions never arrive. */
  suggestionsPending?: boolean;
  /** The release's tracks; never read when absent. */
  tracks?: ProviderReleaseTrack[] | Error;
} = {}) {
  const manage = {
    unmatchedDetail: vi.fn(async () => ({ item: file, probes })),
    prospectiveMatches: vi.fn(() => (options.suggestionsPending ? new Promise(() => undefined) : Promise.resolve({ query: 'a film', matches: options.matches ?? [] }))),
    match: vi.fn(async () => undefined),
    manual: vi.fn(async () => ({ leaf_item_id: 'new-item', items: [] })),
    matchProvider: vi.fn(async () => ({
      leaf_item_id: 'leaf-1',
      items: [{ id: 'leaf-1', kind: 'track' }, { id: 'album-1', kind: 'album' }] as ManageCatalogueMatch[],
    })),
    providerSearch: vi.fn(async () => options.providerResults ?? []),
    providerArtwork: vi.fn(async () => options.artwork ?? []),
    providerReleaseTracks: vi.fn(() => (options.tracks === undefined ? new Promise(() => undefined)
      : options.tracks instanceof Error ? Promise.reject(options.tracks) : Promise.resolve(options.tracks))),
    chooseArtwork: vi.fn(async () => ({})),
    retry: vi.fn(),
    deleteUnmatched: vi.fn(),
  } as unknown as ManageApi;
  if (options.detailFails) vi.mocked(manage.unmatchedDetail).mockRejectedValueOnce(new Error('log'));
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

const suggestions = () => within(screen.getByRole('region', { name: 'Suggestions' }));
const fromFile = () => fireEvent.click(screen.getByRole('tab', { name: 'What the file says' }));
const rowOf = (text: string, scope: Pick<typeof screen, 'getByText'> = screen) => scope.getByText(text).closest('li') as HTMLElement;

async function find(label: string, words: string) {
  fireEvent.change(screen.getByLabelText(`Search for ${label}`), { target: { value: words } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
}

describe('suggestions, where identifying a file starts', () => {
  const track = probe({ kind: 'track', title: 'A Song', artist: 'A Band', album: 'A Record', track_number: 2 });
  const elsewhere: ProviderSearchResult = { ...record, ref: 'musicbrainz:release:other', artist: 'Another Band' };

  it('lists the records the file most likely is, by what it names, leaving out another artist\'s album of the same name', async () => {
    const { manage } = show([track], { providerResults: [elsewhere, record] });
    await settle();
    expect(manage.providerSearch).toHaveBeenCalledWith('A Record', 'album', { year: undefined, limit: 8 });
    expect(suggestions().getAllByRole('listitem')).toHaveLength(1);
    expect(suggestions().getByText('A Band · MusicBrainz')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Search online' }).getAttribute('aria-selected')).toBe('true');
  });

  it('uses a record with the track the file says it is, and the picture chosen from the record\'s', async () => {
    const { manage } = show([track], { providerResults: [record], artwork: pictures });
    await settle();
    const row = rowOf('A Record · 1999', suggestions());
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    expect((within(row).getByLabelText('Track') as HTMLInputElement).value).toBe('2');
    fireEvent.click(within(row).getByRole('button', { name: 'Picture 2, 1200 by 1200' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Match with this picture' }));
    await settle();
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'musicbrainz:release:r1', track_number: 2 });
    expect(manage.chooseArtwork).toHaveBeenCalledWith('album-1', 'cover', 'o2');
    screen.getByText('the list');
  });

  it('asks for the episode a series record needs when the file did not say, and its stills once it has it', async () => {
    const { manage } = show([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: null })], { providerResults: [series] });
    await settle();
    const row = rowOf('A Series · 2010', suggestions());
    expect(within(row).getByText('TMDB · already in the catalogue')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(within(row).getByRole('alert').textContent).toBe('Enter the season and episode this file is.');
    expect(manage.matchProvider).not.toHaveBeenCalled();

    fireEvent.change(within(row).getByLabelText('Episode'), { target: { value: '4' } });
    await settle();
    expect(manage.providerArtwork).toHaveBeenCalledWith('tmdb:tv:42', 'still', { season_number: 1, episode_number: 4 });
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'tmdb:tv:42', season_number: 1, episode_number: 4 });
    expect(manage.chooseArtwork).not.toHaveBeenCalled();
  });

  it('says so, and stays, when the match is made but the picture is refused', async () => {
    const { manage } = show([track], { providerResults: [record], artwork: pictures });
    vi.mocked(manage.chooseArtwork).mockRejectedValueOnce(new Error('gone'));
    await settle();
    const row = rowOf('A Record · 1999', suggestions());
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    fireEvent.click(within(row).getByRole('button', { name: 'Picture 1, 500 by 500' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Match with this picture' }));
    await settle();
    expect(within(row).getByRole('alert').textContent).toMatch(/^Matched, but the chosen picture could not be used/);
    expect(screen.queryByText('the list')).toBeNull();
    expect((within(row).getByRole('button', { name: 'Match with this picture' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows releases no one could tell apart as one record, matched by the release whose cover it shows', async () => {
    const bare = { ...record, ref: 'musicbrainz:release:bare' };
    const reissue = { ...record, ref: 'musicbrainz:release:reissue' };
    const { manage } = show([track], { providerResults: [bare, record, reissue], artwork: pictures });
    vi.mocked(manage.providerArtwork).mockImplementation(async (ref: string) => (ref.endsWith('bare') ? [] : pictures));
    await settle();
    expect(suggestions().getAllByRole('listitem')).toHaveLength(1);
    const row = rowOf('A Record · 1999', suggestions());
    expect(within(row).getByText('A Band · MusicBrainz · 3 releases')).toBeTruthy();
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://provider/o1.jpg');
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'musicbrainz:release:r1', track_number: 2 });
  });

  it('lists the album\'s files in the folder with their match, chosen one by one or all, and says how each went', async () => {
    const { manage } = show([track], { providerResults: [record] });
    const sibling = (id: string, name: string): UnmatchedFile => ({ ...file, id, path: `/incoming/${name}` });
    const elsewhereFile = { ...file, id: 'f9', path: '/other/03.mp3' };
    vi.mocked(manage).unmatched = vi.fn(async () => [file, sibling('f2', '02.mp3'), sibling('f3', '03.mp3'), sibling('f4', 'notes.mp3'), elsewhereFile]);
    const details: Record<string, MediaProbeCandidate[]> = {
      f1: [track],
      f2: [probe({ kind: 'track', title: 'Two', artist: 'A Band', album: 'A Record', track_number: 3 })],
      f3: [probe({ kind: 'track', title: 'Three', artist: 'A Band', album: 'A Record', track_number: null })],
      f4: [probe({ kind: 'track', title: 'Other', artist: 'A Band', album: 'Another Record', track_number: 1 })],
    };
    vi.mocked(manage.unmatchedDetail).mockImplementation(async (id: string) => ({ item: file, probes: details[id] ?? [] }));
    await settle();
    const row = rowOf('A Record · 1999', suggestions());
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    const files = within(row.querySelector('.identify-album-files') as HTMLElement);
    expect(files.getAllByRole('row').map((tr) => tr.textContent)).toEqual([
      'some.file.mkv (this file)A Record · track 2',
      '02.mp3A Record · track 3',
      '03.mp3A Record · no track number',
    ]);
    const two = files.getByLabelText('Match 02.mp3') as HTMLInputElement;
    const three = files.getByLabelText('Match 03.mp3') as HTMLInputElement;
    expect([two.checked, three.checked, three.disabled]).toEqual([true, false, true]);
    fireEvent.click(files.getByRole('button', { name: 'Select none' }));
    expect(two.checked).toBe(false);
    fireEvent.click(files.getByRole('button', { name: 'Select all' }));
    expect(two.checked).toBe(true);

    vi.mocked(manage.matchProvider).mockImplementation(async (id: string) => {
      if (id === 'f2') throw Object.assign(new Error('log'), { detail: 'No track 3 on that release.' });
      return { leaf_item_id: 'leaf-1', items: [] };
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(vi.mocked(manage.matchProvider).mock.calls).toEqual([
      ['f1', { ref: 'musicbrainz:release:r1', track_number: 2 }],
      ['f2', { ref: 'musicbrainz:release:r1', track_number: 3 }],
    ]);
    expect(files.getAllByRole('row').map((tr) => tr.lastChild?.textContent)).toEqual(['Matched', 'Not matched: No track 3 on that release.', '']);
    fireEvent.click(within(row).getByRole('button', { name: 'Back to the list' }));
    screen.getByText('the list');
  });

  it('names each file\'s track from the release, and will not send one the release lacks', async () => {
    const releaseTrack = (n: number, title: string): ProviderReleaseTrack => ({ disc_number: 1, track_number: n, title, length_ms: null, recording_id: null });
    const { manage } = show([track], { providerResults: [record], tracks: [releaseTrack(1, 'First'), releaseTrack(2, 'Second')] });
    const sibling = (id: string, name: string): UnmatchedFile => ({ ...file, id, path: `/incoming/${name}` });
    vi.mocked(manage).unmatched = vi.fn(async () => [file, sibling('f2', '01.mp3'), sibling('f3', '09.mp3')]);
    const details: Record<string, MediaProbeCandidate[]> = {
      f1: [track],
      f2: [probe({ kind: 'track', title: 'One', artist: 'A Band', album: 'A Record', track_number: 1 })],
      f3: [probe({ kind: 'track', title: 'Nine', artist: 'A Band', album: 'A Record', track_number: 9 })],
    };
    vi.mocked(manage.unmatchedDetail).mockImplementation(async (id: string) => ({ item: file, probes: details[id] ?? [] }));
    await settle();
    const row = rowOf('A Record · 1999', suggestions());
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    expect(manage.providerReleaseTracks).toHaveBeenCalledWith('musicbrainz:release:r1');
    const files = within(row.querySelector('.identify-album-files') as HTMLElement);
    expect(files.getAllByRole('row').map((tr) => tr.textContent)).toEqual([
      'some.file.mkv (this file)A Record · track 2, "Second"',
      '01.mp3A Record · track 1, "First"',
      '09.mp3A Record · track 9, which this release does not have',
    ]);
    const nine = files.getByLabelText('Match 09.mp3') as HTMLInputElement;
    expect([nine.checked, nine.disabled]).toEqual([false, true]);
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(vi.mocked(manage.matchProvider).mock.calls.map(([id]) => id)).toEqual(['f1', 'f2']);
  });

  it('says why when the release\'s tracks cannot be read, and lists the files as before', async () => {
    const { manage } = show([track], { providerResults: [record], tracks: Object.assign(new Error('log'), { detail: 'MusicBrainz did not answer.' }) });
    vi.mocked(manage).unmatched = vi.fn(async () => [file]);
    await settle();
    const row = rowOf('A Record · 1999', suggestions());
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    within(row).getByText(/track titles could not be read/);
    const files = within(row.querySelector('.identify-album-files') as HTMLElement);
    expect(files.getAllByRole('row').map((tr) => tr.textContent)).toEqual(['some.file.mkv (this file)A Record · track 2']);
  });

  it('stops sending the album\'s files once the server leaves one unanswered', async () => {
    const { manage } = show([track], { providerResults: [record] });
    const sibling = (id: string, name: string): UnmatchedFile => ({ ...file, id, path: `/incoming/${name}` });
    vi.mocked(manage).unmatched = vi.fn(async () => [file, sibling('f2', '02.mp3'), sibling('f3', '03.mp3')]);
    const numbered = (n: number) => [probe({ kind: 'track', title: `T${n}`, artist: 'A Band', album: 'A Record', track_number: n })];
    vi.mocked(manage.unmatchedDetail).mockImplementation(async (id: string) => ({ item: file, probes: id === 'f1' ? [track] : numbered(id === 'f2' ? 3 : 4) }));
    vi.mocked(manage.matchProvider).mockImplementation(async (id: string) => {
      if (id === 'f2') throw endpointFailure('fi-1', 'http://fi-1', new MachaConnectionError('exceeded 8000 ms'));
      return { leaf_item_id: 'leaf-1', items: [] };
    });
    await settle();
    const row = rowOf('A Record · 1999', suggestions());
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await settle();
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(vi.mocked(manage.matchProvider).mock.calls.map(([id]) => id)).toEqual(['f1', 'f2']);
    const statuses = within(row.querySelector('.identify-album-files') as HTMLElement).getAllByRole('row').map((tr) => tr.lastChild?.textContent);
    expect(statuses[2]).toBe('Not matched: not tried, because the server did not answer the one before.');
  });

  it('says when nothing on TMDB or MusicBrainz matches what the file says', async () => {
    show([track], { providerResults: [elsewhere] });
    await settle();
    expect(suggestions().getByText(/Nothing on TMDB or MusicBrainz matches/)).toBeTruthy();
  });
});

describe('searching online when the suggestions are not it', () => {
  it('searches with any words, and each result is a record to use', async () => {
    const { manage } = show([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: 3 })]);
    await settle();
    vi.mocked(manage.providerSearch).mockResolvedValueOnce([series]);
    const panel = within(screen.getByRole('tabpanel'));
    expect((panel.getByLabelText('Search for') as HTMLInputElement).value).toBe('A Series');
    fireEvent.click(panel.getByRole('button', { name: 'Search' }));
    await settle();
    expect(manage.providerSearch).toHaveBeenLastCalledWith('A Series', 'show', { year: undefined, limit: 20 });
    const row = rowOf('A Series · 2010', panel);
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'tmdb:tv:42', season_number: 1, episode_number: 3 });
  });
});

describe('what the file says about itself', () => {
  it('creates a candidate that says enough, in one press, through core', async () => {
    const { manage } = show([probe({})]);
    await settle();
    fromFile();
    fireEvent.click(within(rowOf('A Film · 2001')).getByRole('button', { name: 'Create' }));
    await settle();
    screen.getByText('the list');
    expect(manage.manual).toHaveBeenCalledWith('f1', expect.objectContaining({ kind: 'movie', title: 'A Film', year: 2001 }));
  });

  it('offers only a review for a candidate that does not, and fills the manual form from it', async () => {
    show([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: null })]);
    await settle();
    fromFile();
    const row = rowOf('A Series · Pilot');
    expect(within(row).queryByRole('button', { name: 'Create' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('tab', { name: 'Enter manually' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Series') as HTMLInputElement).value).toBe('A Series');
    expect((screen.getByLabelText('Episode title') as HTMLInputElement).value).toBe('Pilot');
  });

  it('shows the file without waiting for the server\'s catalogue suggestions', async () => {
    show([probe({})], { suggestionsPending: true });
    await settle();
    fromFile();
    expect(screen.getByText('A Film · 2001')).toBeTruthy();
  });

  it('offers to try again when the file could not be read', async () => {
    show([probe({})], { detailFails: true });
    await settle();
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    fromFile();
    expect(screen.getByText('A Film · 2001')).toBeTruthy();
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

describe('a candidate\'s picture', () => {
  const film = probe({});
  const poster = { ...pictures[0], option_id: 'p1', role: 'poster', preview_url: 'https://provider/p1.jpg' };
  const filmResult: ProviderSearchResult = { ref: 'tmdb:movie:5', provider: 'tmdb', kind: 'movie', title: 'A Film', year: 2001 };

  async function candidates(options: Parameters<typeof show>[1]) {
    const shown = show([film], options);
    await settle();
    fromFile();
    return { ...shown, row: rowOf('A Film · 2001', within(screen.getByRole('tabpanel'))) };
  }

  it('shows the provider\'s picture on the candidate and puts it on what Create makes', async () => {
    const { manage, row } = await candidates({ providerResults: [filmResult], artwork: [poster] });
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://provider/p1.jpg');
    fireEvent.click(within(row).getByRole('button', { name: 'Create' }));
    await settle();
    expect(manage.chooseArtwork).toHaveBeenCalledWith('new-item', 'poster', 'p1', { ref: 'tmdb:movie:5', season_number: undefined, episode_number: undefined });
    screen.getByText('the list');
  });

  it('carries it into review, where it can be declined', async () => {
    const { manage, row } = await candidates({ providerResults: [filmResult], artwork: [poster] });
    fireEvent.click(within(row).getByRole('button', { name: 'Review' }));
    const use = screen.getByLabelText('Use this poster from TMDB') as HTMLInputElement;
    expect(use.checked).toBe(true);
    fireEvent.click(use);
    save();
    await settle();
    expect(manage.manual).toHaveBeenCalled();
    expect(manage.chooseArtwork).not.toHaveBeenCalled();
  });

  it('puts the reviewed picture on what the entry creates', async () => {
    const { manage, row } = await candidates({ providerResults: [filmResult], artwork: [poster] });
    fireEvent.click(within(row).getByRole('button', { name: 'Review' }));
    save();
    await settle();
    expect(manage.chooseArtwork).toHaveBeenCalledWith('new-item', 'poster', 'p1', expect.objectContaining({ ref: 'tmdb:movie:5' }));
  });

  it('shows no picture when the provider\'s result is another title', async () => {
    const { row } = await candidates({ providerResults: [{ ...filmResult, title: 'Something Else' }], artwork: [poster] });
    expect(row.querySelector('img')).toBeNull();
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
