// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession, UsersApi } from '@machafoundation/core';
import { AccountMenu } from './AccountMenu';

function api(): UsersApi {
  return { logout: vi.fn(() => Promise.resolve()) } as unknown as UsersApi;
}

function session(overrides: Partial<CurrentSession> = {}): CurrentSession {
  return {
    user_id: 'u1',
    username: 'alice',
    roles: ['media_viewer'],
    expires_unix_ms: Date.now() + 60_000,
    ...overrides,
  };
}

function show(current: CurrentSession) {
  render(
    <MemoryRouter>
      <AccountMenu api={api()} session={current} onSignedOut={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('AccountMenu', () => {
  it('offers a way in, and nothing else, for the anonymous account', () => {
    // Its session is mechanically ordinary — roles, validation, revocation all
    // work — but it represents nobody who chose to be anyone, so there is no
    // account to manage and no sign-out anyone would recognise as theirs.
    show(session({ username: 'anonymous' }));

    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Account options/ })).toBeNull();
    expect(screen.queryByText('anonymous')).toBeNull();
  });

  it('does the same where the server names no user at all', () => {
    // An older node has sessions but no accounts. Offering "change your
    // password" for a user it does not model would be a promise nothing can
    // keep, and the word `undefined` in the label is worse still.
    show(session({ username: undefined }));

    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Account options/ })).toBeNull();
  });

  it('names a signed-in user and offers the account menu', () => {
    show(session());

    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account options for alice' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
  });

  it('treats a username that is only whitespace as no username', () => {
    // A server that pads or blanks the field must not produce an account chip
    // with nothing in it and a menu that cannot describe whose account it is.
    show(session({ username: '   ' }));

    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
  });
});
