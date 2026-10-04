import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurrentSession, UsersApi } from '@machafoundation/core';

export interface CurrentSessionState {
  /** The viewer, or `undefined` when unknown: still loading, or a node too old to answer. */
  session?: CurrentSession;
  /**
   * Whether the cluster answered. If so its roles are literal: a role it did not name, or one this
   * build does not recognise, is not held. False means unanswered, not unprivileged.
   */
  known: boolean;
  /**
   * Re-reads the session, resolving once the answer lands. Await it before navigating after
   * sign-in: the new roles are not known until then.
   */
  refresh: () => Promise<void>;
}

/** The signed-in user and their roles, re-read when `auth` changes: a re-minted session may carry different roles. */
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
      // A caller awaiting a refresh must not wait for ever.
      settleWaiting();
      // Only when there is something to clear: a fresh object every run would loop for a caller with an unstable `api`.
      setState((current) => (current.known || current.session ? { known: false } : current));
      return undefined;
    }
    const controller = new AbortController();
    api.currentSession(controller.signal).then(
      async (session) => {
        if (controller.signal.aborted) return;
        setState({ session, known: true });
        // Settle before the cosmetic username fallback: waiters want the roles.
        settleWaiting();
        // An older node's session names no user; the account record supplies the name.
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
        // No retry: permissions ride the token, so a failure costs only the display name and password policy.
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
