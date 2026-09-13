import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage, isSignedIn, routes, type CurrentSession, type UsersApi } from '@machafoundation/core';
import { OverflowMenu } from './OverflowMenu';
import { ConfirmModal } from './Modal';

interface Props {
  api: UsersApi;
  session: CurrentSession;
  /** Called once the session is gone, so the app can re-derive who it is talking to. */
  onSignedOut: () => void;
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
 * Who the viewer is, and the few things they can do about it.
 *
 * Deliberately quiet and beside the platform badge: on every screen but this
 * menu, identity is not what the viewer came for. It carries the username as
 * text rather than only an icon, because "am I signed in as the right person"
 * is the one question this control exists to answer at a glance, and an
 * avatar alone does not answer it.
 *
 * The anonymous account is the one presentational exception, and only here.
 * Every session belongs to a user and empty credentials authenticate that
 * one, so its session is ordinary in every mechanical sense — it carries
 * roles, it validates, it can be revoked. What it does not represent is
 * somebody who chose to be someone, so this offers a way in rather than an
 * account to manage. That is a statement about the viewer's intent, not a
 * capability check, and it is the only place in this client that names an
 * account at all.
 */
export function AccountMenu({ api, session, onSignedOut }: Props) {
  const navigate = useNavigate();
  const who = session.username?.trim() || '';
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const signOut = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.logout();
      setConfirming(false);
      onSignedOut();
      navigate(routes.home, { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  // Nobody has chosen to be anyone yet, so there is no account to manage and
  // nothing to sign out of that the viewer would recognise as theirs. One
  // control, saying the only thing they can usefully do.
  if (!isSignedIn(session)) {
    return (
      <Link className="account-menu account-login" to={routes.login} data-tv-focusable="true">
        <span className="account-username">Log in</span>
        <span className="account-icon" aria-hidden="true"><UserIcon /></span>
      </Link>
    );
  }

  return (
    <div className="account-menu">
      <span className="account-identity" title={who}>
        <span className="account-username">{who}</span>
        <span className="account-icon" aria-hidden="true"><UserIcon /></span>
      </span>
      <OverflowMenu
        className="account-overflow"
        label={`Account options for ${who}`}
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
        onCancel={() => { setConfirming(false); setError(undefined); }}
        onConfirm={() => void signOut()}
      >
        <p>
          This ends the session for <strong>{who}</strong> everywhere, not just on this device.
          Anything playing will stop.
        </p>
        {error && <p className="manage-error" role="alert">{error}</p>}
      </ConfirmModal>
    </div>
  );
}
