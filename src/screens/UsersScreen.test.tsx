// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, MachaUser, UserMutability, UsersApi } from '@machafoundation/core';
import { byStanding, roleSummary, UsersScreen } from './UsersScreen';
import { settle } from '../test/settle';

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
  await settle();
  const main = screen.getByRole('button', { name: `Edit ${username}` });
  const host = main.closest('li');
  if (!host) throw new Error(`no row around ${username}`);
  return host;
}

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
    expect(roleSummary(['manage_users', 'media_viewer'])).toBe('View media · Manage users');
    expect(roleSummary(['media_viewer', 'manage_users'])).toBe('View media · Manage users');
  });

  it('says so when an account holds nothing, rather than rendering an empty cell', () => {
    expect(roleSummary([])).toBe('No roles');
  });

  it('counts a role this build does not recognise instead of dropping it', () => {
    expect(roleSummary(['media_viewer', 'future_role' as never])).toBe('View media · 1 other role');
  });
});

/** The superuser: protected, and able to hold a password. */
const rootUser = (username = 'root') =>
  user({ id: username, username, mutable: { rename: false, delete: false, set_roles: true, set_password: true } as UserMutability });
/** Protected, and holds no credential. */
const anonymousUser = (username = 'anonymous') =>
  user({ id: username, username, mutable: { rename: false, delete: false, set_roles: true, set_password: false } as UserMutability });
const ordinary = (username: string) => user({ id: username, username });

describe('byStanding', () => {
  it('puts protected accounts above ordinary ones, whatever they are called', () => {
    // `zulu` before `alice` proves this is not alphabetical.
    expect([ordinary('alice'), rootUser('zulu')].sort(byStanding).map((each) => each.username))
      .toEqual(['zulu', 'alice']);
  });

  it('puts root above anonymous, which alphabetical order would not', () => {
    // Told apart by `set_password`: anonymous can hold no credential.
    expect([anonymousUser(), rootUser()].sort(byStanding).map((each) => each.username))
      .toEqual(['root', 'anonymous']);
  });

  it('keeps that order when the two are named something else entirely', () => {
    expect([anonymousUser('guest'), rootUser('admin')].sort(byStanding).map((each) => each.username))
      .toEqual(['admin', 'guest']);
  });

  it('sorts the ordinary accounts alphabetically below them', () => {
    expect([ordinary('carol'), rootUser(), ordinary('bob'), anonymousUser()]
      .sort(byStanding)
      .map((each) => each.username)).toEqual(['root', 'anonymous', 'bob', 'carol']);
  });

  it('does not float an ordinary account that merely cannot be deleted', () => {
    // `delete` is also withheld from the last manage_users holder and from one's
    // own account, so it must not decide the order.
    const lastManager = user({ id: 'a', username: 'zoe', mutable: { rename: true, delete: false, set_roles: true, set_password: true } as UserMutability });
    expect([lastManager, ordinary('alice')].sort(byStanding).map((each) => each.username)).toEqual(['alice', 'zoe']);
  });
});

describe('UsersScreen', () => {
  it('lists each account with its roles, and puts no input in the list', async () => {
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

    await settle();
    screen.getByRole('button', { name: 'Edit alice' });
    const names = [...document.querySelectorAll('.record-name')].map((each) => each.textContent?.replace('You', '').trim());
    expect(names).toEqual(['root', 'anonymous', 'alice']);
  });

  it('draws one divider, between the protected pair and everyone else', async () => {
    render(<UsersScreen
      api={fakeApi([ordinary('bob'), ordinary('alice'), anonymousUser(), rootUser()])}
      session={session()}
    />);

    await settle();
    screen.getByRole('button', { name: 'Edit alice' });
    const rows = [...document.querySelectorAll('.record-list > li')];
    const dividers = rows.filter((each) => each.classList.contains('record-divider'));
    expect(dividers).toHaveLength(1);
    // After anonymous, before the first ordinary account.
    expect(rows.indexOf(dividers[0])).toBe(2);
    expect(rows[3]?.querySelector('.record-name')?.textContent).toBe('alice');
  });

  it('draws no divider when there is nothing on one side of it', async () => {
    // A fresh install holds only the protected pair.
    render(<UsersScreen api={fakeApi([anonymousUser(), rootUser()])} session={session()} />);

    await settle();
    screen.getByRole('button', { name: 'Edit root' });
    expect(document.querySelectorAll('.record-divider')).toHaveLength(0);
  });

  it('marks the signed-in account, so nobody edits the wrong one', async () => {
    render(<UsersScreen api={fakeApi([user({ id: 'user-1' }), user({ id: 'other', username: 'bob' })])} session={session()} />);

    expect(within(await row('alice')).getByText('You')).toBeTruthy();
    expect(within(await row('bob')).queryByText('You')).toBeNull();
  });

  it('locks rename and removal on a protected account, from the server\'s own flags', async () => {
    // Nothing may test the username: the names are the server's to choose.
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
    // The counterpart to the test above: the flags must be able to say yes.
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
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('users request failed: 409'), { detail: 'That username is taken.', code: 'username_taken', status: 409 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    fireEvent.change(within(dialogue()).getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Save' }));

    await settle();
    const message = within(dialogue()).getByText('That username is taken.');
    // Not inside the roles fieldset, and not in the dialogue's form-level slot.
    expect(message.closest('fieldset')).toBeNull();
    expect(message.previousElementSibling?.querySelector('input')).toBeTruthy();
    expect(update).toHaveBeenCalledWith('user-1', { username: 'bob' });
  });

  it('keeps the dialogue open when the server refuses, so the explanation survives', async () => {
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('users request failed: 409'), { detail: 'That username is taken.', code: 'username_taken', status: 409 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    fireEvent.change(within(dialogue()).getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Save' }));

    await settle();
    within(dialogue()).getByText('That username is taken.');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('puts a rejected password in the password dialogue, not against the account\'s roles', async () => {
    // The counterpart to the username test: proves a mapping, not just a rendered message.
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('users request failed: 400'), { detail: 'That password is too weak.', code: 'password_rejected', status: 400 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Set a password');
    fireEvent.change(within(dialogue()).getByLabelText('New password'), { target: { value: 'wibble-wobble' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Change password' }));

    await settle();
    expect(within(dialogue()).getByText('That password is too weak.')).toBeTruthy();
    expect(update).toHaveBeenCalledWith('user-1', { password: 'wibble-wobble' });
  });

  it('sends only the fields that actually changed', async () => {
    // An unchanged username in the PATCH is a rename request, which a protected account refuses.
    const update = vi.fn(() => Promise.resolve(user({ roles: ['media_viewer', 'importer'] })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    await chooseAction('alice', 'Edit');
    fireEvent.click(within(dialogue()).getByRole('checkbox', { name: /Import/ }));
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Save' }));

    await settle();
    expect(update).toHaveBeenCalledWith('user-1', { roles: ['media_viewer', 'importer'] });
  });

  it('cannot save a dialogue nobody has changed', async () => {
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

    await settle();
    expect(within(dialogue()).getByText('Passwords must be at least 8 characters.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('checks no password length of its own when the server states no rule', async () => {
    // An absent field means no rule; an invented minimum would reject passwords the server accepts.
    const update = vi.fn(() => Promise.resolve(user()));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session({ password_policy: {} })} />);

    await chooseAction('alice', 'Set a password');
    fireEvent.change(within(dialogue()).getByLabelText('New password'), { target: { value: 'x' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Change password' }));

    await settle();
    expect(update).toHaveBeenCalledWith('user-1', { password: 'x' });
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

    await settle();
    screen.getByRole('button', { name: 'Edit alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a user' }));
    fireEvent.change(within(dialogue()).getByLabelText('Username'), { target: { value: 'carol' } });
    fireEvent.change(within(dialogue()).getByLabelText('Password'), { target: { value: 'a-good-password' } });
    fireEvent.click(within(dialogue()).getByRole('button', { name: 'Create user' }));

    await settle();
    expect(create).toHaveBeenCalledWith({
      username: 'carol',
      password: 'a-good-password',
      roles: ['media_viewer'],
    });
  });
});
