import { useCallback, useState } from 'react';
import {
  errorMessage,
  hasRole,
  USER_ROLES,
  type CurrentSession,
  type MachaUser,
  type PasswordPolicy,
  type UserRole,
  type UsersApi,
} from '@machafoundation/core';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { AsyncIconButton } from '../components/AsyncIconButton';
import { RefreshIcon } from '../components/ManageIcons';
import { ConfirmModal } from '../components/Modal';

interface Props {
  api: UsersApi;
  /** The signed-in session, so this screen can refuse to let someone strand themselves. */
  session?: CurrentSession;
}

const ROLE_LABELS: Record<UserRole, string> = {
  media_viewer: 'View media',
  importer: 'Import',
  manager: 'Manage library',
  manage_users: 'Manage users',
  view_status: 'View cluster status',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  media_viewer: 'Browse and play everything in the catalogue.',
  importer: 'Add content through torrents and ingest.',
  manager: 'Files, namespaces and catalogue matches.',
  manage_users: 'Add, edit and remove accounts.',
  // Deliberately says what it does *not* cover. `view_status` gates the
  // diagnostic view only — the node roster, per-node capacity, which node is
  // being asked for what. Health, ranking, failover and the connection gate
  // all run off `/api/v1/health`, which needs no session and no role, so
  // withholding this costs a viewer the Status screen and nothing else.
  view_status: 'Node health and capacity. Does not affect playback.',
};

/**
 * Which form field a server error belongs against.
 *
 * The whole value of an error code is knowing which input was wrong, and a
 * message at the top of the form throws that away. Anything unrecognised
 * falls through to the form-level slot rather than being hidden — an
 * unfamiliar code from a newer server must still be readable.
 */
function fieldForCode(code: string | undefined): 'username' | 'password' | 'roles' | 'form' {
  switch (code) {
    case 'username_taken':
    case 'reserved_username':
      return 'username';
    case 'password_rejected':
    case 'password_required':
      return 'password';
    case 'last_user_manager':
      return 'roles';
    default:
      return 'form';
  }
}

interface FieldError {
  field: 'username' | 'password' | 'roles' | 'form';
  message: string;
}

function fieldError(cause: unknown): FieldError {
  const code = (cause as { code?: string } | undefined)?.code;
  return { field: fieldForCode(code), message: errorMessage(cause) };
}

function passwordComplaint(password: string, policy: PasswordPolicy | undefined): string | undefined {
  // The server owns the rule; this only saves a round trip for the obvious
  // case. An absent minimum means the server states no rule, so nothing is
  // checked here rather than a length being invented locally.
  const minimum = policy?.min_password_length;
  if (minimum === undefined || password.length >= minimum) return undefined;
  return `Passwords must be at least ${minimum} characters.`;
}

function RoleChoice({ roles, disabled, onChange }: {
  roles: readonly UserRole[];
  disabled: boolean;
  onChange: (roles: UserRole[]) => void;
}) {
  return (
    <ul className="user-roles">
      {USER_ROLES.map((role) => (
        <li key={role}>
          <label>
            <input
              type="checkbox"
              data-tv-focusable="true"
              checked={roles.includes(role)}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked
                // Rebuilt in the canonical order rather than appended, so two
                // users with the same roles always read the same way.
                ? USER_ROLES.filter((candidate) => candidate === role || roles.includes(candidate))
                : roles.filter((candidate) => candidate !== role))}
            />
            <span className="user-role-label">{ROLE_LABELS[role]}</span>
          </label>
          <span className="user-role-description">{ROLE_DESCRIPTIONS[role]}</span>
        </li>
      ))}
    </ul>
  );
}

function NewUser({ api, policy, onCreated }: {
  api: UsersApi;
  policy: PasswordPolicy | undefined;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(['media_viewer']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>();

  const reset = () => {
    setUsername('');
    setPassword('');
    setRoles(['media_viewer']);
    setError(undefined);
  };

  const submit = async () => {
    const complaint = passwordComplaint(password, policy);
    if (complaint) { setError({ field: 'password', message: complaint }); return; }
    setBusy(true);
    setError(undefined);
    try {
      await api.create({ username: username.trim(), password, roles });
      reset();
      setOpen(false);
      onCreated();
    } catch (cause) {
      setError(fieldError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="primary-button" type="button" data-tv-focusable="true" onClick={() => setOpen(true)}>
        Add a user
      </button>
    );
  }

  return (
    <form className="user-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h3>New user</h3>
      <label htmlFor="new-username">Username</label>
      <input
        id="new-username"
        data-tv-focusable="true"
        value={username}
        disabled={busy}
        autoComplete="off"
        onChange={(event) => setUsername(event.target.value)}
      />
      {error?.field === 'username' && <p className="manage-error" role="alert">{error.message}</p>}

      <label htmlFor="new-password">Password</label>
      <input
        id="new-password"
        type="password"
        data-tv-focusable="true"
        value={password}
        disabled={busy}
        autoComplete="new-password"
        onChange={(event) => setPassword(event.target.value)}
      />
      {error?.field === 'password' && <p className="manage-error" role="alert">{error.message}</p>}
      {policy?.min_password_length !== undefined && error?.field !== 'password' && (
        <p className="user-form-hint">At least {policy.min_password_length} characters.</p>
      )}

      <fieldset>
        <legend>Roles</legend>
        <RoleChoice roles={roles} disabled={busy} onChange={setRoles} />
      </fieldset>
      {error?.field === 'roles' && <p className="manage-error" role="alert">{error.message}</p>}
      {error?.field === 'form' && <p className="manage-error" role="alert">{error.message}</p>}

      <div className="user-form-actions">
        <button className="primary-button" type="submit" data-tv-focusable="true" disabled={busy || !username.trim() || !password}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
        <button type="button" data-tv-focusable="true" disabled={busy} onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * One account.
 *
 * Every control is enabled from the server's own `mutable` block rather than
 * from anything this screen knows about the user. Root and anonymous are
 * ordinary records that happen to be protected, and a client-side name check
 * would be wrong the moment those names change — and wrong everywhere at
 * once, because all four clients would carry the same guess.
 */
function UserRow({ api, user, policy, isSelf, onChanged }: {
  api: UsersApi;
  user: MachaUser;
  policy: PasswordPolicy | undefined;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [roles, setRoles] = useState<UserRole[]>(user.roles);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>();
  const [notice, setNotice] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const renamed = username.trim() !== user.username;
  const rolesChanged = roles.length !== user.roles.length || roles.some((role) => !user.roles.includes(role));
  const dirty = (user.mutable.rename && renamed) || (user.mutable.set_roles && rolesChanged);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      if (success) setNotice(success);
      onChanged();
    } catch (cause) {
      setError(fieldError(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () => void run(() => api.update(user.id, {
    ...(user.mutable.rename && renamed ? { username: username.trim() } : {}),
    ...(user.mutable.set_roles && rolesChanged ? { roles } : {}),
  }), 'Saved.');

  const setNewPassword = () => {
    const complaint = passwordComplaint(password, policy);
    if (complaint) { setError({ field: 'password', message: complaint }); return; }
    void run(() => api.update(user.id, { password }), 'Password changed.').then(() => setPassword(''));
  };

  return (
    <li className="user-card">
      <div className="user-card-heading">
        <div className="user-identity">
          <label className="user-identity-label" htmlFor={`username-${user.id}`}>Username</label>
          <input
            id={`username-${user.id}`}
            data-tv-focusable="true"
            value={username}
            disabled={busy || !user.mutable.rename}
            autoComplete="off"
            onChange={(event) => setUsername(event.target.value)}
          />
          {!user.mutable.rename && <span className="user-locked">This account cannot be renamed.</span>}
          {isSelf && <span className="user-self">This is you.</span>}
        </div>
        {user.mutable.delete
          ? <button type="button" className="destructive-button" data-tv-focusable="true" disabled={busy} onClick={() => setDeleteOpen(true)}>
              Remove
            </button>
          : <span className="user-locked">Cannot be removed.</span>}
      </div>
      {error?.field === 'username' && <p className="manage-error" role="alert">{error.message}</p>}

      <fieldset>
        <legend>Roles</legend>
        <RoleChoice roles={roles} disabled={busy || !user.mutable.set_roles} onChange={setRoles} />
        {!user.mutable.set_roles && (
          <p className="user-locked">
            {user.mutable.set_roles_blocked_by === 'last_user_manager'
              ? 'This is the only account that can manage users, so its roles are fixed until another one can.'
              : 'This account’s roles are fixed.'}
          </p>
        )}
      </fieldset>
      {error?.field === 'roles' && <p className="manage-error" role="alert">{error.message}</p>}

      {user.mutable.set_password && (
        <div className="user-password">
          <label htmlFor={`password-${user.id}`}>Set a new password</label>
          <div className="user-password-row">
            <input
              id={`password-${user.id}`}
              type="password"
              data-tv-focusable="true"
              value={password}
              disabled={busy}
              autoComplete="new-password"
              placeholder="Leave blank to keep the current one"
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="button" data-tv-focusable="true" disabled={busy || !password} onClick={setNewPassword}>
              Change password
            </button>
          </div>
          {error?.field === 'password' && <p className="manage-error" role="alert">{error.message}</p>}
        </div>
      )}

      {error?.field === 'form' && <p className="manage-error" role="alert">{error.message}</p>}
      {notice && <p className="user-notice" role="status">{notice}</p>}

      <div className="user-card-actions">
        <button className="primary-button" type="button" data-tv-focusable="true" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && (
          <button type="button" data-tv-focusable="true" disabled={busy} onClick={() => { setUsername(user.username); setRoles(user.roles); setError(undefined); }}>
            Discard
          </button>
        )}
      </div>

      <ConfirmModal
        open={deleteOpen}
        title={`Remove ${user.username}?`}
        confirmLabel="Remove user"
        destructive
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void run(() => api.remove(user.id)).then(() => setDeleteOpen(false))}
      >
        <p>
          <strong>{user.username}</strong> will be removed and any session they hold will stop working.
          This cannot be undone.
        </p>
      </ConfirmModal>
    </li>
  );
}

export function UsersScreen({ api, session }: Props) {
  const result = useRefreshableAsync((signal) => api.list(signal), [api]);
  const refresh = result.refresh;
  const onChanged = useCallback(() => refresh(), [refresh]);

  // `Manage` is the page heading, so each section heads itself the way Files
  // and Unmatched do. A second `h1` here meant the biggest words on screen
  // were the section's own, competing with the page title rather than sitting
  // under it.
  const heading = (
    <div className="manage-panel-heading">
      <div>
        <h2>Users</h2>
        <p>
          Roles are independent of one another: an account has exactly the ones ticked, and none implies another.
          Changing a password or a role signs that account out everywhere, so a change takes effect at once.
        </p>
      </div>
      <AsyncIconButton label="Refresh users" busy={result.refreshing} onClick={refresh} icon={<RefreshIcon />} />
    </div>
  );

  if (!result.value) {
    return (
      <section className="manage-panel">
        {heading}
        {result.loading
          ? <Loading />
          : result.error
            ? <ErrorMessage error={result.error} />
            // Neither loading, failed, nor holding a list. That combination
            // used to render the heading and nothing at all, which reads as a
            // broken page rather than as a server that answered oddly.
            : <p className="manage-error" role="alert">The server did not return a user list.</p>}
      </section>
    );
  }

  const users = [...result.value].sort((left, right) => left.username.localeCompare(right.username));

  return (
    <section className="manage-panel">
      {heading}
      {result.error && <p className="manage-error" role="alert">Refresh failed: {result.error.message}</p>}
      {users.length === 0 && <p className="manage-empty">No accounts exist yet.</p>}

      <NewUser api={api} policy={session?.password_policy} onCreated={onChanged} />

      <ul className="user-list">
        {users.map((user) => (
          <UserRow
            key={user.id}
            api={api}
            user={user}
            policy={session?.password_policy}
            isSelf={user.id === session?.user_id}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}

/** Whether the signed-in session may see this screen at all. */
export function usersScreenAvailable(session: CurrentSession | undefined): boolean {
  return hasRole(session?.roles, 'manage_users');
}
