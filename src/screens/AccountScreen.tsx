import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  routes,
  USER_ROLES,
  type CurrentSession,
  type PasswordPolicy,
  type UserRole,
  type UsersApi,
} from '@machafoundation/core';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { presentedTime } from '../diagnostics/timestamps';
import { viewerErrorText } from '../text/viewerText';

const ROLE_LABELS: Record<UserRole, string> = {
  media_viewer: 'View media',
  importer: 'Import',
  manager: 'Manage library',
  manage_users: 'Manage users',
  view_status: 'View cluster status',
};

function when(unixMs: number | undefined): string {
  if (!unixMs) return 'Unknown';
  return presentedTime(unixMs);
}

/** The signed-in user as the server describes them. Roles this build does not know are listed as they came, not dropped. */
export function AccountScreen({ api, session }: { api: UsersApi; session?: CurrentSession }) {
  const navigate = useNavigate();
  const details = useAsync((signal) => api.me(signal), [api]);
  const roles = session?.roles ?? details.value?.roles ?? [];
  const known = roles.filter((role): role is UserRole => (USER_ROLES as readonly string[]).includes(role));
  const unknown = roles.filter((role) => !(USER_ROLES as readonly string[]).includes(role));

  return (
    <section className="manage-panel account-screen">
      <h1>User details</h1>
      {details.loading && !details.value ? <Loading /> : null}
      {details.error && !details.value ? <ErrorMessage error={details.error} /> : null}

      <dl className="account-details">
        <dt>Username</dt>
        <dd>{details.value?.username ?? session?.username ?? 'Unknown'}</dd>
        <dt>Account created</dt>
        <dd>{when(details.value?.created_unix_ms)}</dd>
        <dt>Session expires</dt>
        <dd>{when(session?.expires_unix_ms)}</dd>
      </dl>

      <h2>What this account can do</h2>
      {roles.length === 0
        ? <p>This account has no permissions.</p>
        : (
          <ul className="account-roles">
            {known.map((role) => <li key={role}>{ROLE_LABELS[role]}</li>)}
            {unknown.map((role) => <li key={role} className="account-role-unknown">{role}</li>)}
          </ul>
        )}

      <div className="account-actions">
        {/* Decided by the server's `mutable` block, never the username. Absent
            `mutable` is an older node, not a refusal: the button stays. */}
        {details.value?.mutable?.set_password === false
          ? <p className="account-no-password">This account has no password, and one cannot be set for it.</p>
          : (
            <button className="primary-button" type="button" data-tv-focusable="true" onClick={() => navigate(routes.accountPassword)}>
              Change password
            </button>
          )}
      </div>
    </section>
  );
}

/**
 * Change your own password. The server returns a fresh token, since the change
 * invalidates the session that made it; the session manager adopts it, so this
 * only reports success and asks the app to re-read.
 */
export function ChangePasswordScreen({ api, policy, onChanged }: {
  api: UsersApi;
  policy?: PasswordPolicy;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const minimum = policy?.min_password_length;
  const tooShort = minimum !== undefined && password.length > 0 && password.length < minimum;
  const mismatched = confirmation.length > 0 && confirmation !== password;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.changeOwnPassword(password);
      setPassword('');
      setConfirmation('');
      setDone(true);
      onChanged();
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="manage-panel account-screen">
      <h1>Change password</h1>
      <p>Changing your password ends every other session for this account. You will stay signed in here.</p>

      <form className="user-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="account-password">New password</label>
        <input
          id="account-password"
          type="password"
          data-tv-focusable="true"
          value={password}
          disabled={busy}
          autoComplete="new-password"
          onChange={(event) => { setPassword(event.target.value); setDone(false); }}
        />
        {tooShort && <p className="manage-error" role="alert">Passwords must be at least {minimum} characters.</p>}
        {!tooShort && minimum !== undefined && <p className="user-form-hint">At least {minimum} characters.</p>}

        <label htmlFor="account-password-confirm">Repeat new password</label>
        <input
          id="account-password-confirm"
          type="password"
          data-tv-focusable="true"
          value={confirmation}
          disabled={busy}
          autoComplete="new-password"
          onChange={(event) => { setConfirmation(event.target.value); setDone(false); }}
        />
        {mismatched && <p className="manage-error" role="alert">These do not match.</p>}

        {error && <p className="manage-error" role="alert">{error}</p>}
        {done && <p className="user-notice" role="status">Password changed.</p>}

        <div className="user-form-actions">
          <button
            className="primary-button"
            type="submit"
            data-tv-focusable="true"
            disabled={busy || !password || tooShort || mismatched || confirmation !== password}
          >
            {busy ? 'Changing…' : 'Change password'}
          </button>
          <button type="button" data-tv-focusable="true" disabled={busy} onClick={() => navigate(routes.account)}>
            Back to user details
          </button>
        </div>
      </form>
    </section>
  );
}
