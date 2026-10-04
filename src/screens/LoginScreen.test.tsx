// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachaConnectionError, routes } from '@machafoundation/core';
import { SERVER_UNREACHABLE_TEXT } from '../text/viewerText';
import { LoginScreen } from './LoginScreen';
import { settle } from '../test/settle';

/** Where the screen asked to go, in order. */
let navigated: string[] = [];
beforeEach(() => { navigated = []; });

/** Records where the real router went, skipping the initial entry. `useNavigate` is not mocked, so any navigation shows. */
function NavigationSpy() {
  const location = useLocation();
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    navigated.push(location.pathname);
  }, [location.pathname]);
  return null;
}

function renderLogin(
  props: Partial<Parameters<typeof LoginScreen>[0]> = {},
  from?: string,
) {
  const onSignIn = props.onSignIn ?? vi.fn(() => Promise.resolve());
  const onSignedIn = props.onSignedIn ?? vi.fn();
  render(
    <MemoryRouter initialEntries={[{ pathname: routes.login, state: from ? { from } : null }]}>
      <NavigationSpy />
      <LoginScreen {...props} onSignIn={onSignIn} onSignedIn={onSignedIn} />
    </MemoryRouter>,
  );
  return { onSignIn, onSignedIn };
}

describe('LoginScreen', () => {
  it('offers guest browsing by default, because most clusters allow it', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: 'Browse as guest' })).toBeTruthy();
  });

  it('offers no way past itself where the anonymous account may do nothing', () => {
    // A guest button here would navigate home and be bounced straight back.
    renderLogin({ guestAllowed: false });
    expect(screen.queryByRole('button', { name: 'Browse as guest' })).toBeNull();
    expect(screen.getByText('This server requires an account. Sign in to continue.')).toBeTruthy();
  });

  it('still signs in from the wall, and says who to tell', async () => {
    const { onSignIn, onSignedIn } = renderLogin({ guestAllowed: false });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' alice ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    // Trimmed, because a username typed on a remote picks up spaces.
    await settle();
    expect(onSignIn).toHaveBeenCalledWith('alice', 'hunter2');
    await settle();
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('says a refusal in words a viewer can act on, and clears the password', async () => {
    // Core's error names the transport ("Could not start a session: 401"). One message covers a wrong
    // password and an unknown username, which the server answers identically.
    const refusal = Object.assign(new Error('Could not start a session: 401'), { status: 401 });
    const onSignIn = vi.fn(() => Promise.reject(refusal));
    renderLogin({ guestAllowed: false, onSignIn });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(screen.getByRole('alert').textContent)
      .toBe('That username and password were not recognised. Please try again.');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('says an unreachable server is unreachable, not a wrong password', async () => {
    // The error's message is core's log text, so the sentence is this client's.
    renderLogin({ onSignIn: vi.fn(() => Promise.reject(new MachaConnectionError())) });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(screen.getByRole('alert').textContent).toBe(SERVER_UNREACHABLE_TEXT);
  });

  it('shows the server\'s own sentence for anything else it refused in words', async () => {
    const refused = Object.assign(new Error('session request failed: 423'), { detail: 'This account is locked.', status: 423 });
    renderLogin({ onSignIn: vi.fn(() => Promise.reject(refused)) });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(screen.getByRole('alert').textContent).toBe('This account is locked.');
  });

  it('waits for the new roles before navigating, so it cannot bounce back here', async () => {
    // The token is live at once but the roles are not; navigating early is judged against the old session.
    let rolesKnown: (() => void) | undefined;
    const onSignedIn = vi.fn(() => new Promise<void>((resolve) => { rolesKnown = resolve; }));
    renderLogin({ guestAllowed: false, onSignedIn });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(navigated).toEqual([]);

    rolesKnown?.();
    await settle();
    expect(navigated).toHaveLength(1);
  });
});

describe('LoginScreen return destination', () => {
  it('returns the viewer to the page that sent them here', async () => {
    renderLogin({ guestAllowed: false }, '/movies');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(navigated).toEqual(['/movies']);
  });

  it('falls back to Home when nothing recorded where they came from', async () => {
    renderLogin({ guestAllowed: false });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(navigated).toEqual([routes.home]);
  });

  it('refuses to send them back to the login screen itself', async () => {
    renderLogin({ guestAllowed: false }, routes.login);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await settle();
    expect(navigated).toEqual([routes.home]);
  });
});
