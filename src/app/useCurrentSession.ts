import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurrentSession, UsersApi } from '@machafoundation/core';

export interface CurrentSessionState {
  /**
   * Who the viewer is, or `undefined` when that is genuinely not known —
   * still loading, or a node too old to answer.
   *
   * The difference matters at every call site, which is why `known` exists
   * separately rather than callers testing this for truthiness.
   */
  session?: CurrentSession;
  /**
   * Whether the cluster answered.
   *
   * When it did, the roles it returned are **authoritative and literal**: a
   * capability the server did not name is one this session does not have.
   * There is nothing to interpret and no account to special-case — every
   * session belongs to a user, empty credentials simply authenticate the
   * `anonymous` one, and its session is read exactly like any other. A role
   * name this build does not recognise grants nothing, for the same reason
   * an absent one does: the server named what it granted.
   *
   * False means the question went unanswered, which is different from a
   * session with no privileges and is the only case where sections that
   * predate roles stay visible. A node too old to serve this at all enforces
   * no roles either, so falling back to showing them costs nothing.
   */
  known: boolean;
  /**
   * Re-read the session, resolving once the answer has landed.
   *
   * Awaitable because a caller usually has a decision waiting on it. Signing
   * in is the case that forced it: the new token is live immediately, but the
   * *roles* are not known until this settles, and anything that navigates in
   * between is still being judged against the old session — which, on a
   * cluster where the anonymous account holds nothing, means being bounced
   * back to the login screen you just used.
   */
  refresh: () => Promise<void>;
}

/**
 * The signed-in user and their roles, re-read whenever the session changes.
 *
 * Roles are resolved by the server when a session is minted, so this is the
 * only place they can come from. Re-reading on `auth` identity is deliberate:
 * a password or role change invalidates the old session, the next request
 * re-mints, and the roles that come back may be different from the ones this
 * screen was drawn with.
 */
export function useCurrentSession(api: UsersApi, enabled: boolean): CurrentSessionState {
  const [state, setState] = useState<{ session?: CurrentSession; known: boolean }>({ known: false });
  const [attempt, setAttempt] = useState(0);
  /** Callers awaiting the current `refresh()`. Settled on any outcome. */
  const waiting = useRef<(() => void)[]>([]);
  const settleWaiting = useCallback(() => {
    const waiters = waiting.current;
    waiting.current = [];
    for (const resolve of waiters) resolve();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Settled, not abandoned: a caller awaiting a refresh that is then
      // disabled must not wait for ever.
      settleWaiting();
      // Only when there is something to clear. Returning a fresh object every
      // run makes this effect its own trigger for any caller whose `api`
      // identity is not stable, and the render loop that follows presents as
      // the process running out of memory rather than as anything to do with
      // sessions.
      setState((current) => (current.known || current.session ? { known: false } : current));
      return undefined;
    }
    const controller = new AbortController();
    api.currentSession(controller.signal).then(
      async (session) => {
        if (controller.signal.aborted) return;
        setState({ session, known: true });
        // Before the username fallback below, which is cosmetic: a caller
        // waiting on this wants the roles, and those have arrived.
        settleWaiting();
        // Identity is not guaranteed on the session. A deployed 0.37.x node
        // answers this route with roles, an expiry and a policy and names no
        // user at all, so reading the signed-in name from the session alone
        // leaves every account anonymous-looking forever. The account record
        // is the authority on who this is; a refusal simply means the server
        // will not say, which is the same as not knowing.
        if (session.username) return;
        try {
          const account = await api.me(controller.signal);
          if (!controller.signal.aborted && account.username) {
            setState({ session: { ...session, username: account.username, user_id: account.id }, known: true });
          }
        } catch {
          // Left unnamed rather than guessed at.
        }
      },
      () => {
        // Nothing is retried here, and nothing needs to be. This request no
        // longer carries the permissions — those ride the token itself, on
        // `sessionManager.roles`, published by whichever path produced it. A
        // failure here costs a display name and the password policy until the
        // next deliberate refresh, not the viewer's permissions, so the backoff
        // that used to live here was guarding something that had moved.
        if (controller.signal.aborted) return;
        setState({ known: false });
        settleWaiting();
      },
    );
    return () => controller.abort();
  }, [api, enabled, attempt, settleWaiting]);

  const refresh = useCallback(() => new Promise<void>((resolve) => {
    waiting.current.push(resolve);
    setAttempt((value) => value + 1);
  }), []);
  return { ...state, refresh };
}

// `sessionLockedOut` used to live here. It is core's now — `sessionLockedOut`
// and `sessionPermits` in `@machafoundation/core` — taking `roles | undefined`
// rather than a value plus a `known` flag, so "unknown is not none" holds by
// construction instead of depending on every call site remembering to pass the
// flag. Same semantics, one fewer way to get it wrong, and one answer shared by
// all four clients rather than four that can drift.
