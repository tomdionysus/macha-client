import { clientDiagnosticsConsole, type ClientLogEntry } from '@machafoundation/core';

/**
 * The evidence behind a playback failure, in the failure's own words.
 *
 * A television has no console. Every Samsung-only fault this client has had
 * was diagnosed by reasoning from source, redeploying, and asking someone
 * watching the screen what changed — and the diagnostics buffer that would
 * have answered it in one line was sitting in memory the whole time, reachable
 * only from a developer console the set does not have. So the failure screen
 * reads it out.
 *
 * Deliberately only warnings and errors. The buffer holds nothing else on the
 * Samsung build anyway (it is configured at `warn`), and a screen that also
 * listed every routine step would bury the three lines that matter.
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
    // Errors nested in a data object stringify to `{}`, which is the one case
    // where the whole point of the line is the message inside them.
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
