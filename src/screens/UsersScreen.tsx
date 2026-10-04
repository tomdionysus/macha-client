import { Fragment, useCallback, useState } from 'react';
import {
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
import { ConfirmModal, FormModal } from '../components/Modal';
import { OverflowMenu } from '../components/OverflowMenu';
import { viewerErrorText } from '../text/viewerText';

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
  // `view_status` gates only the Status screen; health, failover and the connection gate need no role.
  view_status: 'Node health and capacity. Does not affect playback.',
};

/** An account's roles in one line, in canonical order, with the editor's labels; "No roles" when it has none. */
export function roleSummary(roles: readonly UserRole[]): string {
  const named = USER_ROLES.filter((role) => roles.includes(role)).map((role) => ROLE_LABELS[role]);
  // A role this build does not recognise still counts, so the summary never under-reports.
  const unrecognised = roles.filter((role) => !USER_ROLES.includes(role)).length;
  if (unrecognised > 0) named.push(unrecognised === 1 ? '1 other role' : `${unrecognised} other roles`);
  return named.length > 0 ? named.join(' · ') : 'No roles';
}

/**
 * An account the server protects from renaming. Read from the server's flag, never the username.
 * `rename` rather than `delete`, which is also withheld from ordinary accounts (the last
 * `manage_users` holder, your own).
 */
export function isProtectedAccount(user: MachaUser): boolean {
  return user.mutable.rename === false;
}

/**
/**
 * Protected accounts first, then everyone else alphabetically. Of the protected, the one that can
 * hold a password (the superuser) precedes the credential-less one (anonymous).
 */
export function byStanding(left: MachaUser, right: MachaUser): number {
  const protection = Number(isProtectedAccount(right)) - Number(isProtectedAccount(left));
  if (protection !== 0) return protection;
  if (isProtectedAccount(left)) {
    // The account that can hold a password sorts first.
    const credentialless = Number(left.mutable.set_password === false) - Number(right.mutable.set_password === false);
    if (credentialless !== 0) return credentialless;
  }
  return left.username.localeCompare(right.username);
}

/** Which form field a server error belongs against, by code. An unknown code goes to the form-level slot. */
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
  return { field: fieldForCode(code), message: viewerErrorText(cause) };
}

function passwordComplaint(password: string, policy: PasswordPolicy | undefined): string | undefined {
  // Saves a round trip only; where the server states no minimum, nothing is checked.
  const minimum = policy?.min_password_length;
  if (minimum === undefined || password.length >= minimum) return undefined;
  return `Passwords must be at least ${minimum} characters.`;
}

/**
 * Runs one dialogue request with its busy state and error mapping. Returns success rather than
 * throwing, so a refused dialogue stays open beside its error.
 */
function useDialogueSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>();
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onDone();
      return true;
    } catch (cause) {
      setError(fieldError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, [onDone]);
  return { busy, error, setError, run };
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
                // Rebuilt in canonical order, so the same roles always read the same way.
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

function NewUserDialogue({ api, policy, open, onClose, onCreated }: {
  api: UsersApi;
  policy: PasswordPolicy | undefined;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(['media_viewer']);
  const { busy, error, setError, run } = useDialogueSubmit(onCreated);

  const close = () => {
    setUsername('');
    setPassword('');
    setRoles(['media_viewer']);
    setError(undefined);
    onClose();
  };

  const submit = () => {
    const complaint = passwordComplaint(password, policy);
    if (complaint) { setError({ field: 'password', message: complaint }); return; }
    void run(() => api.create({ username: username.trim(), password, roles })).then((created) => {
      if (created) close();
    });
  };

  return (
    <FormModal
      open={open}
      title="New user"
      submitLabel="Create user"
      busy={busy}
      submitDisabled={!username.trim() || !password}
      error={error?.field === 'form' ? error.message : undefined}
      onSubmit={submit}
      onCancel={close}
    >
      <label className="modal-field">
        <span>Username</span>
        <input
          data-tv-focusable="true"
          value={username}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      {error?.field === 'username' && <p className="manage-error" role="alert">{error.message}</p>}

      <label className="modal-field">
        <span>Password</span>
        <input
          type="password"
          data-tv-focusable="true"
          value={password}
          disabled={busy}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error?.field === 'password'
        ? <p className="manage-error" role="alert">{error.message}</p>
        : policy?.min_password_length !== undefined && <p className="user-form-hint">At least {policy.min_password_length} characters.</p>}

      <fieldset>
        <legend>Roles</legend>
        <RoleChoice roles={roles} disabled={busy} onChange={setRoles} />
      </fieldset>
      {error?.field === 'roles' && <p className="manage-error" role="alert">{error.message}</p>}
    </FormModal>
  );
}

/**
 * Renames an account and sets its roles, in one request. Setting a password has its own dialogue,
 * because it bumps `credential_generation` and signs the account out everywhere.
 */
function EditUserDialogue({ api, user, open, onClose, onChanged }: {
  api: UsersApi;
  user: MachaUser;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [roles, setRoles] = useState<UserRole[]>(user.roles);
  const { busy, error, setError, run } = useDialogueSubmit(onChanged);

  const renamed = username.trim() !== user.username;
  const rolesChanged = roles.length !== user.roles.length || roles.some((role) => !user.roles.includes(role));
  const dirty = (user.mutable.rename && renamed) || (user.mutable.set_roles && rolesChanged);

  const close = () => {
    setUsername(user.username);
    setRoles(user.roles);
    setError(undefined);
    onClose();
  };

  const submit = () => {
    void run(() => api.update(user.id, {
      ...(user.mutable.rename && renamed ? { username: username.trim() } : {}),
      ...(user.mutable.set_roles && rolesChanged ? { roles } : {}),
    })).then((saved) => {
      if (saved) onClose();
    });
  };

  return (
    <FormModal
      open={open}
      title={`Edit ${user.username}`}
      busy={busy}
      submitDisabled={!dirty}
      error={error?.field === 'form' ? error.message : undefined}
      onSubmit={submit}
      onCancel={close}
    >
      <label className="modal-field">
        <span>Username</span>
        <input
          data-tv-focusable="true"
          value={username}
          disabled={busy || !user.mutable.rename}
          autoComplete="off"
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      {!user.mutable.rename && <p className="user-locked">This account cannot be renamed.</p>}
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
    </FormModal>
  );
}

function PasswordDialogue({ api, user, policy, open, onClose, onChanged }: {
  api: UsersApi;
  user: MachaUser;
  policy: PasswordPolicy | undefined;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useDialogueSubmit(onChanged);

  const close = () => {
    setPassword('');
    setError(undefined);
    onClose();
  };

  const submit = () => {
    const complaint = passwordComplaint(password, policy);
    if (complaint) { setError({ field: 'password', message: complaint }); return; }
    void run(() => api.update(user.id, { password })).then((saved) => {
      if (saved) close();
    });
  };

  return (
    <FormModal
      open={open}
      title={`Set a password for ${user.username}`}
      submitLabel="Change password"
      busy={busy}
      submitDisabled={!password}
      error={error?.field !== 'password' ? error?.message : undefined}
      onSubmit={submit}
      onCancel={close}
    >
      <p className="user-form-hint">
        This signs {user.username} out everywhere, on every device.
      </p>
      <label className="modal-field">
        <span>New password</span>
        <input
          type="password"
          data-tv-focusable="true"
          value={password}
          disabled={busy}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error?.field === 'password'
        ? <p className="manage-error" role="alert">{error.message}</p>
        : policy?.min_password_length !== undefined && <p className="user-form-hint">At least {policy.min_password_length} characters.</p>}
    </FormModal>
  );
}

/**
 * One account as a row; every change opens a dialogue. The actions offered come from the server's
 * per-field `mutable` block, never from the username.
 */
function UserRow({ api, user, policy, isSelf, onChanged }: {
  api: UsersApi;
  user: MachaUser;
  policy: PasswordPolicy | undefined;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [dialogue, setDialogue] = useState<'edit' | 'password' | 'remove'>();
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string>();
  const close = useCallback(() => setDialogue(undefined), []);

  const editable = user.mutable.rename || user.mutable.set_roles;

  const remove = async () => {
    setRemoveBusy(true);
    setRemoveError(undefined);
    try {
      await api.remove(user.id);
      setDialogue(undefined);
      onChanged();
    } catch (cause) {
      setRemoveError(viewerErrorText(cause));
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <li className="record-row">
      {/* The row itself is the edit control, which saves a D-pad stop over a separate Edit button. */}
      <button
        type="button"
        className="record-main"
        data-tv-focusable="true"
        disabled={!editable}
        aria-label={`Edit ${user.username}`}
        onClick={() => setDialogue('edit')}
      >
        <span className="record-name">
          {user.username}
          {isSelf && <span className="record-tag">You</span>}
        </span>
        <span className="record-detail">{roleSummary(user.roles)}</span>
      </button>

      <OverflowMenu
        label={`Actions for ${user.username}`}
        actions={[
          ...(editable ? [{ label: 'Edit', onSelect: () => setDialogue('edit') }] : []),
          ...(user.mutable.set_password ? [{ label: 'Set a password', onSelect: () => setDialogue('password') }] : []),
          ...(user.mutable.delete ? [{ label: 'Remove', destructive: true, onSelect: () => setDialogue('remove') }] : []),
        ]}
      />

      <EditUserDialogue api={api} user={user} open={dialogue === 'edit'} onClose={close} onChanged={onChanged} />
      <PasswordDialogue api={api} user={user} policy={policy} open={dialogue === 'password'} onClose={close} onChanged={onChanged} />
      <ConfirmModal
        open={dialogue === 'remove'}
        title={`Remove ${user.username}?`}
        confirmLabel="Remove user"
        destructive
        busy={removeBusy}
        onCancel={() => { setDialogue(undefined); setRemoveError(undefined); }}
        onConfirm={() => void remove()}
      >
        <p>
          <strong>{user.username}</strong> will be removed and any session they hold will stop working.
          This cannot be undone.
        </p>
        {removeError && <p className="manage-error" role="alert">{removeError}</p>}
      </ConfirmModal>
    </li>
  );
}

export function UsersScreen({ api, session }: Props) {
  const result = useRefreshableAsync((signal) => api.list(signal), [api]);
  const refresh = result.refresh;
  const onChanged = useCallback(() => refresh(), [refresh]);
  const [adding, setAdding] = useState(false);

  // `Manage` is the page's `h1`, so each section heads itself with an `h2`.
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
            // Neither loading, failed, nor holding a list.
            : <p className="manage-error" role="alert">The server did not return a user list.</p>}
      </section>
    );
  }

  const users = [...result.value].sort(byStanding);
  // Where the protected accounts end; the divider is drawn there, and only if there are any.
  const ordinaryFrom = users.filter(isProtectedAccount).length;

  return (
    <section className="manage-panel">
      {heading}
      {result.error && <p className="manage-error" role="alert">Refresh failed: {result.error.message}</p>}

      <div className="manage-panel-actions">
        <button className="primary-button" type="button" data-tv-focusable="true" onClick={() => setAdding(true)}>
          Add a user
        </button>
      </div>
      <NewUserDialogue
        api={api}
        policy={session?.password_policy}
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={onChanged}
      />

      {users.length === 0
        ? <p className="manage-empty">No accounts exist yet.</p>
        : (
          <ul className="record-list">
            {users.map((user, index) => (
              <Fragment key={user.id}>
                {index === ordinaryFrom && ordinaryFrom > 0 && <li className="record-divider" aria-hidden="true" />}
                <UserRow
                  api={api}
                  user={user}
                  policy={session?.password_policy}
                  isSelf={user.id === session?.user_id}
                  onChanged={onChanged}
                />
              </Fragment>
            ))}
          </ul>
        )}
    </section>
  );
}
