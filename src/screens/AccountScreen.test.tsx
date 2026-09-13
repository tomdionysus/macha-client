// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { MachaUser, UserMutability, UsersApi } from '@machafoundation/core';
import { AccountScreen } from './AccountScreen';

function account(mutable: Partial<UserMutability> | undefined): MachaUser {
  return {
    id: 'user-1',
    username: 'anonymous',
    roles: [],
    created_unix_ms: 0,
    updated_unix_ms: 0,
    credential_generation: 1,
    version: 1,
    // `undefined` models an older node that states no mutability block at all.
    mutable: mutable as UserMutability,
  };
}

function fakeApi(user: MachaUser): UsersApi {
  const unused = () => { throw new Error('not used in this test'); };
  return {
    list: unused, get: unused, create: unused, update: unused, remove: unused,
    me: () => Promise.resolve(user),
    changeOwnPassword: unused, logout: unused,
  } as unknown as UsersApi;
}

function renderAccount(user: MachaUser) {
  render(<MemoryRouter><AccountScreen api={fakeApi(user)} /></MemoryRouter>);
}

describe('AccountScreen password control', () => {
  it('offers a password change for an account that may set one', async () => {
    renderAccount(account({ rename: true, delete: true, set_password: true, set_roles: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy());
  });

  it('offers none for an account that holds no credential, and says why', async () => {
    // The anonymous account on server 0.38.4: no credential at all, so a
    // password PATCH answers 409 `no_password`. Drawing the control anyway
    // would be a button whose only possible outcome is an error.
    renderAccount(account({ rename: false, delete: false, set_password: false, set_roles: true }));
    await waitFor(() => expect(screen.getByText('This account has no password, and one cannot be set for it.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('keeps the control where the server states no mutability at all', async () => {
    // An older node saying nothing is not a refusal. The server still decides;
    // hiding the control on silence would remove it for everyone on that node.
    renderAccount(account(undefined));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy());
  });
});
