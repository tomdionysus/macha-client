import { Fragment, useCallback, useState } from 'react';
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
import { ConfirmModal, FormModal } from '../components/Modal';
import { OverflowMenu } from '../components/OverflowMenu';

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
 * What an account can do, in one line, in the canonical order.
 *
 * The list is for recognising an account and seeing what it holds at a glance;
 * the labels are the same ones the editor uses, so the summary and the
 * checkboxes never read as two different vocabularies. An account with no
 * roles is a real and important state — it can sign in and do nothing — so it
 * says so rather than rendering an empty cell.
 */
export function roleSummary(roles: readonly UserRole[]): string {
  const named = USER_ROLES.filter((role) => roles.includes(role)).map((role) => ROLE_LABELS[role]);
  // A role this build does not recognise still counts: the server granted it,
  // and silently dropping it would under-report what the account can do.
  const unrecognised = roles.filter((role) => !USER_ROLES.includes(role)).length;
  if (unrecognised > 0) named.push(unrecognised === 1 ? '1 other role' : `${unrecognised} other roles`);
  return named.length > 0 ? named.join(' · ') : 'No roles';
}

/**
 * An account the server protects from being renamed — `root` and `anonymous`,
 * on this deployment.
 *
 * Asked of the server's own flag rather than by testing for those two names,
 * which is the rule the rest of this screen follows: the names are the
 * server's to choose, and a client that tested for them would pin the wrong
 * accounts the moment they changed — and pin nothing at all on a deployment
 * that names them something else.
 *
 * `rename` is the honest one of the four flags for this. `delete` is also
 * withheld from the last `manage_users` holder and from your own account, both
 * of which are ordinary accounts that must not float to the top.
 */
export function isProtectedAccount(user: MachaUser): boolean {
  return user.mutable.rename === false;
}

/**
 * The two accounts an operator cannot recreate, first, and in that order:
 * `root`, then `anonymous`, then everyone else alphabetically.
 *
 * The order within the protected pair is also read from the server rather than
 * from the names. `anonymous` is the account that holds no credential at all —
 * server 0.38.4 made that explicit, answering `409 no_password` and stating
 * `set_password: false` — so "can hold a password" separates the operator's
 * own superuser from the account that exists to be nobody. That is the
 * difference the ordering is really about, and it survives a rename.
 */
export function byStanding(left: MachaUser, right: MachaUser): number {
  const protection = Number(isProtectedAccount(right)) - Number(isProtectedAccount(left));
  if (protection !== 0) return protection;
  if (isProtectedAccount(left)) {
    // The account that can hold a password first. Note the operands run the
    // other way round from the protection test above: there the flag being
    // true sorts first, here the flag being false sorts last.
    const credentialless = Number(left.mutable.set_password === false) - Number(right.mutable.set_password === false);
    if (credentialless !== 0) return credentialless;
  }
  return left.username.localeCompare(right.username);
}

/**
 * Which form field a server error belongs against.
 *
 * Codes, never message text: the server owns the wording and this only has to
 * know which control the reader should look at. Anything unrecognised
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

/**
 * One request from a dialogue, with the busy state and the error mapping that
 * every one of them needs.
 *
 * Returned rather than thrown on failure so the caller decides whether the
 * dialogue closes: a refusal has to stay on screen beside the field it
 * belongs to, and a dialogue that closes on failure takes the only
 * explanation with it.
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
 * Renaming an account and setting its roles — the two things that describe who
 * it is, together, because they are saved by one request.
 *
 * A password is not here. Setting one is a different kind of act with a
 * different consequence — it bumps `credential_generation` and signs that
 * account out everywhere — and burying it in the middle of an edit form is how
 * somebody does it by accident. It has its own dialogue, reached from the same
 * menu.
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
 * One account, as a row.
 *
 * The row states what the account is and nothing else; everything that changes
 * it opens a dialogue. Which actions are offered comes from the server's
 * per-field `mutable` block, never from the username — the names of the
 * protected accounts are the server's to choose, and a client that tested for
 * `root` or `anonymous` would be wrong the moment those names change, and
 * wrong everywhere at once because all four clients would carry the same
 * guess. An absent `mutable` is read as "this node does not say", not as a
 * refusal.
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
      setRemoveError(errorMessage(cause));
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <li className="record-row">
      {/* The row is the edit control, the way the account identity is its own
          menu trigger in the top bar. A separate "Edit" button beside a name
          that does nothing is two targets for one idea, and on a remote it
          costs a D-pad stop to reach the half that works. */}
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

  const users = [...result.value].sort(byStanding);
  // Where the protected pair stops and the ordinary accounts begin. A rule is
  // drawn there, and only there: a divider above nothing, or below nothing,
  // is a line with no two things either side of it.
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

/** Whether the signed-in session may see this screen at all. */
export function usersScreenAvailable(session: CurrentSession | undefined): boolean {
  return hasRole(session?.roles, 'manage_users');
}
