// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueMediaProfile, MediaApi, MediaDetails, PlaybackMediaFacts, PlaybackVersions, VersionStep } from '@machafoundation/core';
import { DetailScreen } from './DetailScreen';
import { settle } from '../test/settle';

const step = (quality: VersionStep['quality'], source: VersionStep['source']): VersionStep => ({
  quality,
  source,
  mediaId: 'macha:big',
  instruction: { mode: source === 'file' ? 'direct' : 'transcode', video: source === 'file' ? 'copy' : 'transcode', audio: 'copy', reasons: [], assumed: [] },
  ...(source === 'transcode' ? { maxHeight: quality } : {}),
});

function show(details: MediaDetails, versions: PlaybackVersions, files: PlaybackMediaFacts[] = []) {
  const api = { details: vi.fn(async () => details) } as unknown as MediaApi;
  const loadFiles = vi.fn(async () => files);
  const loadVersions = vi.fn(async () => versions);
  const onPlayVersion = vi.fn();
  render(<DetailScreen api={api} itemId={details.id} onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} loadFiles={loadFiles} versionsOf={loadVersions} onPlayVersion={onPlayVersion} />);
  return { loadFiles, loadVersions, onPlayVersion };
}

const film = { id: 'film', kind: 'movie', title: 'A film', mediaIds: ['macha:big'] } as MediaDetails;
const fourK: PlaybackVersions = {
  // Core sets limitedBy only when a file is above the ceiling, as this 4K file is.
  files: [{ quality: 2160, instruction: step(2160, 'file').instruction, index: 0 }],
  steps: [step(2160, 'file'), step(1440, 'transcode'), step(1080, 'transcode'), step(720, 'transcode')],
  automatic: step(1080, 'transcode'),
  limitedBy: { quality: 1080, reason: 'ceiling-display' },
};

// Queried by title: role queries compute every button's accessible name on each poll, which can
// outrun findBy's timeout.
describe('the detail page\'s quality buttons', () => {
  it('offers Play and one button per quality, and plays the one pressed', async () => {
    const { onPlayVersion } = show(film, fourK);
    await settle();
    expect(screen.getByTitle('Play at 4K')).toBeTruthy();
    expect(screen.getByTitle('Play')).toBeTruthy();
    expect(screen.getAllByTitle(/^Play at /).map((button) => button.textContent)).toEqual(['4K', '2K', '1080p', '720p']);
    fireEvent.click(screen.getByTitle('Play at 720p'));
    expect(onPlayVersion).toHaveBeenCalledWith(film, fourK.steps[3]);
  });

  it('says why Play will not choose the largest file when the screen caps it', async () => {
    show(film, fourK);
    await settle();
    expect(screen.getByText('Play chooses 1080p. 4K is more than this screen shows. Pick a quality to play another.')).toBeTruthy();
  });

  it('says nothing about a cap that kept Play off no file', async () => {
    show(film, { ...fourK, limitedBy: undefined });
    await settle();
    screen.getByTitle('Play at 4K');
    expect(screen.queryByText(/Play chooses/)).toBeNull();
  });

  it('offers a track no qualities, as it has no picture', async () => {
    const track = { id: 'track', kind: 'track', title: 'A track', mediaIds: ['macha:song'] } as MediaDetails;
    const { loadVersions } = show(track, fourK);
    await settle();
    expect(screen.getByTitle('Play')).toBeTruthy();
    expect(loadVersions).not.toHaveBeenCalled();
    expect(screen.queryAllByTitle(/^Play at /)).toHaveLength(0);
  });
});

const profileOf = (mediaId: string, width: number, height: number, video: string, audio: string, bitrate: number): CatalogueMediaProfile => ({
  schema_version: 1, media_id: mediaId, format: 'matroska,webm', duration_ms: 9_060_000, bitrate,
  streams: [
    { index: 0, type: 'video', codec: video, profile: 'Main', language: 'und', width, height, channels: 0, sample_rate: 0, bit_depth: 10, default: true, forced: false, bitrate: 0, attached_picture: false },
    { index: 1, type: 'audio', codec: audio, profile: '', language: 'eng', width: 0, height: 0, channels: 8, sample_rate: 48_000, bit_depth: 0, default: true, forced: false, bitrate: 0, attached_picture: false },
  ],
});

describe('a title\'s files, one line each', () => {
  it('shows each file\'s format on its own line, and readies playback from the first', async () => {
    const twoFiles = { ...film, mediaIds: ['macha:uhd', 'macha:hd'] } as MediaDetails;
    const profiles: Record<string, CatalogueMediaProfile> = {
      'macha:uhd': profileOf('macha:uhd', 3840, 2160, 'hevc', 'truehd', 47_400_000),
      'macha:hd': profileOf('macha:hd', 1920, 1080, 'h264', 'aac', 8_000_000),
    };
    const api = { details: vi.fn(async () => twoFiles), mediaProfile: vi.fn(async (id: string) => profiles[id]) } as unknown as MediaApi;
    const onMediaProfile = vi.fn();
    const { container } = render(<DetailScreen api={api} itemId="film" onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} onMediaProfile={onMediaProfile} />);
    await settle();
    screen.getByText(/3840×2160/);
    expect([...container.querySelectorAll('.media-profile-summary')].map((line) => line.textContent)).toEqual([
      // Core's parts, laid out as given.
      '2h 31m · 3840×2160 (4K) · HEVC · TRUEHD · 7.1 · 47.4 Mbps',
      '2h 31m · 1920×1080 (1080p) · H.264 · AAC · 7.1 · 8.0 Mbps',
    ]);
    expect(onMediaProfile).toHaveBeenCalledWith(profiles['macha:uhd']);
  });

  it('leaves out a file whose profile cannot be read, and shows the rest', async () => {
    const twoFiles = { ...film, mediaIds: ['macha:gone', 'macha:hd'] } as MediaDetails;
    const api = {
      details: vi.fn(async () => twoFiles),
      mediaProfile: vi.fn(async (id: string) => { if (id === 'macha:gone') throw new Error('not found'); return profileOf(id, 1920, 1080, 'h264', 'aac', 8_000_000); }),
    } as unknown as MediaApi;
    const { container } = render(<DetailScreen api={api} itemId="film" onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} />);
    await settle();
    screen.getByText(/1920×1080/);
    expect(container.querySelectorAll('.media-profile-summary')).toHaveLength(1);
  });
});

describe('files that are the same', () => {
  it('share one line on the page, as core combines them', async () => {
    const threeFiles = { ...film, mediaIds: ['macha:a', 'macha:b', 'macha:c'] } as MediaDetails;
    const same = profileOf('macha:a', 1920, 1080, 'h264', 'aac', 8_000_000);
    const profiles: Record<string, CatalogueMediaProfile> = {
      'macha:a': same,
      'macha:b': { ...same, media_id: 'macha:b' },
      'macha:c': profileOf('macha:c', 3840, 2160, 'hevc', 'truehd', 47_400_000),
    };
    const api = { details: vi.fn(async () => threeFiles), mediaProfile: vi.fn(async (id: string) => profiles[id]) } as unknown as MediaApi;
    const { container } = render(<DetailScreen api={api} itemId="film" onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} />);
    await settle();
    screen.getByText(/3840×2160/);
    expect([...container.querySelectorAll('.media-profile-summary')].map((line) => line.textContent)).toEqual([
      // Core's parts, laid out as given.
      '2h 31m · 3840×2160 (4K) · HEVC · TRUEHD · 7.1 · 47.4 Mbps',
      '2h 31m · 1920×1080 (1080p) · H.264 · AAC · 7.1 · 8.0 Mbps',
    ]);
  });
});

describe('which files can be played', () => {
  const fileFacts = (mediaId: string, availability?: string) => ({ mediaId, ...(availability ? { availability: { availability } } : {}) }) as unknown as PlaybackMediaFacts;

  it('marks each file line that cannot be played in full, and never the title', async () => {
    const twoFiles = { ...film, availability: 'partial', mediaIds: ['macha:uhd', 'macha:hd'] } as MediaDetails;
    const profiles: Record<string, CatalogueMediaProfile> = {
      'macha:uhd': profileOf('macha:uhd', 3840, 2160, 'hevc', 'truehd', 47_400_000),
      'macha:hd': profileOf('macha:hd', 1920, 1080, 'h264', 'aac', 8_000_000),
    };
    const api = { details: vi.fn(async () => twoFiles), mediaProfile: vi.fn(async (id: string) => profiles[id]) } as unknown as MediaApi;
    const files = [fileFacts('macha:uhd', 'partial'), fileFacts('macha:hd', 'complete')];
    const { container } = render(<DetailScreen api={api} itemId="film" onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} loadFiles={async () => files} />);
    await settle();
    screen.getByText(/3840×2160/);
    expect(container.querySelector('h1 .availability-marker')).toBeNull();
    expect([...container.querySelectorAll('.media-profile-file')].map((line) => line.querySelector('.availability-marker')?.className ?? 'none'))
      .toEqual([expect.stringContaining('availability-partial'), 'none']);
  });
});

describe('an episode\'s own page', () => {
  it('names its series and season as links back, and offers Play, the qualities and Edit as a film does', async () => {
    const episode = {
      id: 'ep', kind: 'episode', title: 'Pilot', seasonNumber: 1, episodeNumber: 1, mediaIds: ['macha:big'],
      playbackContext: { series: { id: 'show-1', title: 'The Show' }, season: { id: 'season-1', title: 'Season 1', seasonNumber: 1 } },
    } as unknown as MediaDetails;
    const api = { details: vi.fn(async () => episode) } as unknown as MediaApi;
    const onEdit = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <DetailScreen api={api} itemId="ep" onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} loadFiles={async () => []} versionsOf={async () => fourK} onPlayVersion={vi.fn()} onEdit={onEdit} />
      </MemoryRouter>,
    );
    await settle();
    expect(screen.getByRole('link', { name: 'The Show' }).getAttribute('href')).toBe('/series/show-1');
    expect(screen.getByRole('link', { name: 'Season 1' }).getAttribute('href')).toBe('/series/show-1/seasons/season-1');
    expect(container.querySelector('.episode-detail-layout')).toBeTruthy();
    screen.getByTitle('Play');
    screen.getByTitle('Play at 720p');
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
  });
});
