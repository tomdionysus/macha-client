import { describe, expect, it } from 'vitest';
import type { TorrentJobState } from '@machafoundation/core';
import { downloadStageText } from './TorrentDetailScreen';

const job = (state: TorrentJobState, eta: number | null = 90) => ({ state, bytes_completed: 512 * 1024 * 1024, bytes_total: 1024 * 1024 * 1024, eta_seconds: eta });

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
});
