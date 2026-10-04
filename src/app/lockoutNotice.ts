import { sessionLockedOut, type UserRole } from '@machafoundation/core';

/** Why the sign-in wall stands in front of this viewer. */
export type LockoutReason = 'no-roles' | 'refused';

/**
 * `undefined` roles are unknown (a node too old to state them) and stay permissive; only `[]` is
 * granted nothing. `sessionLockedOut` is core's, so every client draws that line in the same place.
 * A refused mint is no session at all, not a role problem.
 */
export function lockoutReason(
  roles: readonly UserRole[] | undefined,
  mintRefused: boolean,
): LockoutReason | undefined {
  if (sessionLockedOut(roles ? [...roles] : roles)) return 'no-roles';
  return mintRefused ? 'refused' : undefined;
}

/**
 * A role-less session gets no notice: the login screen already says an account is required, and
 * an ordinary sign-out produces the same state on a cluster whose anonymous account holds nothing.
 */
export function lockoutNotice(reason: LockoutReason | undefined): string | undefined {
  if (reason === 'refused') {
    return 'This server does not allow browsing without an account. Sign in to continue.';
  }
  return undefined;
}
