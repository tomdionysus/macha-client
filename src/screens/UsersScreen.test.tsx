// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, MachaUser, UserMutability, UsersApi } from '@machafoundation/core';
import { byStanding, roleSummary, UsersScreen, usersScreenAvailable } from './UsersScreen';

function user(overrides: Partial<MachaUser> = {}): MachaUser {
  return {
    id: overrides.id ?? 'user-1',
    username: overrides.username ?? 'alice',
    roles: overrides.roles ?? ['media_viewer'],
    created_unix_ms: 0,
    updated_unix_ms: 0,
    credential_generation: 1,
    version: 1,
    mutable: { rename: true, delete: true, set_password: true, set_roles: true, ...(overrides.mutable ?? {}) } as UserMutability,
  };
}

function fakeApi(users: MachaUser[], overrides: Partial<UsersApi> = {}): UsersApi {
  const unused = () => { throw new Error('not used in this test'); };
  return {
    list: () => Promise.resolve(users),
    get: unused,
    create: unused,
    update: unused,
    remove: unused,
    me: unused,
    changeOwnPassword: unused,
    currentSession: unused,
    ...overrides,
  } as unknown as UsersApi;
}

function session(overrides: Partial<CurrentSession> = {}): CurrentSession {
  return {
    user_id: 'user-1',
    username: 'alice',
    roles: ['manage_users'],
    expires_unix_ms: Date.now() + 60_000,
    ...overrides,
  };
}

function disabled(element: HTMLElement): boolean {
  return (element as HTMLInputElement).disabled;
}

/** The list row for one account. Rows carry no inputs, so it is found by name. */
async function row(username: string): Promise<HTMLElement> {
  const main = await screen.findByRole('button', { name: `Edit ${username}` });
  const host = main.closest('li');
  if (!host) throw new Error(`no row around ${username}`);
  return host;
}

/** Open a row's action menu and choose one, the way a viewer would. */
async function chooseAction(username: string, action: string): Promise<void> {
  const host = await row(username);
  fireEvent.click(within(host).getByRole('button', { name: `Actions for ${username}` }));
  fireEvent.click(within(host).getByRole('menuitem', { name: action }));
}

/** The open dialogue. There is only ever one. */
function dialogue(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('roleSummary', () => {
  it('names roles in the canonical order, not the order the server happened to list them', () => {
    // Two accounts holding the same roles must read identically, or a list is
    // impossible to scan.
    expect(roleSummary(['manage_users', 'media_viewer'])).toBe('View media · Manage users');
    expect(roleSummary(['media_viewer', 'manage_users'])).toBe('View media · Manage users');
  });

  it('says so when an account holds nothing, rather than rendering an empty cell', () => {
    // An account that can sign in and do nothing is a real state and the one
    // most worth noticing.
    expect(roleSummary([])).toBe('No roles');
  });

  it('counts a role this build does not recognise instead of dropping it', () => {
    // The server granted it. Showing "View media" alone would under-report
    // what the account can do, which is the wrong direction to be wrong in.
    expect(roleSummary(['media_viewer', 'future_role' as never])).toBe('View media · 1 other role');
  });
});

/** The superuser: protected, and able to hold a password. */
const rootUser = (username = 'root') =>
  user({ id: username, username, mutable: { rename: false, delete: false, set_roles: true, set_password: true } as UserMutability });
/** The account that exists to be nobody: protected, and holds no credential at all. */
const anonymousUser = (username = 'anonymous') =>
  user({ id: username, username, mutable: { rename: false, delete: false, set_roles: true, set_password: false } as UserMutability });
const ordinary = (username: string) => user({ id: username, username });

describe('byStanding', () => {
  it('puts protected accounts above ordinary ones, whatever they are called', () => {
    // root and anonymous are the accounts an operator cannot recreate, so they
    // are worth finding without scrolling. `zulu` beating `alice` is what
    // proves this is not simply sorting alphabetically.
    expect([ordinary('alice'), rootUser('zulu')].sort(byStanding).map((each) => each.username))
      .toEqual(['zulu', 'alice']);
  });

  it('puts root above anonymous, which alphabetical order would not', () => {
    // The ordering Tom asked for, and the one the alphabet gets backwards.
    // Read from `set_password`: anonymous is the account that can hold no
    // credential, which is what separates it from the superuser.
    expect([anonymousUser(), rootUser()].sort(byStanding).map((each) => each.username))
      .toEqual(['root', 'anonymous']);
  });

  it('keeps that order when the two are named something else entirely', () => {
    // The flags carry the meaning, not the names. A deployment that calls them
    // `admin` and `guest` must still get the superuser first.
    expect([anonymousUser('guest'), rootUser('admin')].sort(byStanding).map((each) => each.username))
      .toEqual(['admin', 'guest']);
  });

  it('sorts the ordinary accounts alphabetically below them', () => {
    expect([ordinary('carol'), rootUser(), ordinary('bob'), anonymousUser()]
      .sort(byStanding)
      .map((each) => each.username)).toEqual(['root', 'anonymous', 'bob', 'carol']);
  });

  it('does not float an ordinary account that merely cannot be deleted', () => {
    // `delete` is withheld from the last manage_users holder and from your own
    // account too. Sorting on it would pin whoever happens to be signed in to
    // the top of the list, which is not what protection means.
    const lastManager = user({ id: 'a', username: 'zoe', mutable: { rename: true, delete: false, set_roles: true, set_password: true } as UserMutability });
    expect([lastManager, ordinary('alice')].sort(byStanding).map((each) => each.username)).toEqual(['alice', 'zoe']);
  });
});

describe('UsersScreen', () => {
  it('lists each account with its roles, and puts no input in the list', async () => {
    // The whole point of the redesign: the list is for reading. Anything
    // editable in a row is a control the viewer can change without meaning to.
    render(<UsersScreen
      api={fakeApi([user({ id: 'a', username: 'alice', roles: ['media_viewer', 'manage_users'] })])}
      session={session()}
    />);

    const alice = await row('alice');
    expect(within(alice).getByText('View media · Manage users')).toBeTruthy();
    expect(alice.querySelector('input')).toBeNull();
  });

  it('renders the list in that order, not the order the server sent', async () => {
    // The comparator is tested above; this proves the screen actually uses it.
    render(<UsersScreen
      api={fakeApi([ordinary('alice'), anonymousUser(), rootUser()])}
      session={session()}
    />);

    await screen.findByRole('button', { name: 'Edit alice' });
    const names = [...document.querySelectorAll('.record-name')].map((each) => each.textContent?.replace('You', '').trim());
    expect(names).toEqual(['root', 'anonymous', 'alice']);
  });

  it('draws one divider, between the protected pair and everyone else', async () => {
    render(<UsersScreen
      api={fakeApi([ordinary('bob'), ordinary('alice'), anonymousUser(), rootUser()])}
      session={session()}
    />);

    await screen.findByRole('button', { name: 'Edit alice' });
    const rows = [...document.querySelectorAll('.record-list > li')];
    const dividers = rows.filter((each) => each.classList.contains('record-divider'));
    expect(dividers).toHaveLength(1);
    // Immediately after anonymous, immediately before the first ordinary
    // account: a rule anywhere else groups the wrong things.
    expect(rows.indexOf(dividers[0])).toBe(2);
    expect(rows[3]?.querySelector('.record-name')?.textContent).toBe('alice');
  });

  it('draws no divider when there is nothing on one side of it', async () => {
    // A line above nothing, or below nothing, is a rule with no two things
    // either side of it. A fresh install with only the protected pair is the
    // case that actually happens.
    render(<UsersScreen api={fakeApi([anonymousUser(), rootUser()])} session={session()} />);

    await screen.findByRole('button', { name: 'Edit root' });
    expect(document.querySelectorAll('.record-divider')).toHaveLength(0);
  });

  it('marks the signed-in account, so nobody edits the wrong one', async () => {
    render(<UsersScreen api={fakeApi([user({ id: 'user-1' }), user({ id: 'other', username: 'bob' })])} session={session()} />);

    expect(within(await row('alice')).getByText('You')).toBeTruthy();
    expect(within(await row('bob')).queryByText('You')).toBeNull();
  });

  it('locks rename and removal on a protected account, from the server\'s own flags', async () => {
    // Root and anonymous are ordinary records that happen to be protected.
    // Nothing here may test the username: those names are the server's to
    // choose, and a client-side guess would disable the wrong controls on
    // every client at once.
    render(<UsersScreen
      api={fakeApi([user({ id: 'root', username: 'root', mutable: { rename: false, delete: false, set_roles: true, set_password: true } as UserMutability })])}
      session={session()}
    />);

    const root = await row('root');
    fireEvent.click(within(root).getByRole('button', { name: 'Actions for root' }));
    expect(within(root).queryByRole('menuitem', { name: 'Remove' })).toBeNull();

    fireEvent.click(within(root).getByRole('menuitem', { name: 'Edit' }));
    expect(disabled(within(dialogue()).getByLabelText('Username'))).toBe(true);
    expect(within(dialogue()).getByText('This account cannot be renamed.')).toBeTruthy();
  });

  it('leaves an ordinary account fully editable', async () => {
    // The counterpart to the test above: the flags have to be able to say yes,
    // or "locked" would be indistinguishable from "always locked".
    render(<UsersScreen api={fakeApi([user()])} session={session()} />);

    const alice = await row('alice');
    fireEvent.click(within(alice).getByRole('button', { name: 'Actions for alice' }));
    expect(within(alice).getByRole('menuitem', { name: 'Remove' })).toBeTruthy();

    fireEvent.click(within(alice).getByRole('menuitem', { name: 'Edit' }));
    expect(disabled(within(dialogue()).getByLabelText('Username'))).toBe(false);
  });

  it('explains a roles lock caused by the last-manager rule, rather than greying it silently', async () => {
    render(<UsersScreen
      api={fakeApi([user({ roles: ['manage_users'], mutable: { rename: true, delete: true, set_password: true, set_roles: false, set_roles_blocked_by: 'last_user_manager' } as UserMutability })])}
      session={session()}
    />);

    await chooseAction('alice', 'Edit');
    expect(within(dialogue()).getByText(/only account that can manage users/)).toBeTruthy();
    expect(disabled(within(dialogue()).getByRole('checkbox', { name: /Manage users/ }))).toBe(true);
  });

  it('puts a taken username against the username field, not in a general failure', async () => {
    // Knowing which input was wrong is the whole value of an error code.
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('That username is taken.'), { code: 'username_taken', status: 409 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    fireEvent.change(within(dialogue()).getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Save' }));

    const message = await within(dialogue()).findByText('That username is taken.');
    // "Against the field" means somewhere the reader associates with the
    // username: not inside the roles fieldset, and not in the dialogue's
    // form-level slot at the foot.
    expect(message.closest('fieldset')).toBeNull();
    expect(message.previousElementSibling?.querySelector('input')).toBeTruthy();
    expect(update).toHaveBeenCalledWith('user-1', { username: 'bob' });
  });

  it('keeps the dialogue open when the server refuses, so the explanation survives', async () => {
    // A dialogue that closes on failure takes the only account of what went
    // wrong with it, and the viewer is left looking at an unchanged list.
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('That username is taken.'), { code: 'username_taken', status: 409 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    fireEvent.change(within(dialogue()).getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Save' }));

    await within(dialogue()).findByText('That username is taken.');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('puts a rejected password in the password dialogue, not against the account\'s roles', async () => {
    // The counterpart to the username test, so that one proves a mapping
    // rather than just that a message rendered somewhere.
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('That password is too weak.'), { code: 'password_rejected', status: 400 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Set a password');
    fireEvent.change(within(dialogue()).getByLabelText('New password'), { target: { value: 'wibble-wobble' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Change password' }));

    expect(await within(dialogue()).findByText('That password is too weak.')).toBeTruthy();
    expect(update).toHaveBeenCalledWith('user-1', { password: 'wibble-wobble' });
  });

  it('sends only the fields that actually changed', async () => {
    // A PATCH carrying an unchanged username is a rename request the viewer
    // never made, and on a protected account the server would refuse the whole
    // call over a field nobody touched.
    const update = vi.fn(() => Promise.resolve(user({ roles: ['media_viewer', 'importer'] })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    fireEvent.click(within(dialogue()).getByRole('checkbox', { name: /Import/ }));
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('user-1', { roles: ['media_viewer', 'importer'] }));
  });

  it('cannot save a dialogue nobody has changed', async () => {
    // Opening an editor to look at it must not be able to spend a request.
    const update = vi.fn();
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    expect(disabled(within(dialogue()).getByRole('button', { name: 'Save' }))).toBe(true);
  });

  it('rejects a short password before spending a round trip, using the server\'s stated minimum', async () => {
    const update = vi.fn();
    render(<UsersScreen
      api={fakeApi([user()], { update })}
      session={session({ password_policy: { min_password_length: 8 } })}
    />);

    await chooseAction('alice', 'Set a password');
    fireEvent.change(within(dialogue()).getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Change password' }));

    expect(await within(dialogue()).findByText('Passwords must be at least 8 characters.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('checks no password length of its own when the server states no rule', async () => {
    // An absent field means "no such rule", not "fall back to whatever this
    // client last believed". Inventing a minimum here would reject passwords
    // the server accepts.
    const update = vi.fn(() => Promise.resolve(user()));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session({ password_policy: {} })} />);

    await chooseAction('alice', 'Set a password');
    fireEvent.change(within(dialogue()).getByLabelText('New password'), { target: { value: 'x' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('user-1', { password: 'x' }));
  });

  it('offers no password action at all where the server says one cannot be set', async () => {
    render(<UsersScreen
      api={fakeApi([user({ username: 'anonymous', mutable: { rename: false, delete: false, set_roles: true, set_password: false } as UserMutability })])}
      session={session()}
    />);

    const anonymous = await row('anonymous');
    fireEvent.click(within(anonymous).getByRole('button', { name: 'Actions for anonymous' }));
    expect(within(anonymous).queryByRole('menuitem', { name: 'Set a password' })).toBeNull();
  });

  it('creates an account from the new-user dialogue', async () => {
    const create = vi.fn(() => Promise.resolve(user({ username: 'carol' })));
    render(<UsersScreen api={fakeApi([user()], { create })} session={session()} />);

    await screen.findByRole('button', { name: 'Edit alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a user' }));
    fireEvent.change(within(dialogue()).getByLabelText('Username'), { target: { value: 'carol' } });
    fireEvent.change(within(dialogue()).getByLabelText('Password'), { target: { value: 'a-good-password' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Create user' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      username: 'carol',
      password: 'a-good-password',
      roles: ['media_viewer'],
    }));
  });
});

describe('usersScreenAvailable', () => {
  it('is false while the roles are unknown, because the screen may not exist at all', () => {
    // Distinct from every other section: this one appears only because the
    // server has accounts, so an unanswered whoami means there is nothing
    // there rather than something to reveal.
    expect(usersScreenAvailable(undefined)).toBe(false);
  });

  it('needs the manage_users role specifically, and never infers it from another', () => {
    expect(usersScreenAvailable(session({ roles: ['manager'] }))).toBe(false);
    expect(usersScreenAvailable(session({ roles: ['media_viewer', 'manage_users'] }))).toBe(true);
  });
});
