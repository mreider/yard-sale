import { useId, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function LoginPage() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login({ email, password });
      await refresh();
      nav('/sales');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setError('That email and password combination did not match.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (user) return <Navigate to="/sales" replace />;

  return (
    <div className="card">
      <h2>Log in</h2>
      <p className="sub">Welcome back.</p>
      {error && <div className="flash err">{error}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="row">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
          <Link to="/signup">Sign up</Link>
          <Link to="/forgot">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}
