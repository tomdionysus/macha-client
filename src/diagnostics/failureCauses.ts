/**
 * The failures beneath the one a screen is naming, in the order they happened.
 *
 * Core chains a terminal playback failure: `terminalRecoveryError` returns the
 * error that *started* the recovery and appends the attempt that ended it at
 * the tail of the `cause` chain, so that a host can say either, or both. This
 * client was saying only the head — which is the right thing to lead with, and
 * silently threw away the rest. The two are different facts and a viewer who
 * reports one of them is reporting half the story: what began the failover
 * names the node that was actually serving them, and what ended it names the
 * candidate that could not be reached.
 *
 * **Only `Error` causes are followed.** A `PlaybackSourceError` carries its
 * evidence in `cause` too — an hls.js error payload, a fetch response — and
 * those are diagnostics for a log, not a sentence to put in front of somebody.
 * Core's own walk draws the line in the same place.
 *
 * Cycle-safe by remembering what it has already visited, because an error
 * chain assembled from several layers can be made to point at itself, and a
 * viewer waiting on a hung failure screen is worse off than one told less.
 */
export function failureCauseMessages(error: unknown): string[] {
  const messages: string[] = [];
  if (!(error instanceof Error)) return messages;
  const seen = new Set<Error>([error]);
  // The head is what the screen already says, so it is skipped here — and its
  // text is kept, so a cause repeating it verbatim is not shown twice.
  const said = new Set<string>([error.message.trim()]);
  let next = error.cause;
  while (next instanceof Error && !seen.has(next)) {
    seen.add(next);
    const message = next.message.trim();
    if (message && !said.has(message)) {
      said.add(message);
      messages.push(message);
    }
    next = next.cause;
  }
  return messages;
}
