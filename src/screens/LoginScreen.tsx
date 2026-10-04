import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { routes, SessionNotStartedError } from '@machafoundation/core';
import { machaLogoUrl as logoUrl } from '../uiAssets';
import { viewerErrorText } from '../text/viewerText';

interface Props {
  /** Exchanges credentials for a session; rejects on a refusal. */
  onSignIn: (username: string, password: string) => Promise<void>;
  /** Re-reads who the session belongs to. Awaited, so it must resolve only once the new roles are known. */
  onSignedIn: () => void | Promise<void>;
  /** Replaces the invitation, as for an account whose credentials were accepted but which holds no roles. */
  notice?: string;
  /** False where the anonymous account holds no roles: "Browse as guest" would bounce straight back here. */
  guestAllowed?: boolean;
  /**
   * Offers a link to Settings → Connection. Needed when this screen fronts the
   * whole application: a television has no address bar, so it is the only way out.
   */
  connectionReachable?: boolean;
}

/**
 * A refused sign-in in the viewer's terms. One message covers a wrong password
 * and an unknown username: the server answers both identically so accounts
 * cannot be enumerated. Other failures keep their own wording.
 * `SessionNotStartedError` is checked first: no node was asked, so it must not
 * be reported as an unreachable cluster.
 */
function signInComplaint(cause: unknown): string {
  if (cause instanceof SessionNotStartedError) {
    return 'The client was not ready to sign in. Please try again in a moment.';
  }
  const status = (cause as { status?: unknown } | undefined)?.status;
  return status === 401 || status === 403
    ? 'That username and password were not recognised. Please try again.'
    : viewerErrorText(cause);
}

/**
 * Exchanges the session, usually the anonymous one, for a named account's.
 * With `guestAllowed={false}` the anonymous account holds no roles and this
 * screen stands in front of the application rather than beside it.
 */
export function LoginScreen({ onSignIn, onSignedIn, guestAllowed = true, connectionReachable = false, notice }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  // Back to the page recorded in route state, or Home; never `routes.login`,
  // which would read as a failed sign-in.
  const from = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof from === 'string' && from !== routes.login ? from : routes.home;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSignIn(username.trim(), password);
      setPassword('');
      // Awaited: roles are unknown until the session is re-read, and navigating
      // before then is judged against the session just replaced.
      await onSignedIn();
      navigate(returnTo, { replace: true });
    } catch (cause) {
      setError(signInComplaint(cause));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    // Not `.connection-gate`, a full-viewport layout: this sits below a header.
    <div className="login-screen">
      <section className="connection-gate-panel">
        <div className="connection-gate-brand">
          <img className="connection-gate-logo" src={logoUrl} alt="" />
          <div>
            <p className="eyebrow">Macha media client</p>
            <h1>Log in</h1>
          </div>
        </div>
        <p className={notice ? 'login-lockout-notice' : undefined} role={notice ? 'alert' : undefined}>{notice ?? (guestAllowed
          ? 'Sign in to reach everything your account allows, or browse as a guest.'
          : 'This server requires an account. Sign in to continue.')}</p>

        <form className="connection-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            data-tv-focusable="true"
            data-tv-default-focus="true"
            value={username}
            disabled={busy}
            autoComplete="username"
            spellCheck={false}
            onChange={(event) => setUsername(event.target.value)}
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            data-tv-focusable="true"
            value={password}
            disabled={busy}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && <p className="settings-status-error" role="alert">{error}</p>}

          {/* Guest browsing is a supported use, so its button has equal weight.
              Ordered in the markup, not with CSS `order`, so reading and tab
              order match the screen. */}
          <div className="login-actions">
            {guestAllowed && (
              <button className="secondary-button" type="button" data-tv-focusable="true" disabled={busy} onClick={() => navigate(routes.home)}>
                Browse as guest
              </button>
            )}
            <button className="primary-button" type="submit" data-tv-focusable="true" disabled={busy || !username.trim() || !password}>
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </div>
        </form>

        {connectionReachable && (
          <p className="login-connection-escape">
            <Link to={routes.connection} data-tv-focusable="true">Change which server this client uses</Link>
          </p>
        )}
      </section>
    </div>
  );
}
