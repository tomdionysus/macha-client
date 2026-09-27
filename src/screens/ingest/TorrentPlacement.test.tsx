// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { endpointFailure, MachaAcquisitionApiError, type AcquisitionApi, type TorrentNodes } from '@machafoundation/core';
import { placementRefusalText, TorrentPlacement } from './TorrentPlacement';
import { settle } from '../../test/settle';

const nodes: TorrentNodes = { nodes: [{ node_id: 'gbni', host: 'gbni-1', local: false, reachable: true, as_of_unix_ms: 1, max_active: 4, active_jobs: 1, accepting: true, not_accepting_reason: null, staging: { limit_bytes: 1, disk_bytes: 1, reserved_bytes: 0, free_bytes: 1 } }] };

function show(job: { node_id: string | null; pinned_node_id?: string | null; remove_after_ms?: number | null }) {
  const updateTorrent = vi.fn(async () => ({}));
  const onChanged = vi.fn();
  render(<TorrentPlacement api={{ updateTorrent } as unknown as AcquisitionApi} job={{ id: 't1', ...job }} nodes={nodes} onChanged={onChanged} onError={vi.fn()} />);
  return { updateTorrent, onChanged };
}

describe('changing where a cluster torrent downloads (server 0.64.0)', () => {
  it('offers the node only while no node has claimed it, and pins or unpins it', async () => {
    const { updateTorrent, onChanged } = show({ node_id: null, pinned_node_id: null });
    fireEvent.change(screen.getByLabelText('Download on'), { target: { value: 'gbni' } });
    await settle();
    expect(updateTorrent).toHaveBeenCalledWith('t1', { nodeId: 'gbni' });
    await settle();
    expect(onChanged).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Download on'), { target: { value: '' } });
    await settle();
    expect(updateTorrent).toHaveBeenLastCalledWith('t1', { nodeId: null });
  });

  it('offers no node once a node has claimed it', () => {
    show({ node_id: 'gbni' });
    expect(screen.queryByLabelText('Download on')).toBeNull();
  });

  it('changes when it is removed, or keeps it', async () => {
    const { updateTorrent } = show({ node_id: 'gbni', remove_after_ms: null });
    const remove = screen.getByLabelText('Remove after completion') as HTMLSelectElement;
    expect(remove.value).toBe('');
    fireEvent.change(remove, { target: { value: '3600000' } });
    await settle();
    expect(updateTorrent).toHaveBeenCalledWith('t1', { removeAfterMs: 3_600_000 });
    fireEvent.change(remove, { target: { value: '' } });
    await settle();
    expect(updateTorrent).toHaveBeenLastCalledWith('t1', { removeAfterMs: null });
  });

  it('shows a removal time set elsewhere that is not one of its choices', () => {
    show({ node_id: 'gbni', remove_after_ms: 1_800_000 });
    expect((screen.getByLabelText('Remove after completion') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Remove 30 minutes after it completes');
  });

  it('says a node took it first when the change is refused for that, through the router\'s wrapping', () => {
    const late = endpointFailure('e', 'http://node', new MachaAcquisitionApiError('m', 409, 'invalid_state', 'not awaiting a node'));
    expect(placementRefusalText(late)).toBe('A node has already taken this torrent, so where it downloads can no longer be changed.');
    const unable = endpointFailure('e', 'http://node', new MachaAcquisitionApiError('m', 409, 'placement_failed', 'x', 'node_not_torrent_capable'));
    expect(placementRefusalText(unable)).toBe('That node cannot run torrents.');
  });
});
