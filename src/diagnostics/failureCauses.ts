import { isAccountSessionLimit, playbackFailureDetail } from '@machafoundation/core';

/**
 * The sentence the failure screen leads with.
 *
 * **Core's, and never `.message`.** Core's README states the rule every host
 * needs: by the time a playback failure has crossed `endpointFailure`, its
 * message reads *"Macha endpoint http://10.35.1.50:7438 failed: Macha
 * playback request failed: ..."* -- two envelopes and a node address in front
 * of somebody trying to watch a film. This client displayed exactly that, and
 * then grew a walk down the `cause` chain to say the rest of it, which was
 * the same fault one layer deeper. `playbackFailureDetail` carries the
 * server's own sentence from the moment it was parsed, from whichever layer
 * knew it, and is not reconstructed by stripping prefixes -- stripping means
 * matching on core's wording, which goes quiet the first time it is reworded.
 *
 * **`undefined` means write your own**, so this does, once. A terminal failure
 * is by definition one recovery could not finish; the sentence says that and
 * nothing it does not know. The failure trail beneath it still carries the
 * whole chain for anybody who switched it on, which is where the log line
 * belongs.
 */
export function playbackFailureHeadline(error: unknown): string {
  return playbackFailureDetail(error) ?? 'The stream stopped and could not be recovered.';
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
