import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { routes, SessionNotStartedError } from '@machafoundation/core';
import { machaLogoUrl as logoUrl } from '../uiAssets';
import { viewerErrorText } from '../text/viewerText';

interface Props {
  /** Exchanges credentials for a session. Rejects on a refusal, which is the whole point. */
  onSignIn: (username: string, password: string) => Promise<void>;
  /**
   * Re-read who the session belongs to once it changes.
   *
   * Awaited, so it must resolve only when the new session's roles are actually
   * known — see the note in `submit`.
   */
  onSignedIn: () => void | Promise<void>;
  /**
   * Why this wall is standing here, when it is standing rather than sitting
   * beside the application.
   *
   * A viewer whose account holds no roles cannot be helped by this form —
   * their credentials were accepted and bought them nothing — so the screen
   * has to say that rather than invite them to try the same thing again.
   */
  notice?: string;
  /**
   * Whether there is anything to browse without signing in.
   *
   * False where the server grants the anonymous account no roles, which makes
   * this screen a wall rather than a doorway. Offering "Browse as guest"
   * there would be a button that navigates home and is bounced straight back,
   * so the choice is removed rather than left to fail.
   */
  guestAllowed?: boolean;
  /**
   * Whether to offer a way through to Settings → Connection.
   *
   * Only meaningful when this screen is standing in front of the whole
   * application, and then it is not optional politeness: with no guest button
   * and no top bar, a viewer whose cluster has stopped granting roles has no
   * control of any kind. On a desk they could type the URL. On a television
   * there is no URL to type, so without this the only way out is a reinstall
   * — which is the shape of lockout 0.13.0 already shipped once.
   */
  connectionReachable?: boolean;
}

/**
 * What to tell someone whose sign-in was refused.
 *
 * The refusal itself is shown in this client's words, not the transport's.
 * `Could not start a session: 401` is what core hands up, and it describes the
 * mechanism rather than the situation — a viewer who mistyped a password
 * cannot act on it, and it reads like a fault in the software rather than a
 * wrong password.
 *
 * One message covers both a wrong password and an unknown username, and that
 * is deliberate rather than lazy. The server answers those two identically and
 * in the same time, so that nobody can discover which accounts exist by
 * watching the replies; wording them differently here would hand back exactly
 * the distinction the server takes care to withhold.
 *
 * Anything that is *not* a refusal keeps its original wording. An unreachable
 * node, a 500, a timeout — none of those are a wrong password, and saying so
 * would send someone hunting for a typo that is not there.
 *
 * `SessionNotStartedError` is checked first and separately, because it is the
 * one failure where **no node was asked at all**. It arrives as a
 * `MachaConnectionError` so that a client which classifies broadly still
 * treats it as a failure rather than a success, but calling it unreachable
 * would blame a cluster that was never contacted and send somebody to check a
 * server that is up. It is this application not having started its session
 * manager — our fault, not theirs, and the only honest thing to say is that
 * the client was not ready.
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
 * Sign in as somebody.
 *
 * Usually there is nothing to "enter" here in the sense of gaining access — a
 * viewer already has a session, because every session belongs to a user and
 * empty credentials authenticate the anonymous one. This exchanges that
 * session for one belonging to a named account, which is why it is normally
 * reachable from the top bar rather than blocking the application behind it:
 * a cluster whose anonymous user can watch media is a perfectly normal
 * configuration, and a login wall would be a lie about what is required.
 *
 * `guestAllowed={false}` is the deployment where it is not a lie. Strip
 * `media_viewer` from the anonymous account and an unauthenticated viewer
 * genuinely may do nothing, so the same screen stands in front of the
 * application instead of beside it. The only difference is this one: what the
 * server permits decides which it is, not a separate screen or a build flag.
 */
export function LoginScreen({ onSignIn, onSignedIn, guestAllowed = true, connectionReachable = false, notice }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  /**
   * Back where they came from, or Home.
   *
   * Whoever sent the viewer here records it in the route state — the top bar's
   * own control, and the redirect that raises the login wall in front of a
   * session holding no roles. Returning someone to the page they were trying
   * to reach is the point of asking them to sign in; dropping them on Home
   * instead makes them find it again, which on a remote is several minutes of
   * D-pad.
   *
   * `routes.login` is refused as a destination: signing in and landing back on
   * the sign-in form reads as a failure even though it worked.
   */
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
      // Awaited, not fired and forgotten. The token is live at once but the
      // roles are not known until the session has been re-read, and navigating
      // in between is judged against the session we just replaced — which, on
      // a cluster whose anonymous account holds nothing, means being bounced
      // straight back to this screen with no sign anything happened.
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
    // Not `.connection-gate`, which is a full-viewport layout for the gate
    // that stands in place of the whole application. This one lives inside
    // it, below a header, so it centres in the space it was actually given.
    <div className="login-screen">
      <section className="connection-gate-panel">
        <div className="connection-gate-brand">
          <img className="connection-gate-logo" src={logoUrl} alt="" />
          <div>
            <p className="eyebrow">Macha media client</p>
            <h1>Log in</h1>
          </div>
        </div>
        {/* The notice replaces the standing invitation rather than joining
            it: a viewer whose account holds no roles is not here to be told
            what signing in would buy them, because they have signed in and
            it bought them nothing. */}
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

          {/* Two equal halves rather than a primary with a quiet link beside
              it. Browsing without an account is a supported way to use this
              client, not a way of giving up on the form, so it gets a control
              of the same weight — subordinate in colour, equal in stature. */}
          {/* Swapped in the markup rather than with CSS `order`, so the
              reading order, the tab order and what is on screen stay the same
              thing. `Log in` is still the form's only submit button, so Enter
              in either field still signs in. */}
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

        {/* Deliberately below the form and quiet: it is an escape hatch, not a
            second way in. A viewer who cannot sign in here — wrong cluster,
            a node that has stopped granting roles — otherwise has no control
            at all on a television, where there is no address bar to fall back
            on. It reaches no media; it only changes which cluster is asked. */}
        {connectionReachable && (
          <p className="login-connection-escape">
            <Link to={routes.connection} data-tv-focusable="true">Change which server this client uses</Link>
          </p>
        )}
      </section>
    </div>
  );
}
