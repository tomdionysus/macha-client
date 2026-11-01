import { acquisitionError, type IngestAddResult, type IngestNode } from '@machafoundation/core';
import { viewerErrorText } from '../../text/viewerText';

const UNAVAILABLE: Record<NonNullable<IngestNode['unavailableReason']>, string> = {
  not_online: 'offline',
  before_placement: 'needs server 0.91.1',
};

/** A node in the import form's selector; one that cannot take an import says why. */
export function ingestNodeLabel(node: IngestNode): string {
  return node.unavailableReason ? `${node.name} (${UNAVAILABLE[node.unavailableReason]})` : node.name;
}

/**
 * A refused import. A bad path is the running node's own sentence, as `viewerErrorText` gives it,
 * since only that node knows its source roots and whether imports are switched on there.
 */
export function ingestRefusalText(reason: unknown): string {
  if (acquisitionError(reason)?.code === 'node_unreachable') return 'That node cannot be reached right now. Try again shortly.';
  return viewerErrorText(reason);
}

/** Said once an import is queued: where it runs, and when the node asked for was passed over. */
export function importQueuedText(result: IngestAddResult, path: string, names: ReadonlyMap<string, string>, asked?: string): string {
  if (result.placementIgnored) {
    return `Import queued: ${path}. The server that took it cannot place imports yet, so it reads this path on its own disk, not on ${names.get(asked ?? '') ?? 'the node chosen'}.`;
  }
  const on = result.nodeId ? names.get(result.nodeId) : undefined;
  return on ? `Import queued on ${on}: ${path}` : `Import queued: ${path}`;
}
