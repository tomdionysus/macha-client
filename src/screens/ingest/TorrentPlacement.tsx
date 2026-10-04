import { useState } from 'react';
import { acquisitionError, type AcquisitionApi, type TorrentJob, type TorrentNodes } from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';
import { REMOVE_AFTER_CHOICES, torrentNodeLabel } from './clusterTorrents';

/** A refused change, in words. `invalid_state` is worded for this call only: a node claimed the torrent first. */
export function placementRefusalText(reason: unknown): string {
  if (acquisitionError(reason)?.code === 'invalid_state') return 'A node has already taken this torrent, so where it downloads can no longer be changed.';
  return viewerErrorText(reason);
}

/**
 * Changes where a cluster torrent downloads and when it is removed. The node is offered only while
 * no node has claimed it; the removal time can change at any point. A refusal is the caller's to show.
 */
export function TorrentPlacement({ api, job, nodes, onChanged, onError }: {
  api: AcquisitionApi;
  job: Pick<TorrentJob, 'id' | 'node_id' | 'pinned_node_id' | 'remove_after_ms'>;
  nodes?: TorrentNodes;
  onChanged: () => void;
  onError: (reason: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const update = (change: Parameters<AcquisitionApi['updateTorrent']>[1]) => {
    setBusy(true);
    void api.updateTorrent(job.id, change)
      .then(onChanged, onError)
      .finally(() => setBusy(false));
  };
  const unclaimed = !job.node_id;
  const removeAfter = job.remove_after_ms ?? null;
  // A time set elsewhere that is not one of the form's choices is still shown.
  const custom = removeAfter !== null && !REMOVE_AFTER_CHOICES.some((choice) => choice.ms === removeAfter);
  return (
    <div className="torrent-placement">
      {unclaimed && nodes && nodes.nodes.length > 0 && (
        <label>
          <span>Download on</span>
          <select data-tv-focusable="true" value={job.pinned_node_id ?? ''} disabled={busy} onChange={(event) => update({ nodeId: event.target.value || null })}>
            <option value="">Any node</option>
            {nodes.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{torrentNodeLabel(node)}</option>)}
          </select>
        </label>
      )}
      <label>
        <span>Remove after completion</span>
        <select data-tv-focusable="true" value={removeAfter === null ? '' : String(removeAfter)} disabled={busy} onChange={(event) => update({ removeAfterMs: event.target.value === '' ? null : Number(event.target.value) })}>
          <option value="">Keep it</option>
          {custom && <option value={String(removeAfter)}>{`Remove ${Math.round(removeAfter / 60_000)} minutes after it completes`}</option>}
          {REMOVE_AFTER_CHOICES.map((choice) => <option key={choice.ms} value={String(choice.ms)}>{`Remove ${choice.label.charAt(0).toLowerCase()}${choice.label.slice(1)}`}</option>)}
        </select>
      </label>
    </div>
  );
}
