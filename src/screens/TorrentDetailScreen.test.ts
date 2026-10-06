import { describe, expect, it } from 'vitest';
import type { TorrentJobState } from '@machafoundation/core';
import { downloadStageText, PIECES_MISSING_TEXT, swarmText } from './TorrentDetailScreen';

const job = (state: TorrentJobState, eta: number | null = 90, availability?: number) => ({
  state, bytes_completed: 512 * 1024 * 1024, bytes_total: 1024 * 1024 * 1024, eta_seconds: eta,
  swarm: availability === undefined ? null : { seeds: 3, peers: 12, availability },
});

describe('the torrent page\'s first stage', () => {
  it('says a torrent is waiting for another torrent\'s check, not downloading', () => {
    expect(downloadStageText(job('verify_queued', null), 512 * 1024 * 1024)).toEqual({ doing: 'Waiting to verify', detail: 'Waiting for another torrent\'s check to finish' });
  });

  it('says a torrent is checking what it has, with the check\'s ETA', () => {
    const text = downloadStageText(job('verifying'), 512 * 1024 * 1024);
    expect(text.doing).toBe('Verifying data already on disk');
    expect(text.detail).toMatch(/ verified · ETA 2m$/);
    expect(text.detail).not.toMatch(/to go/);
  });

  it('is downloading otherwise, with what is left and its ETA', () => {
    const text = downloadStageText(job('downloading'), 512 * 1024 * 1024);
    expect(text.doing).toBe('Downloading');
    expect(text.detail).toMatch(/ to go · ETA 2m$/);
  });

  it('says why a download cannot finish when its peers lack a piece between them, and not otherwise', () => {
    expect(downloadStageText(job('downloading', 90, 0.82), 512 * 1024 * 1024).detail).toMatch(new RegExp(`· ${PIECES_MISSING_TEXT}$`));
    expect(downloadStageText(job('downloading', 90, 1.4), 512 * 1024 * 1024).detail).not.toContain(PIECES_MISSING_TEXT);
    expect(downloadStageText(job('downloading', 90, 0.82), 0).detail).not.toContain(PIECES_MISSING_TEXT);
  });

  it('gives the swarm as the trackers count it, and how much of the torrent the peers hold', () => {
    expect(swarmText({ seeds: 3, peers: 12, availability: 0.82 })).toBe('0.82 available · 3 seeds · 12 peers');
    expect(swarmText({ seeds: null, peers: null, availability: 2 })).toBe('2.00 available');
  });
});
