import { useId, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function ForgotPage() {
  const { user, loading } = useAuth();
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.forgotPassword(email);
    setSent(true);
  }

  if (loading) return <div className="card">Loading…</div>;
  if (user) return <Navigate to="/sales" replace />;

  return (
    <div className="card">
      <h2>Reset your password</h2>
      <p className="sub">Enter your email and we'll send a reset link.</p>
      {sent ? (
        <div className="flash ok">
          If that email is on file, a reset link is on its way. Check your inbox.
        </div>
      ) : (
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
          <div className="row">
            <button className="btn" type="submit">
              Send reset link
            </button>
            <Link to="/login">Back to log in</Link>
          </div>
        </form>
      )}
    </div>
  );
}
