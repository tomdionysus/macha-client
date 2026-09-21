import { sessionLockedOut, type UserRole } from '@machafoundation/core';

/** Why the sign-in wall is standing in front of this viewer, if it is. */
export type LockoutReason = 'no-roles' | 'refused';

/**
 * What to tell a viewer the wall is for.
 *
 * **A locked-out viewer used to get the sign-in form and nothing else**, which
 * is the one screen that cannot help them: their credentials were fine, and
 * typing them again produces the same session with the same nothing. A
 * television reproduced it twice on a clean install — signed in, no
 * navigation, and a catalogue answering *"this action requires the
 * 'media_viewer' role"* in a `403` nobody reads.
 *
 * **`undefined` is unknown, `[]` is granted nothing**, and they must not share
 * a sentence. A node too old to state roles leaves `roles` undefined for ever
 * and core treats that as permissive on purpose; saying "you have no roles"
 * there would lock a viewer out of a cluster that simply never answered the
 * question. `sessionLockedOut` is core's, so all four clients draw the line in
 * the same place.
 *
 * **The remedy comes first, and it is signing in.** A session granted
 * nothing means one of three things: a cluster that carries no anonymous
 * viewer, a signed-in account that genuinely holds nothing, or core's
 * credential-less re-mint having replaced a working session after a `401`.
 * Two of the three are answered by signing in, and only the middle one needs
 * an administrator — so a sentence that leads with *ask an administrator*
 * sends most of these viewers to the wrong person, and they cannot tell from
 * the screen that it is the wrong one. Accurate about the state and wrong
 * about the remedy is still wrong: the remedy is the only part a viewer can
 * act on. (The phone client's finding, 2026-09-21.)
 *
 * **A refusal is not a role problem.** `mintFailure.reason === 'refused'` is
 * no session at all — a node answered and stated a policy — so it gets the
 * sentence for that instead: sign in, because this cluster will not carry an
 * anonymous viewer. The server's own words are deliberately not repeated;
 * core's contract is that they are never assumed fit for a viewer.
 */
export function lockoutReason(
  roles: readonly UserRole[] | undefined,
  mintRefused: boolean,
): LockoutReason | undefined {
  if (sessionLockedOut(roles ? [...roles] : roles)) return 'no-roles';
  return mintRefused ? 'refused' : undefined;
}

export function lockoutNotice(reason: LockoutReason | undefined): string | undefined {
  if (reason === 'no-roles') {
    return 'This session has no permissions on this server, so there is nothing it can open. Log in again to see the library — and if you are already signed in as yourself, ask an administrator for the media_viewer role.';
  }
  if (reason === 'refused') {
    return 'This server does not allow browsing without an account. Sign in to continue.';
  }
  return undefined;
}
