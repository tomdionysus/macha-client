// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueApi, CatalogueItem, PlaybackFactsApi } from '@machafoundation/core';
import { MetadataEditorScreen } from './MetadataEditorScreen';

const episode = (overrides: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id: 'ep-1', kind: 'episode', title: 'Pilot', sort_title: 'Pilot', synopsis: '', parent_id: 'season-1', year: null,
  season_number: 1, episode_number: 1, disc_number: null, track_number: null,
  aliases: [], external_ids: {}, media_ids: [], artwork: [], revision: 4, updated_ns: 0, ...overrides,
});

function show(item: CatalogueItem) {
  const api = {
    get: vi.fn(async () => item),
    update: vi.fn(async (next: CatalogueItem) => next),
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
    const input = (await screen.findByText('Upload a new still')).closest('label')?.querySelector('input') as HTMLInputElement;
    const image = new File(['x'], 'still.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [image] } });
    await waitFor(() => expect(api.putArtwork).toHaveBeenCalledWith('ep-1', 'still', 'image/png', image));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('holds uploads while there are unsaved changes, and says why', async () => {
    show(episode());
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Pilot, retitled' } });
    const input = screen.getByText('Upload a new still').closest('label')?.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/Save or cancel your changes before uploading/)).toBeTruthy();
  });

  it('saves the shared fields as numbers, with the metadata locked', async () => {
    const { api, onSaved } = show(episode());
    fireEvent.change(await screen.findByLabelText('Episode number'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ episode_number: 7, external_ids: expect.objectContaining({ macha_metadata_locked: '1' }) }), 4);
  });
});
