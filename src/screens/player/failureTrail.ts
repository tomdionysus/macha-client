import { clientDiagnosticsConsole, type ClientLogEntry } from '@machafoundation/core';

/**
 * One diagnostics-buffer line, read out on the failure screen because a
 * television has no console. Warnings and errors only.
 */
export interface PlaybackFailureTrailEntry {
  atMs: number;
  level: string;
  event: string;
  detail?: string;
}

/** Long enough for a walk around the cluster, short enough to read at a distance. */
const TRAIL_ENTRIES = 12;
const DETAIL_CHARS = 160;

function detailOf(entry: ClientLogEntry): string | undefined {
  const { data } = entry;
  if (data === undefined || data === null) return undefined;
  if (typeof data !== 'object') return String(data);
  if (data instanceof Error) return data.message;
  try {
    // An Error nested in a data object would stringify to `{}`; keep its message.
    const text = JSON.stringify(data, (_key, value) => (
      value instanceof Error ? value.message : value
    ));
    if (!text || text === '{}') return undefined;
    return text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS)}…` : text;
  } catch {
    return undefined;
  }
}

export function playbackFailureTrail(
  entries: readonly ClientLogEntry[] = clientDiagnosticsConsole().snapshot(),
): PlaybackFailureTrailEntry[] {
  return entries
    .filter((entry) => entry.level === 'warn' || entry.level === 'error')
    .slice(-TRAIL_ENTRIES)
    .map((entry) => ({
      atMs: entry.elapsedMs,
      level: entry.level,
      event: `${entry.scope} ${entry.event}`,
      detail: detailOf(entry),
    }));
}
