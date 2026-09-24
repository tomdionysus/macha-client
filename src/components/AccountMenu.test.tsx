// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentSession } from '@machafoundation/core';
import { AccountMenu } from './AccountMenu';

function session(overrides: Partial<CurrentSession> = {}): CurrentSession {
  return {
    user_id: 'u1',
    username: 'alice',
    roles: ['media_viewer'],
    expires_unix_ms: Date.now() + 60_000,
    ...overrides,
  };
}

function show(current: CurrentSession, onSignOut = vi.fn(() => Promise.resolve())) {
  render(
    <MemoryRouter>
      <AccountMenu session={current} onSignOut={onSignOut} />
    </MemoryRouter>,
  );
  return onSignOut;
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

  it('makes the identity itself the control, with no second target beside it', () => {
    // It used to be an inert username-and-icon chip next to a `⋯` button:
    // two adjacent targets for one idea, an account icon that looked
    // pressable and did nothing, and an extra D-pad stop on a remote to
    // reach the half that worked.
    show(session());

    const trigger = screen.getByRole('button', { name: 'Account options for alice' });
    expect(trigger.textContent).toContain('alice');
    expect(trigger.querySelector('.account-icon')).toBeTruthy();
    // The ellipsis glyph is what a separate trigger would have rendered.
    expect(screen.queryByText('⋯')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('opens the account actions when the identity is pressed', () => {
    show(session());

    expect(screen.queryByRole('menuitem', { name: 'Log out' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account options for alice' }));
    expect(screen.getByRole('menuitem', { name: 'User details' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeTruthy();
  });

  it('describes what logging out actually does, and not more', () => {
    // `logout()` is DELETE /api/v1/session, which revokes one token. Verified
    // against gbni-1: two sessions minted for one account, one revoked, the
    // other still answered 200. Claiming it signs the account out everywhere
    // describes what a password or role change does — and telling someone
    // their other devices are signed out when they are not stops them doing
    // the thing they actually needed.
    show(session());
    fireEvent.click(screen.getByRole('button', { name: 'Account options for alice' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('on this device only');
    expect(dialog.textContent).not.toMatch(/everywhere/i);
  });

  it('logs out through the app, which stops playback and revokes the session, only once confirmed', async () => {
    const onSignOut = show(session());
    fireEvent.click(screen.getByRole('button', { name: 'Account options for alice' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(onSignOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('treats a username that is only whitespace as no username', () => {
    // A server that pads or blanks the field must not produce an account chip
    // with nothing in it and a menu that cannot describe whose account it is.
    show(session({ username: '   ' }));

    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
  });
});
