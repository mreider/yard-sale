import { useId, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function ResetPage() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState<string>('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.resetPassword(token, password);
      setState('ok');
      setMsg('Password reset. Log in with your new password.');
    } catch (err) {
      setState('err');
      if (err instanceof ApiError) setMsg(`Reset failed: ${err.code}`);
      else setMsg(err instanceof Error ? err.message : 'Reset failed.');
    }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (user) return <Navigate to="/sales" replace />;

  if (!token)
    return (
      <div className="card">
        <div className="flash err">Missing reset token.</div>
      </div>
    );

  return (
    <div className="card">
      <h2>Set a new password</h2>
      {state !== 'idle' && <div className={`flash ${state}`}>{msg}</div>}
      {state !== 'ok' && (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor={passwordId}>New password</label>
            <input
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
          <div className="row">
            <button className="btn" type="submit">
              Set password
            </button>
            <Link to="/login">Back to log in</Link>
          </div>
        </form>
      )}
    </div>
  );
}
