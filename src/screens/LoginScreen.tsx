import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, routes } from '@machafoundation/core';
import { machaLogoUrl as logoUrl } from '../uiAssets';

interface Props {
  /** Exchanges credentials for a session. Rejects on a refusal, which is the whole point. */
  onSignIn: (username: string, password: string) => Promise<void>;
  /** Re-read who the session belongs to once it changes. */
  onSignedIn: () => void;
}

/**
 * Sign in as somebody.
 *
 * There is nothing to "enter" here in the sense of gaining access — a viewer
 * already has a session, because every session belongs to a user and empty
 * credentials authenticate the anonymous one. This exchanges that session for
 * one belonging to a named account, which is why it is reachable from the
 * top bar rather than blocking the application behind it: a cluster whose
 * anonymous user can watch media is a perfectly normal configuration, and a
 * login wall would be a lie about what is required.
 */
export function LoginScreen({ onSignIn, onSignedIn }: Props) {
  const navigate = useNavigate();
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
      onSignedIn();
      navigate(routes.home, { replace: true });
    } catch (cause) {
      // Deliberately shown as the server worded it. The server answers an
      // unknown user and a wrong password identically and in the same time,
      // and rewording it here would risk reintroducing the difference.
      setError(errorMessage(cause));
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
        <img className="connection-gate-logo" src={logoUrl} alt="" />
        <p className="eyebrow">Macha media client</p>
        <h1>Log in</h1>
        <p>Sign in to reach everything your account allows, or browse as a guest.</p>

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
            <button className="secondary-button" type="button" data-tv-focusable="true" disabled={busy} onClick={() => navigate(routes.home)}>
              Browse as guest
            </button>
            <button className="primary-button" type="submit" data-tv-focusable="true" disabled={busy || !username.trim() || !password}>
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
