// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi, MediaSummary } from '@machafoundation/core';
import { MediaCard } from './MediaCard';

const api = {} as MediaApi;

describe('a track card on Music', () => {
  it('names the album, then the artist below it', () => {
    const track = {
      id: 't1', kind: 'track', title: 'A Song', subtitle: 'Track 2', mediaIds: [],
      musicContext: { album: { id: 'a1', title: 'An Album', year: 1997 }, artist: { id: 'r1', title: 'An Artist' } },
    } as MediaSummary;
    render(
      <MemoryRouter>
        <MediaCard api={api} item={track} onOpen={vi.fn()} actions={[{ label: 'Add track to playlist', onSelect: vi.fn() }]} />
      </MemoryRouter>,
    );
    const lines = [...document.querySelectorAll('.card-title, .card-subtitle')].map((node) => node.textContent);
    expect(lines).toEqual(['A Song', 'An Album', 'An Artist']);
    expect(screen.queryByText('Track 2')).toBeNull();
  });
});

describe('a title\'s availability marker', () => {
  const film = (availability?: string) => ({ id: 'm1', kind: 'movie', title: 'A Film', mediaIds: ['f1'], availability }) as MediaSummary;
  const show = (item: MediaSummary, onOpen = vi.fn()) => {
    render(<MemoryRouter><MediaCard api={api} item={item} onOpen={onOpen} /></MemoryRouter>);
    return onOpen;
  };

  it('marks a partial title with a red triangle that says what it means, and it still opens', () => {
    const onOpen = show(film('partial'));
    const marker = screen.getByRole('img', { name: /Part of this film is held only by servers that can't be reached/ });
    expect(marker.classList.contains('availability-partial')).toBe(true);
    expect(marker.getAttribute('title')).toBe(marker.getAttribute('aria-label'));
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('greys out an unavailable title, with a crossed circle, and does not let it be selected', () => {
    const onOpen = show(film('unavailable'));
    expect(screen.getByRole('img', { name: /can't be played/ }).classList.contains('availability-unavailable')).toBe(true);
    const card = screen.getByRole('button');
    expect(card.classList.contains('is-unavailable')).toBe(true);
    expect(card.getAttribute('aria-disabled')).toBe('true');
    expect(card.hasAttribute('data-tv-focusable')).toBe(false);
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks an unchecked title with a yellow question mark, and it still opens', () => {
    const onOpen = show(film('unknown'));
    expect(screen.getByRole('img', { name: /hasn't yet checked/ }).classList.contains('availability-unknown')).toBe(true);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('marks nothing for a complete title, or one the server has not described', () => {
    show(film('complete'));
    show({ ...film(undefined), id: 'm2' });
    expect(screen.queryByRole('img')).toBeNull();
  });
});
