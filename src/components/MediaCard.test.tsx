// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi, MediaSummary } from '@machafoundation/core';
import { MediaCard } from './MediaCard';

const api = {} as MediaApi;

describe('a track card on Music', () => {
  it('names the album, then the artist below it', () => {
    const track = {
      id: 't1', kind: 'track', title: 'Joga', subtitle: 'Track 2', mediaIds: [],
      musicContext: { album: { id: 'a1', title: 'Homogenic', year: 1997 }, artist: { id: 'r1', title: 'Björk' } },
    } as MediaSummary;
    render(
      <MemoryRouter>
        <MediaCard api={api} item={track} onOpen={vi.fn()} actions={[{ label: 'Add track to playlist', onSelect: vi.fn() }]} />
      </MemoryRouter>,
    );
    const lines = [...document.querySelectorAll('.card-title, .card-subtitle')].map((node) => node.textContent);
    expect(lines).toEqual(['Joga', 'Homogenic', 'Björk']);
    expect(screen.queryByText('Track 2')).toBeNull();
  });
});
