// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaApi, MediaDetails, PlaybackMode, PlaybackVersions, VersionFile, VersionStep } from '@machafoundation/core';
import { DetailScreen, fileSummary } from './DetailScreen';

const step = (quality: VersionStep['quality'], source: VersionStep['source']): VersionStep => ({
  quality,
  source,
  mediaId: 'macha:big',
  instruction: { mode: source === 'file' ? 'direct' : 'transcode', video: source === 'file' ? 'copy' : 'transcode', audio: 'copy', reasons: [], assumed: [] },
  ...(source === 'transcode' ? { maxHeight: quality } : {}),
});

function show(details: MediaDetails, versions: PlaybackVersions) {
  const api = { details: vi.fn(async () => details) } as unknown as MediaApi;
  const loadVersions = vi.fn(async () => versions);
  const onPlayVersion = vi.fn();
  render(<DetailScreen api={api} itemId={details.id} onBack={vi.fn()} onPlay={vi.fn()} onPlayFromStart={vi.fn()} loadVersions={loadVersions} onPlayVersion={onPlayVersion} />);
  return { loadVersions, onPlayVersion };
}

const film = { id: 'film', kind: 'movie', title: 'A film', mediaIds: ['macha:big'] } as MediaDetails;
const fourK: PlaybackVersions = {
  files: [],
  steps: [step(2160, 'file'), step(1440, 'transcode'), step(1080, 'transcode'), step(720, 'transcode')],
  automatic: step(1080, 'transcode'),
  limitedBy: { quality: 1080, reason: 'ceiling-display' },
};

// Queried by title, not by role and name: role queries compute every
// button's accessible name on each poll. Measured back to back on this shared
// machine at load 100-190, the first test took 500-630 ms by title and
// 1460-2470 ms by role, past findBy's 1000 ms, which failed a full run.
describe('the detail page\'s quality buttons', () => {
  it('offers Play and one button per quality, and plays the one pressed', async () => {
    const { onPlayVersion } = show(film, fourK);
    expect(await screen.findByTitle('Play at 4K')).toBeTruthy();
    expect(screen.getByTitle('Play')).toBeTruthy();
    expect(screen.getAllByTitle(/^Play at /).map((button) => button.textContent)).toEqual(['4K', '2K', '1080p', '720p']);
    fireEvent.click(screen.getByTitle('Play at 720p'));
    expect(onPlayVersion).toHaveBeenCalledWith(film, fourK.steps[3]);
  });

  it('says why Play will not choose the largest file when the screen caps it', async () => {
    show(film, fourK);
    expect(await screen.findByText('Play chooses up to 1080p, the most this screen shows. Pick a quality to play another.')).toBeTruthy();
  });

  it('says nothing about a cap that kept Play off no file', async () => {
    show(film, { ...fourK, limitedBy: undefined });
    await screen.findByTitle('Play at 4K');
    expect(screen.queryByText(/Play chooses up to/)).toBeNull();
  });

  it('offers a track no qualities, as it has no picture', async () => {
    const track = { id: 'track', kind: 'track', title: 'A track', mediaIds: ['macha:song'] } as MediaDetails;
    const { loadVersions } = show(track, fourK);
    expect(await screen.findByTitle('Play')).toBeTruthy();
    expect(loadVersions).not.toHaveBeenCalled();
    expect(screen.queryAllByTitle(/^Play at /)).toHaveLength(0);
  });
});

const file = (quality: VersionFile['quality'], mode: PlaybackMode, index: number): VersionFile => ({
  mediaId: `macha:${index}`, quality, index,
  instruction: { mode, video: mode === 'transcode' ? 'transcode' : 'copy', audio: 'copy', reasons: [], assumed: [] },
});

describe('a title\'s files, below its title', () => {
  it('groups the files by how this device plays them, largest first', () => {
    expect(fileSummary([file(1080, 'direct', 0), file(2160, 'direct', 1), file(720, 'transcode', 2), file(1080, 'remux', 3)]))
      .toEqual(['Direct: 4K, 1080p', 'Remux: 1080p', 'Transcode: 720p']);
  });

  it('counts files that share a quality rather than hiding the second', () => {
    expect(fileSummary([file(1080, 'direct', 0), file(1080, 'direct', 1), file(2160, 'direct', 2)])).toEqual(['Direct: 4K, 1080p ×2']);
  });

  it('says nothing for a title with one file', () => {
    expect(fileSummary([file(1080, 'direct', 0)])).toEqual([]);
  });

  it('shows the groups as pills on the page for a title with several files', async () => {
    show(film, { ...fourK, files: [file(2160, 'direct', 0), file(1080, 'direct', 1)] });
    expect((await screen.findByLabelText('Files')).textContent).toBe('Direct: 4K, 1080p');
  });

  it('shows no pills for a title with one file', async () => {
    show(film, { ...fourK, files: [file(2160, 'direct', 0)] });
    await screen.findByTitle('Play at 4K');
    expect(screen.queryByLabelText('Files')).toBeNull();
  });
});
