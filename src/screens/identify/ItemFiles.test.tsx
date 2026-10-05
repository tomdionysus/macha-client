// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueItem, ManageApi, PlaybackFactsApi, PlaybackMediaFacts, UnmatchedFile } from '@machafoundation/core';
import { ItemFiles, fileSummary } from './ItemFiles';
import { settle } from '../../test/settle';

const item = (overrides: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id: 'item-1', kind: 'movie', title: 'A Film', sort_title: 'A Film', synopsis: '', parent_id: null, year: 2001,
  season_number: null, episode_number: null, disc_number: null, track_number: null,
  aliases: [], external_ids: {}, media_ids: ['m1'], artwork: [], revision: 3, updated_ns: 0, ...overrides,
});

const file = (mediaId: string, path: string, width: number, codec: string): PlaybackMediaFacts => ({
  mediaId, path, sizeBytes: 4_000_000_000,
  profile: {
    mediaId, format: 'matroska,webm', container: 'mkv', durationMs: 6_000_000, bitrate: 5_000_000,
    streams: [
      { index: 0, type: 'video', codec, profile: '', language: '', default: true, forced: false, width, height: width === 3840 ? 2160 : 1080 },
      { index: 1, type: 'audio', codec: 'aac', profile: '', language: 'eng', default: true, forced: false, channels: 6 },
    ],
  },
  operations: {} as PlaybackMediaFacts['operations'],
});

const unmatchedFile = (id: string, path: string): UnmatchedFile => ({
  id, path, provider: 'movies', media_id: `media-${id}`, result: 'no_provider_match', attempts: 1, updated_unix_ms: 0, size: 1, mtime_ns: 0, current: true,
});

describe('an item\'s files', () => {
  it('lists each file with what it is', async () => {
    const facts = { facts: vi.fn(async () => [file('m1', '/movies/a-film-1080.mkv', 1920, 'h264'), file('m2', '/movies/a-film-2160.mkv', 3840, 'hevc')]) } as unknown as PlaybackFactsApi;
    render(<ItemFiles item={item()} facts={facts} />);
    await settle();
    const list = screen.getByRole('list');
    expect([...list.querySelectorAll('strong')].map((name) => name.textContent)).toEqual(['a-film-1080.mkv', 'a-film-2160.mkv']);
    expect(list.textContent).toContain('3840×2160 HEVC · AAC 6ch · MKV');
    expect(facts.facts).toHaveBeenCalledWith({ itemId: 'item-1' });
    expect(screen.queryByRole('button', { name: 'Add a file' })).toBeNull();
  });

  it('marks each file that cannot be played in full, with what it means', async () => {
    const partial = { ...file('m1', '/a.mkv', 1920, 'h264'), availability: { availability: 'partial' } } as PlaybackMediaFacts;
    const unavailable = { ...file('m2', '/b.mkv', 3840, 'hevc'), availability: { availability: 'unavailable' } } as PlaybackMediaFacts;
    const complete = { ...file('m3', '/c.mkv', 1920, 'h264'), availability: { availability: 'complete' } } as PlaybackMediaFacts;
    const facts = { facts: vi.fn(async () => [partial, unavailable, complete]) } as unknown as PlaybackFactsApi;
    render(<ItemFiles item={item()} facts={facts} />);
    await settle();
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.availability-marker')?.getAttribute('aria-label') ?? 'none')).toEqual([
      'Part of this file is held only by servers that can\'t be reached right now, so it may stop before the end.',
      'This file is held only by servers that can\'t be reached right now, so it can\'t be played.',
      'none',
    ]);
  });

  it('shows nothing for an item that holds children rather than files', () => {
    const facts = { facts: vi.fn() } as unknown as PlaybackFactsApi;
    const { container } = render(<ItemFiles item={item({ kind: 'show', media_ids: [] })} facts={facts} />);
    expect(container.textContent).toBe('');
  });

  it('adds an unmatched file beside the item\'s own, through core, and reads the files again', async () => {
    let attached = false;
    const facts = { facts: vi.fn(async () => attached ? [file('m1', '/a.mkv', 1920, 'h264'), file('m2', '/b.mkv', 3840, 'hevc')] : [file('m1', '/a.mkv', 1920, 'h264')]) } as unknown as PlaybackFactsApi;
    const match = vi.fn(async () => { attached = true; });
    const manage = {
      unmatched: vi.fn(async () => [unmatchedFile('u1', '/incoming/other-thing.mkv'), unmatchedFile('u2', '/incoming/a-film-2160.mkv')]),
      match,
    } as unknown as ManageApi;
    render(<ItemFiles item={item()} facts={facts} manage={manage} />);
    await settle();
    screen.getByText('a.mkv');

    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Add a file to A Film' });
    await settle();
    within(dialog).getByText('other-thing.mkv');
    fireEvent.change(within(dialog).getByLabelText('Filter unmatched files'), { target: { value: '2160' } });
    expect(within(dialog).queryByText('other-thing.mkv')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add as a version' }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(match).toHaveBeenCalledWith('u2', 'item-1');
    await settle();
    expect(screen.getByText('b.mkv')).toBeTruthy();
  });

  it('summarises a file from what it states', () => {
    const audioOnly = file('m', '/x.flac', 0, 'none');
    audioOnly.profile.streams = [{ index: 0, type: 'audio', codec: 'flac', profile: '', language: '', default: true, forced: false, channels: 2 }];
    audioOnly.profile.container = 'flac';
    expect(fileSummary(audioOnly)).toBe('FLAC 2ch · FLAC');
  });

  describe('taking a file off the title', () => {
    const two = () => [file('m1', '/movies/a-film-1080.mkv', 1920, 'h264'), file('m2', '/movies/a-film-2160.mkv', 3840, 'hevc')];

    async function editor(files: PlaybackMediaFacts[], manage: Partial<ManageApi>) {
      const facts = { facts: vi.fn(async () => files) } as unknown as PlaybackFactsApi;
      const onChanged = vi.fn();
      const onTitleRemoved = vi.fn();
      render(<ItemFiles item={item()} facts={facts} manage={manage as ManageApi} onChanged={onChanged} onTitleRemoved={onTitleRemoved} />);
      await settle();
      const row = (name: string) => within(screen.getByRole('list')).getAllByRole('listitem').find((li) => li.textContent?.includes(name))!;
      return { onChanged, onTitleRemoved, row };
    }

    it('unmatches one file against the revision on screen, and reads the title again when it still has files', async () => {
      const unmatchFile = vi.fn(async () => ({ titleRemoved: false, removedItemIds: [], item: undefined }));
      const { onChanged, onTitleRemoved, row } = await editor(two(), { unmatchFile } as Partial<ManageApi>);
      fireEvent.click(within(row('a-film-2160.mkv')).getByRole('button', { name: 'Unmatch' }));
      expect(screen.queryByText(/is removed too/)).toBeNull();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unmatch' }));
      await settle();
      expect(unmatchFile).toHaveBeenCalledWith('item-1', 'm2', 3);
      expect(onChanged).toHaveBeenCalled();
      expect(onTitleRemoved).not.toHaveBeenCalled();
    });

    it('warns that the title goes with its only file, and leaves when it has', async () => {
      const unmatchFile = vi.fn(async () => ({ titleRemoved: true, removedItemIds: ['item-1'] }));
      const { onTitleRemoved, row } = await editor([file('m1', '/a.mkv', 1920, 'h264')], { unmatchFile } as Partial<ManageApi>);
      fireEvent.click(within(row('a.mkv')).getByRole('button', { name: 'Unmatch' }));
      screen.getByText(/so A Film is removed too/);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unmatch' }));
      await settle();
      expect(onTitleRemoved).toHaveBeenCalled();
    });

    it('deletes this path, or every copy of the file, naming the title on screen', async () => {
      const deleteFilePath = vi.fn(async () => ({ titleRemoved: false, removedItemIds: [] }));
      const deleteFileContent = vi.fn(async () => ({ titleRemoved: false, removedItemIds: [], paths: [] }));
      const { onChanged, row } = await editor(two(), { deleteFilePath, deleteFileContent } as Partial<ManageApi>);
      fireEvent.click(within(row('a-film-1080.mkv')).getByRole('button', { name: 'Delete' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete this file' }));
      await settle();
      expect(deleteFilePath).toHaveBeenCalledWith('/movies/a-film-1080.mkv', 'item-1');
      fireEvent.click(within(row('a-film-2160.mkv')).getByRole('button', { name: 'Delete' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete every copy' }));
      await settle();
      expect(deleteFileContent).toHaveBeenCalledWith('m2', 'item-1');
      expect(onChanged).toHaveBeenCalledTimes(2);
    });

    it('says why when the server refuses, and changes nothing', async () => {
      const unmatchFile = vi.fn(async () => { throw Object.assign(new Error('log'), { status: 404, code: 'media_not_bound', detail: 'That file is not on this title.' }); });
      const { onChanged, row } = await editor(two(), { unmatchFile } as Partial<ManageApi>);
      fireEvent.click(within(row('a-film-1080.mkv')).getByRole('button', { name: 'Unmatch' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unmatch' }));
      await settle();
      expect(screen.getByRole('alert').textContent).toBe('That file is not on this title.');
      expect(onChanged).not.toHaveBeenCalled();
    });
  });
});
