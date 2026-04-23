import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';

/**
 * / (root of app.yrdsl.app).
 *
 * Logged-in users have no business on a generic "welcome" page — they
 * want their sales. Redirect straight to /sales.
 *
 * Logged-out users land on /login, where the page's own footer offers
 * signup. That's one less click than forcing them through a home page.
 * The marketing story lives at yrdsl.app (the apex, served by
 * packages/landing, not this SPA).
 */
export function HomePage() {
  const { user, loading } = useAuth();
  if (loading) return <div className="card">Loading…</div>;
  return <Navigate to={user ? '/sales' : '/login'} replace />;
}
