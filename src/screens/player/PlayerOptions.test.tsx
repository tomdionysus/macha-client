// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaybackInstructionReport, PlaybackSession, PlaybackVersions, VersionStep } from '@machafoundation/core';
import { PlayerOptions } from './PlayerOptions';

const step = (quality: VersionStep['quality'], source: VersionStep['source'], mediaId: string, maxHeight?: number): VersionStep => ({
  quality, source, mediaId,
  instruction: { mode: source === 'file' ? 'direct' : 'transcode', video: source === 'file' ? 'copy' : 'transcode', audio: 'copy', reasons: [], assumed: [] },
  ...(maxHeight !== undefined ? { maxHeight } : {}),
});

// A 4K file and a 1080p file: 1440 and 720 are capped transcodes of them.
const versions: PlaybackVersions = {
  files: [],
  steps: [step(2160, 'file', 'uhd'), step(1440, 'transcode', 'uhd', 1440), step(1080, 'file', 'hd'), step(720, 'transcode', 'hd', 720)],
};

function session(mediaId: string, maxHeight: number | null): PlaybackSession {
  return {
    sessionId: 's', mediaId, mode: 'direct',
    preferences: { mode: 'direct', maxHeight, maxBitrate: null, audioStream: null, subtitleStream: null, audioLanguage: '', subtitleLanguage: '' },
    selected: { videoStream: 0, audioStream: 1, subtitleStream: -1 },
    transform: { video: 'copy', audio: 'copy' },
    output: {},
    options: { modes: ['direct', 'transcode'], qualityHeights: [720, 480], mediaIds: [mediaId], audioStreams: [], subtitleStreams: [], canSeek: true, canChangeQuality: true, canSwitchMedia: true },
  } as unknown as PlaybackSession;
}

const playing = (quality: VersionStep['quality']) => ({ chosenByViewer: true, reasons: [], assumed: [], quality }) as unknown as PlaybackInstructionReport;

const selected = () => screen.getAllByRole('button').filter((button) => button.className === 'selected').map((button) => button.textContent);

describe('the player\'s quality list', () => {
  it('lists the item\'s qualities, marks the one core says is playing and plays the one pressed', () => {
    const onPlayVersion = vi.fn();
    render(<PlayerOptions session={session('hd', null)} instruction={playing(1080)} versions={versions} onApply={vi.fn()} onPlayVersion={onPlayVersion} />);
    expect(['4K', '2K', '1080p', '720p'].every((label) => screen.getByRole('button', { name: label }))).toBe(true);
    expect(selected()).toContain('1080p');
    expect(selected()).not.toContain('4K');
    fireEvent.click(screen.getByRole('button', { name: '2K' }));
    expect(onPlayVersion).toHaveBeenCalledWith(versions.steps[1]);
  });

  it('marks nothing while core has not said which quality is playing', () => {
    render(<PlayerOptions session={session('hd', 720)} versions={versions} onApply={vi.fn()} onPlayVersion={vi.fn()} />);
    expect(selected().filter((label) => ['4K', '2K', '1080p', '720p'].includes(label ?? ''))).toEqual([]);
  });

  it('keeps the node\'s own heights until the item\'s qualities are known', () => {
    render(<PlayerOptions session={session('hd', null)} onApply={vi.fn()} onPlayVersion={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Original' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '4K' })).toBeNull();
  });
});
