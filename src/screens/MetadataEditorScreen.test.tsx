// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueApi, CatalogueItem, PlaybackFactsApi } from '@machafoundation/core';
import { itemChanges, MetadataEditorScreen } from './MetadataEditorScreen';
import { settle } from '../test/settle';

const episode = (overrides: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id: 'ep-1', kind: 'episode', title: 'Pilot', sort_title: 'Pilot', synopsis: '', parent_id: 'season-1', year: null,
  season_number: 1, episode_number: 1, disc_number: null, track_number: null,
  aliases: [], external_ids: {}, media_ids: [], artwork: [], revision: 4, updated_ns: 0, ...overrides,
});

function show(item: CatalogueItem) {
  const api = {
    get: vi.fn(async () => item),
    update: vi.fn(async (next: CatalogueItem) => next),
    patch: vi.fn(async (_id: string, fields: Partial<CatalogueItem>) => ({ ...item, ...fields })),
    putArtwork: vi.fn(async () => ({ role: 'still', id: 'art-1', mime_type: 'image/png' })),
    clearMetadata: vi.fn(),
  } as unknown as CatalogueApi;
  const facts = { facts: vi.fn(async () => []) } as unknown as PlaybackFactsApi;
  const onSaved = vi.fn();
  render(<MetadataEditorScreen api={api} facts={facts} itemId={item.id} onBack={vi.fn()} onSaved={onSaved} onCleared={vi.fn()} />);
  return { api, onSaved };
}

describe('the metadata editor', () => {
  it('offers an episode a still to upload, uploads it at once, and reads the item again', async () => {
    const { api } = show(episode());
    await settle();
    const input = (screen.getByText('Upload a new still')).closest('label')?.querySelector('input') as HTMLInputElement;
    const image = new File(['x'], 'still.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [image] } });
    await settle();
    expect(api.putArtwork).toHaveBeenCalledWith('ep-1', 'still', 'image/png', image);
    await settle();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('says a cleared title\'s files go to Unmatched files, not back through the matcher', async () => {
    show(episode());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Clear metadata' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('its files are listed in Unmatched files to be identified by hand; nothing is matched again automatically.');
  });

  it('holds uploads while there are unsaved changes, and says why', async () => {
    show(episode());
    await settle();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pilot, retitled' } });
    const input = screen.getByText('Upload a new still').closest('label')?.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/Save or cancel your changes before uploading/)).toBeTruthy();
  });

  it('saves only what changed, as a number, at the revision it read', async () => {
    const { api, onSaved } = show(episode());
    await settle();
    fireEvent.change(screen.getByLabelText('Episode number'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await settle();
    expect(onSaved).toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('ep-1', { episode_number: 7 }, 4);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('sends nothing when nothing changed', async () => {
    const { api, onSaved } = show(episode());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await settle();
    expect(onSaved).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('what an edit changed', () => {
  const art = (id: string, role = 'poster') => ({ id, role, mime_type: 'image/jpeg' });

  it('names each edited field, clears with null, and leaves out files and ids it never shows', () => {
    const before = episode({ media_ids: ['m1'], external_ids: { tmdb: '1' }, aliases: ['One'] });
    expect(itemChanges(before, { ...before, title: 'Renamed', year: null, aliases: ['One', 'Two'], media_ids: [] }))
      .toEqual({ title: 'Renamed', aliases: ['One', 'Two'] });
    expect(itemChanges(episode({ year: 2001 }), episode({ year: null }))).toEqual({ year: null });
  });

  it('sends artwork only when the chosen image changed its order', () => {
    const before = episode({ artwork: [art('a'), art('b'), art('s', 'still')] });
    expect(itemChanges(before, { ...before, artwork: [...before.artwork] })).toEqual({});
    expect(itemChanges(before, { ...before, artwork: [art('b'), art('a'), art('s', 'still')] }))
      .toEqual({ artwork: [art('b'), art('a'), art('s', 'still')] });
  });
});
