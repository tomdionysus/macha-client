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
});
