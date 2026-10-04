import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isSignedIn, routes, type CurrentSession } from '@machafoundation/core';
import { OverflowMenu } from './OverflowMenu';
import { ConfirmModal } from './Modal';

interface Props {
  session: CurrentSession;
  /** Stops playback, revokes the session and starts afresh; reports its own failure. */
  onSignOut: () => Promise<void>;
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.8 20c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Shows the username as text, so "am I signed in as the right person" is answered at a glance.
 * The anonymous account has an ordinary session, but is offered a way in rather than an account to manage.
 */
export function AccountMenu({ session, onSignOut }: Props) {
  const navigate = useNavigate();
  // The login link records the pathname, so signing in returns here.
  const location = useLocation();
  const who = session.username?.trim() || '';
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await onSignOut();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!isSignedIn(session)) {
    return (
      <Link className="account-menu account-login" to={routes.login} state={{ from: location.pathname }} data-tv-focusable="true">
        <span className="account-username">Log in</span>
        <span className="account-icon" aria-hidden="true"><UserIcon /></span>
      </Link>
    );
  }

  return (
    <div className="account-menu">
      {/* The identity is the trigger: one target, one D-pad stop. */}
      <OverflowMenu
        className="account-overflow"
        label={`Account options for ${who}`}
        trigger={
          <span className="account-identity" title={who}>
            <span className="account-username">{who}</span>
            <span className="account-icon" aria-hidden="true"><UserIcon /></span>
          </span>
        }
        actions={[
          { label: 'User details', onSelect: () => navigate(routes.account) },
          { label: 'Change password', onSelect: () => navigate(routes.accountPassword) },
          { label: 'Log out', destructive: true, onSelect: () => setConfirming(true) },
        ]}
      />
      <ConfirmModal
        open={confirming}
        title="Log out?"
        confirmLabel="Log out"
        destructive
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void signOut()}
      >
        {/* `logout()` revokes this one token; the account's other sessions keep working. */}
        <p>
          This signs <strong>{who}</strong> out on this device only — anywhere else stays signed in.
          Anything playing here will stop.
        </p>
      </ConfirmModal>
    </div>
  );
}
