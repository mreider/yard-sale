import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { type PublicUser, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function Layout() {
  const { user, loading, setUser } = useAuth();
  const nav = useNavigate();

  async function logout() {
    await api.logout();
    setUser(null);
    nav('/');
  }

  async function resend() {
    const res = await api.resendConfirmation();
    if (res.devConfirmUrl) {
      alert(`Dev stub. Confirm URL:\n${res.devConfirmUrl}`);
    } else {
      alert('Confirmation email re-sent.');
    }
  }

  return (
    <div className="layout">
      <a className="skip-to-main" href="#main">
        Skip to main content
      </a>
      <header className="topnav">
        <Link to="/" className="brand">
          yrdsl.app
        </Link>
        <nav>
          {user ? (
            <>
              <NavLink to="/sales">Sales</NavLink>
              <NavLink to="/connect">Connect Claude</NavLink>
              {user.isAdmin && <NavLink to="/admin">Admin</NavLink>}
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <NavLink to="/signup">Sign up</NavLink>
            </>
          )}
        </nav>
        <div className="who">
          {user ? (
            <AccountMenu user={user} onLogout={logout} />
          ) : loading ? (
            '…'
          ) : (
            <Link to="/login">Log in</Link>
          )}
        </div>
      </header>
      {user && !user.emailConfirmed && (
        <div className="banner">
          <span>Confirm {user.email} before publishing a sale or creating API tokens.</span>
          <button type="button" onClick={resend}>
            Resend confirmation
          </button>
        </div>
      )}
      <main id="main">
        <Outlet />
      </main>
    </div>
  );
}

function AccountMenu({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (user.username?.[0] ?? user.email[0] ?? '?').toUpperCase();

  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}
        </span>
        <span className="account-chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-who">
            <div className="account-menu-username">@{user.username}</div>
            <div className="account-menu-email">{user.email}</div>
          </div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}>
            Account
          </Link>
          <Link role="menuitem" to="/tokens" onClick={() => setOpen(false)}>
            API tokens
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
