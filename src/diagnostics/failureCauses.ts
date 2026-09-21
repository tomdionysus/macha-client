import { isAccountSessionLimit } from '@machafoundation/core';

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

/**
 * The one playback failure a viewer can actually act on, said in those terms.
 *
 * The server's per-account session cap answers `429 account_session_limit`, and
 * what reaches this screen otherwise is core's message — *"Macha playback
 * request failed"* — in front of a node that is behaving exactly as designed.
 * That reads as a breakage and sends somebody to check a server that is fine.
 *
 * **The match is core's, deliberately.** `isAccountSessionLimit` walks the
 * cause chain cycle-safe and owns the code string; four clients each matching
 * that string themselves is how they drift apart, and this client would be the
 * one that kept matching it after core changed it.
 *
 * Worth more here than on a television: this screen has an address bar behind
 * it, so a viewer told which screen to close has somewhere to go.
 *
 * **Something to branch on, never the headline.** A cap refusal reaches this
 * screen as the reason a *recovery* could not finish, not as the thing that
 * went wrong — core's head is the failure that started the recovery, which may
 * well be a node dying under the viewer. Leading with this would tell somebody
 * their account is busy while their node is on fire.
 */
export function accountSessionLimitNotice(error: unknown): string | undefined {
  if (!isAccountSessionLimit(error)) return undefined;
  return 'This account already has as many things playing as it is allowed. Stop playback on another screen and try again.';
}
