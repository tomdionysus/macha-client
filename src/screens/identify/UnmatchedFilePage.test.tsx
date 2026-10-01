// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueApi, CatalogueItem, ManageApi, ManageCatalogueMatch, MediaProbeCandidate, ProviderSearchResult, UnmatchedFile } from '@machafoundation/core';
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

const match = (overrides: Partial<ManageCatalogueMatch>): ManageCatalogueMatch => ({
  id: 'item-1', kind: 'movie', title: 'Another Film', sort_title: 'Another Film', synopsis: '', parent_id: null, year: 1999,
  season_number: null, episode_number: null, disc_number: null, track_number: null, media_ids: [], revision: 1, updated_ns: 0, ...overrides,
});

const catalogued = (id: string, title: string, year: number | null) => ({ id, title, year }) as CatalogueItem;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function show(probes: MediaProbeCandidate[], matches: ManageCatalogueMatch[] = [], items: Record<string, Partial<CatalogueItem>> = {}) {
  const manage = {
    unmatchedDetail: vi.fn(async () => ({ item: file, probes })),
    prospectiveMatches: vi.fn(async () => ({ query: 'a film', matches })),
    match: vi.fn(async () => undefined),
    manual: vi.fn(async () => ({ leaf_item_id: 'new-item', items: [] })),
    matchProvider: vi.fn(async () => ({ leaf_item_id: 'tmdb:episode:9', items: [] })),
    providerSearch: vi.fn(async (): Promise<ProviderSearchResult[]> => [
      { ref: 'tmdb:tv:42', provider: 'tmdb', kind: 'show', title: 'A Series', year: 2010, overview: 'What it is about.', catalogue_item_id: 'tmdb:tv:42' },
    ]),
    retry: vi.fn(),
    deleteUnmatched: vi.fn(),
  } as unknown as ManageApi;
  const catalogue = {
    get: vi.fn(async (id: string) => ({ id, artwork: [], effective_artwork: [], ...items[id] }) as unknown as CatalogueItem),
    search: vi.fn(async (_query: string, _limit: number, _signal: unknown, filter: { kinds: string[] }) => (
      filter.kinds[0] === 'show' ? [catalogued('tmdb:tv:42', 'A Series', 2010)] : [catalogued('mb:artist:1', 'A Band', null)]
    )),
    list: vi.fn(async () => [catalogued('mb:album:7', 'A Record', 1999)]),
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

  it('shows what each catalogue match looks like, and adds the file as another version to one that has files', async () => {
    const withFile = match({ id: 'item-2', title: 'A Film', year: 2001, media_ids: ['m-existing'] });
    const { manage } = show([], [match({}), withFile], { 'item-2': { effective_artwork: [{ role: 'poster', id: 'a', mime_type: 'image/jpeg', url: 'https://node/art/a?sig=1' }] } });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Search the catalogue' }));

    await settle();
    const row = (screen.getByText('A Film')).closest('li') as HTMLElement;
    expect(within(row).getByText(/1 file/)).toBeTruthy();
    await settle();
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://node/art/a?sig=1');
    expect(within(screen.getByText('Another Film').closest('li') as HTMLElement).getByRole('button', { name: 'Use this' })).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Add as another version' }));
    await settle();
    screen.getByText('the list');
    expect(manage.match).toHaveBeenCalledWith('f1', 'item-2');
  });

  it('asks for the numbers an episode needs before sending anything', async () => {
    const { manage } = show([]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Enter manually' }));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'episode' } });
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'A Series' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and create' }));
    await settle();
    expect((screen.getByRole('alert')).textContent).toBe('Season and episode numbers are required.');
    expect(manage.manual).not.toHaveBeenCalled();
  });

  it('files an episode under a series chosen from the catalogue by its id, not its name', async () => {
    const { manage, catalogue } = show([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: 2 })]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Enter manually' }));
    fireEvent.change(screen.getByLabelText('Search for series in the catalogue'), { target: { value: 'series' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await settle();
    expect(catalogue.search).toHaveBeenCalledWith('series', 8, undefined, { kinds: ['show'] });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(screen.queryByLabelText('Series')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and create' }));
    await settle();
    const sent = vi.mocked(manage.manual).mock.calls[0]?.[1];
    expect(sent).toEqual({ kind: 'episode', series_id: 'tmdb:tv:42', season_number: 1, episode_number: 2, title: 'Pilot', synopsis: undefined });
  });

  it('files a track under one of a chosen artist\'s albums, and asks for an album when none is chosen or named', async () => {
    const { manage, catalogue } = show([probe({ kind: 'track', title: 'A Song', artist: 'A Band', album: '', track_number: 3 })]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Enter manually' }));
    fireEvent.change(screen.getByLabelText('Search for artist in the catalogue'), { target: { value: 'band' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await settle();
    expect(catalogue.list).toHaveBeenCalledWith('album', 'mb:artist:1');

    fireEvent.click(screen.getByRole('button', { name: 'Save and create' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Choose one of the artist\'s albums, or name a new one.');
    expect(manage.manual).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and create' }));
    await settle();
    expect(vi.mocked(manage.manual).mock.calls[0]?.[1]).toMatchObject({ kind: 'track', album_id: 'mb:album:7', title: 'A Song', track_number: 3 });
    expect(vi.mocked(manage.manual).mock.calls[0]?.[1]).not.toHaveProperty('artist');
  });

  it('matches to a series found online, with the episode this file is', async () => {
    const { manage } = show([probe({ kind: 'episode', title: 'Pilot', series: 'A Series', season_number: 1, episode_number: null })]);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Search online' }));
    expect((screen.getByLabelText('Search for') as HTMLInputElement).value).toBe('A Series');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await settle();
    expect(manage.providerSearch).toHaveBeenCalledWith('A Series', 'show', { year: undefined, artist: undefined });
    const row = screen.getByText('A Series · 2010').closest('li') as HTMLElement;
    expect(within(row).getByText('TMDB · already in the catalogue')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Enter the season and episode this file is.');
    expect(manage.matchProvider).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Episode'), { target: { value: '4' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Match' }));
    await settle();
    screen.getByText('the list');
    expect(manage.matchProvider).toHaveBeenCalledWith('f1', { ref: 'tmdb:tv:42', season_number: 1, episode_number: 4 });
  });
});
