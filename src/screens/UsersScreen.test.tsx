// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, MachaUser, UserMutability, UsersApi } from '@machafoundation/core';
import { UsersScreen, usersScreenAvailable } from './UsersScreen';

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

/** The card for one account, found by the username shown in its own input. */
async function card(username: string): Promise<HTMLElement> {
  const input = await screen.findByDisplayValue(username);
  const host = input.closest('li');
  if (!host) throw new Error(`no card around ${username}`);
  return host;
}

describe('UsersScreen', () => {
  it('locks rename and removal on a protected account, from the server\'s own flags', async () => {
    // Root and anonymous are ordinary records that happen to be protected.
    // Nothing here may test the username: those names are the server's to
    // choose, and a client-side guess would disable the wrong controls on
    // every client at once.
    render(<UsersScreen api={fakeApi([user({ id: 'root', username: 'root', mutable: { rename: false, delete: false } as UserMutability })])} session={session()} />);

    const root = await card('root');
    expect(disabled(within(root).getByDisplayValue('root'))).toBe(true);
    expect(within(root).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(root).getByText('This account cannot be renamed.')).toBeTruthy();
    expect(within(root).getByText('Cannot be removed.')).toBeTruthy();
  });

  it('leaves an ordinary account fully editable', async () => {
    // The counterpart to the test above: the flags have to be able to say yes,
    // or "locked" would be indistinguishable from "always locked".
    render(<UsersScreen api={fakeApi([user()])} session={session()} />);

    const alice = await card('alice');
    expect(disabled(within(alice).getByDisplayValue('alice'))).toBe(false);
    expect(within(alice).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('explains a roles lock caused by the last-manager rule, rather than greying it silently', async () => {
    render(<UsersScreen
      api={fakeApi([user({ roles: ['manage_users'], mutable: { set_roles: false, set_roles_blocked_by: 'last_user_manager' } as UserMutability })])}
      session={session()}
    />);

    const alice = await card('alice');
    expect(within(alice).getByText(/only account that can manage users/)).toBeTruthy();
    expect(disabled(within(alice).getByRole('checkbox', { name: /Manage users/ }))).toBe(true);
  });

  it('puts a taken username against the username field, not in a general failure', async () => {
    // Knowing which input was wrong is the whole value of an error code.
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('That username is taken.'), { code: 'username_taken', status: 409 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    const alice = await card('alice');
    fireEvent.change(within(alice).getByDisplayValue('alice'), { target: { value: 'bob' } });
    fireEvent.click(within(alice).getByRole('button', { name: 'Save changes' }));

    const message = await within(alice).findByText('That username is taken.');
    // "Against the field" means somewhere the reader associates with the
    // username: not buried in the roles fieldset, and not under the password.
    expect(message.closest('fieldset')).toBeNull();
    expect(message.closest('.user-password')).toBeNull();
    expect(update).toHaveBeenCalledWith('user-1', { username: 'bob' });
  });

  it('puts a rejected password under the password control instead', async () => {
    // The counterpart, so the test above proves a mapping rather than just
    // that one message rendered somewhere.
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('That password is too weak.'), { code: 'password_rejected', status: 400 })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    const alice = await card('alice');
    fireEvent.change(within(alice).getByLabelText('Set a new password'), { target: { value: 'wibble-wobble' } });
    fireEvent.click(within(alice).getByRole('button', { name: 'Change password' }));

    const message = await within(alice).findByText('That password is too weak.');
    expect(message.closest('.user-password')).not.toBeNull();
  });

  it('sends only the fields that actually changed', async () => {
    // A PATCH carrying an unchanged username is a rename request the viewer
    // never made, and on a protected account the server would refuse the whole
    // call over a field nobody touched.
    const update = vi.fn(() => Promise.resolve(user({ roles: ['media_viewer', 'importer'] })));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session()} />);

    const alice = await card('alice');
    fireEvent.click(within(alice).getByRole('checkbox', { name: /Import/ }));
    fireEvent.click(within(alice).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('user-1', { roles: ['media_viewer', 'importer'] }));
  });

  it('rejects a short password before spending a round trip, using the server\'s stated minimum', async () => {
    const update = vi.fn();
    render(<UsersScreen
      api={fakeApi([user()], { update })}
      session={session({ password_policy: { min_password_length: 8 } })}
    />);

    const alice = await card('alice');
    fireEvent.change(within(alice).getByLabelText('Set a new password'), { target: { value: 'short' } });
    fireEvent.click(within(alice).getByRole('button', { name: 'Change password' }));

    expect(await within(alice).findByText('Passwords must be at least 8 characters.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('checks no password length of its own when the server states no rule', async () => {
    // An absent field means "no such rule", not "fall back to whatever this
    // client last believed". Inventing a minimum here would reject passwords
    // the server accepts.
    const update = vi.fn(() => Promise.resolve(user()));
    render(<UsersScreen api={fakeApi([user()], { update })} session={session({ password_policy: {} })} />);

    const alice = await card('alice');
    fireEvent.change(within(alice).getByLabelText('Set a new password'), { target: { value: 'x' } });
    fireEvent.click(within(alice).getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('user-1', { password: 'x' }));
  });

  it('hides the password control entirely where the server says it cannot be set', async () => {
    render(<UsersScreen
      api={fakeApi([user({ username: 'anonymous', mutable: { set_password: false } as UserMutability })])}
      session={session()}
    />);

    const anonymous = await card('anonymous');
    expect(within(anonymous).queryByLabelText('Set a new password')).toBeNull();
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
