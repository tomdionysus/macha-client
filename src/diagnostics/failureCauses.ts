import { isAccountSessionLimit, playbackFailureCode, playbackFailureDetail } from '@machafoundation/core';
import { playbackFailureCodeText } from '../text/viewerText';

/**
 * The sentence the failure screen leads with. Never `.message`, which wraps the fault in
 * envelopes and a node address; `playbackFailureDetail` is the server's own sentence.
 */
export function playbackFailureHeadline(error: unknown): string {
  // Core's code worded here, else the server's sentence, else this screen's own.
  return playbackFailureCodeText(playbackFailureCode(error))
    ?? playbackFailureDetail(error)
    ?? 'The stream stopped and could not be recovered.';
}

/**
 * The session-cap refusal (`429 account_session_limit`) in terms a viewer can act on,
 * matched by core's `isAccountSessionLimit`. Shown beside the headline, never as it: the
 * cap is why a recovery could not finish, not what first went wrong.
 */
export function accountSessionLimitNotice(error: unknown): string | undefined {
  if (!isAccountSessionLimit(error)) return undefined;
  return 'This account already has as many things playing as it is allowed. Stop playback on another screen and try again.';
}
