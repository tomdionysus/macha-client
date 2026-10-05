// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Episode, MediaApi } from '@machafoundation/core';
import { EpisodeRail } from './EpisodeRail';

const episode = (id: string, n: number, availability?: string) => ({
  id, kind: 'episode', title: `Episode ${n}`, seasonNumber: 1, episodeNumber: n, mediaIds: [`macha:${id}`],
  playbackContext: { series: { id: 's', title: 'The Show' }, season: { id: 'se', title: 'Season 1', seasonNumber: 1 } },
  ...(availability ? { availability } : {}),
}) as unknown as Episode;

describe('a season\'s episodes', () => {
  it('open the episode\'s page rather than playing it', () => {
    const onOpenEpisode = vi.fn();
    const episodes = [episode('e1', 1), episode('e2', 2)];
    render(<EpisodeRail api={{ artworkUrls: () => [] } as unknown as MediaApi} episodes={episodes} progress={new Map()} onOpenEpisode={onOpenEpisode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Episode 2' }));
    expect(onOpenEpisode).toHaveBeenCalledWith(episodes[1]);
    expect(screen.queryByRole('button', { name: /from start/ })).toBeNull();
  });
});
