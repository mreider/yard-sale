import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

export function ConfirmPage() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'pending' | 'ok' | 'err'>(token ? 'pending' : 'err');
  const [msg, setMsg] = useState<string>(token ? 'Confirming…' : 'Missing token.');

  // Defensive: only re-run when the token changes, not when `refresh`'s
  // reference changes. AuthProvider now memoizes refresh, but a single
  // unstable dep here would still cause a double POST and the second
  // call would see token_used. One-shot per token is the contract.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        await api.confirm(token);
        await refresh();
        setStatus('ok');
        setMsg('Email confirmed. You can now publish sales and create API tokens.');
      } catch (err) {
        setStatus('err');
        if (err instanceof ApiError) {
          if (err.code === 'token_expired') setMsg('That link has expired.');
          else if (err.code === 'token_used') setMsg('That link was already used.');
          else setMsg('That link is not valid.');
        } else {
          setMsg(err instanceof Error ? err.message : 'Confirmation failed.');
        }
      }
    })();
  }, [token]);

  return (
    <div className="card">
      <h2>Email confirmation</h2>
      <div className={`flash ${status === 'ok' ? 'ok' : status === 'err' ? 'err' : ''}`}>{msg}</div>
      <div className="row">
        <Link to="/sales" className="btn">
          Go to your sales
        </Link>
      </div>
    </div>
  );
}
