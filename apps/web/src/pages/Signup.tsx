import { checkPassword, checkUsername, isValidEmail } from '@yrdsl/core';
import { useCallback, useId, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { TurnstileWidget } from '../components/Turnstile.js';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function SignupPage() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState(params.get('invite') ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const onToken = useCallback((t: string) => setTurnstileToken(t), []);
  const emailId = useId();
  const usernameId = useId();
  const passwordId = useId();
  const inviteId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!isValidEmail(email)) errs.email = 'Please enter a valid email.';
    const pw = await checkPassword({ password, email });
    if (!pw.ok) errs.password = `Too weak: ${pw.issues.join(', ')}`;
    if (username) {
      const u = checkUsername(username);
      if (u) errs.username = `Username ${u}`;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setFlash(null);
    try {
      const res = await api.signup({
        email,
        password,
        username: username || undefined,
        inviteCode: inviteCode.trim() || undefined,
        turnstileToken: turnstileToken || undefined,
      });
      await refresh();
      if (res.devConfirmUrl) {
        setFlash({
          kind: 'ok',
          msg: `Dev mailer stubbed. Click to confirm: ${res.devConfirmUrl}`,
        });
      } else {
        nav('/sales');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken') {
        setErrors({ email: 'That email is already registered.' });
      } else if (err instanceof ApiError && err.code === 'weak_password') {
        setErrors({ password: 'Password does not meet requirements.' });
      } else if (err instanceof ApiError && err.code === 'password_compromised') {
        setErrors({
          password: 'This password appears in a known data breach. Please pick something unique.',
        });
      } else if (err instanceof ApiError && err.code === 'turnstile_failed') {
        setFlash({
          kind: 'err',
          msg: 'Could not verify the captcha. Refresh the page and try again.',
        });
      } else if (err instanceof ApiError && err.code.startsWith('invite_')) {
        const msgMap: Record<string, string> = {
          invite_required:
            'This is an invite-only beta. Enter a code or ask the person who told you about yrdsl.app to send one.',
          invite_not_found: 'That invite code is not recognized.',
          invite_already_used:
            'That invite has already been claimed. Ask your inviter for a fresh one.',
          invite_expired: 'That invite has expired. Ask your inviter for a fresh one.',
          invite_revoked: 'That invite was revoked.',
        };
        setErrors({ inviteCode: msgMap[err.code] ?? err.code });
      } else {
        setFlash({
          kind: 'err',
          msg: err instanceof Error ? err.message : 'Signup failed',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (user) return <Navigate to="/sales" replace />;

  return (
    <div className="card">
      <h2>Create your account</h2>
      <p className="sub">Free to start. No card. No monthly minimum.</p>
      {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
      <form onSubmit={submit} noValidate>
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
          <div className="err">{errors.email}</div>
        </div>
        <div className="field">
          <label htmlFor={usernameId}>
            Username <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id={usernameId}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="Auto-generated from email if blank (appears in your sale URL)"
          />
          <div className="err">{errors.username}</div>
        </div>
        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
          <div className="err">{errors.password}</div>
          <small style={{ color: 'var(--muted)' }}>
            At least 10 characters. Known-breached passwords rejected.
          </small>
        </div>
        <div className="field">
          <label htmlFor={inviteId}>
            Invite code{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
              (required during open beta)
            </span>
          </label>
          <input
            id={inviteId}
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="e.g. HX9KQ3P2ABCD"
            autoComplete="off"
          />
          <div className="err">{errors.inviteCode}</div>
        </div>
        <TurnstileWidget onToken={onToken} />
        <div className="row">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <Link to="/login">Log in</Link>
        </div>
      </form>
    </div>
  );
}
