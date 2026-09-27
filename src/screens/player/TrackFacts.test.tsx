// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MediaSummary } from '@machafoundation/core';
import { TrackFacts } from './TrackFacts';

const track = (overrides: Partial<MediaSummary>) => ({ id: 't', kind: 'track', title: 'A Song', mediaIds: [], ...overrides }) as MediaSummary;

function lines(item: MediaSummary): string[] {
  const { container } = render(<TrackFacts track={item} />);
  return [...container.querySelectorAll('p')].map((line) => line.textContent ?? '');
}

describe('the facts under a track\'s artwork', () => {
  it('lists the artist, the album with its year, and the track', () => {
    expect(lines(track({
      trackNumber: 4,
      musicContext: { album: { id: 'al', title: 'An Album', year: 1997 }, artist: { id: 'ar', title: 'An Artist' } },
    }))).toEqual(['An Artist', 'An Album (1997)', 'Track 4']);
  });

  it('names the disc only when there is more than one', () => {
    expect(lines(track({ trackNumber: 2, discNumber: 2, musicContext: { album: { id: 'al', title: 'An Album' } } })))
      .toEqual(['An Album', 'Disc 2 · Track 2']);
  });

  it('shows what a track restored from an older queue still has', () => {
    expect(lines(track({ trackNumber: 7 }))).toEqual(['Track 7']);
    expect(lines(track({}))).toEqual([]);
  });

  it('ends with the playing file\'s format line, which wraps only between its fields', () => {
    const { container } = render(<TrackFacts track={track({ trackNumber: 4 })} format="6:43 · FLAC · 16-bit · 44.1 kHz · Stereo · 926 kbps" />);
    const line = container.querySelector('.audio-player-format');
    expect(line?.textContent).toBe('6:43 · FLAC · 16-bit · 44.1 kHz · Stereo · 926 kbps');
    expect([...container.querySelectorAll('.media-line-field')].map((field) => field.textContent)).toEqual(['6:43', 'FLAC', '16-bit', '44.1 kHz', 'Stereo', '926 kbps']);
  });

  it('shows the format line alone for a track that carries nothing else', () => {
    expect(lines(track({}))).toEqual([]);
    const { container } = render(<TrackFacts track={track({})} format="0:45 · MP3" />);
    expect(container.querySelector('.audio-player-format')?.textContent).toBe('0:45 · MP3');
  });
});

