// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@machafoundation/core';
import { LoginScreen } from './LoginScreen';

/** Where the screen asked to go, in order. */
let navigated: string[] = [];
beforeEach(() => { navigated = []; });

/**
 * Records where the router actually went, skipping the initial entry — which
 * is where the test placed the screen, not somewhere it chose to go.
 *
 * Observing the real router rather than mocking `useNavigate`, so these tests
 * fail if the screen navigates by some other means.
 */
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
    // The wall case. A "Browse as guest" button here would navigate home and
    // be bounced straight back by the redirect, so it is removed rather than
    // left to fail — and this is the assertion that keeps it removed.
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
    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith('alice', 'hunter2'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it('says a refusal in words a viewer can act on, and clears the password', async () => {
    // Core hands up "Could not start a session: 401", which describes the
    // transport rather than the situation and reads like a fault in the
    // software. One message covers a wrong password and an unknown username
    // alike, because the server answers those identically on purpose.
    const refusal = Object.assign(new Error('Could not start a session: 401'), { status: 401 });
    const onSignIn = vi.fn(() => Promise.reject(refusal));
    renderLogin({ guestAllowed: false, onSignIn });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe('That username and password were not recognised. Please try again.'));
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('keeps the original wording for anything that is not a refusal', async () => {
    // An unreachable node is not a wrong password, and saying so sends someone
    // hunting for a typo that is not there.
    const outage = Object.assign(new Error('No Macha node could be reached.'), { status: 503 });
    renderLogin({ onSignIn: vi.fn(() => Promise.reject(outage)) });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No Macha node could be reached.'));
  });

  it('waits for the new roles before navigating, so it cannot bounce back here', async () => {
    // The token is live at once but the roles are not. Navigating in between is
    // judged against the session just replaced, which on a cluster whose
    // anonymous account holds nothing means landing back on this screen with
    // no sign anything happened.
    const order: string[] = [];
    const onSignedIn = vi.fn(() => {
      order.push('refresh-started');
      return new Promise<void>((resolve) => setTimeout(() => { order.push('roles-known'); resolve(); }, 20));
    });
    renderLogin({ guestAllowed: false, onSignedIn });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(navigated).toHaveLength(1));
    expect(order).toEqual(['refresh-started', 'roles-known']);
  });
});

describe('LoginScreen return destination', () => {
  it('returns the viewer to the page that sent them here', async () => {
    renderLogin({ guestAllowed: false }, '/movies');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(navigated).toEqual(['/movies']));
  });

  it('falls back to Home when nothing recorded where they came from', async () => {
    renderLogin({ guestAllowed: false });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(navigated).toEqual([routes.home]));
  });

  it('refuses to send them back to the login screen itself', async () => {
    // Signing in and landing on the sign-in form reads as a failure even
    // though it worked.
    renderLogin({ guestAllowed: false }, routes.login);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(navigated).toEqual([routes.home]));
  });
});
