import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { type PublicToken, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

/**
 * /tokens — API tokens list + inline create.
 *
 * Single card, same create+list pattern as /sales: "+ New token" button
 * in the header expands a compact form. Newly-minted secret shows once
 * in a dedicated reveal block. Existing tokens list below.
 */
export function TokensPage() {
  const { user, loading } = useAuth();
  const [tokens, setTokens] = useState<PublicToken[] | null>(null);
  const [justCreated, setJustCreated] = useState<{ token: PublicToken; secret: string } | null>(
    null,
  );
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.listTokens().then((r) => setTokens(r.tokens));
  }, [user]);

  if (loading) return <div className="card">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  const confirmed = user.emailConfirmed;

  async function revoke(t: PublicToken) {
    if (!confirm(`Revoke "${t.name}"? Any Claude connectors using it will stop working.`)) return;
    await api.deleteToken(t.id);
    setTokens((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    if (justCreated?.token.id === t.id) setJustCreated(null);
  }

  async function handleCreate(input: {
    name: string;
    scope: 'read' | 'write' | 'admin';
    expiry: 'none' | '30d' | '90d' | '1y';
  }) {
    setFlash(null);
    try {
      const r = await api.createToken(input);
      setJustCreated(r);
      setTokens((prev) => [r.token, ...(prev ?? [])]);
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed.' });
      throw err;
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>API tokens</h2>
        {confirmed && <NewTokenButton onCreate={handleCreate} />}
      </div>
      <p className="sub">
        Tokens let Claude act on your account. Each secret shows <b>once</b>, right after creation —
        copy it immediately.
      </p>

      {!confirmed && (
        <div className="flash err">
          Confirm your email first. Token creation is blocked until then.
        </div>
      )}
      {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}

      {justCreated && (
        <div className="flash ok">
          <div style={{ marginBottom: 8 }}>
            New token <b>{justCreated.token.name}</b>:
          </div>
          <div className="code-block-wrap">
            <div className="secret-shown">{justCreated.secret}</div>
            <button
              type="button"
              className="btn ghost tiny code-block-copy"
              onClick={async () => {
                await navigator.clipboard.writeText(justCreated.secret);
                setSecretCopied(true);
                setTimeout(() => setSecretCopied(false), 1800);
              }}
            >
              {secretCopied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="secret-footnote">
            Not shown again. See <Link to="/connect">Connect Claude</Link> for the install guide.
          </div>
        </div>
      )}

      {!tokens && <div className="sub">Loading…</div>}
      {tokens && tokens.length === 0 && (
        <div className="empty-state">
          <p className="empty-lead">No tokens yet.</p>
          <p className="empty-sub">
            Create one to let Claude Desktop or Claude Code act on your account.
          </p>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <div className="row-list">
          {tokens.map((t) => (
            <div className="row-item" key={t.id}>
              <div>
                <div className="row-name">{t.name}</div>
                <div className="row-meta">
                  <span className="pill">{t.scope}</span>
                  <span className="pill">{t.prefix}…</span> created{' '}
                  {new Date(t.createdAt * 1000).toLocaleDateString()}
                  {t.lastUsedAt
                    ? ` · last used ${new Date(t.lastUsedAt * 1000).toLocaleString()}`
                    : ' · never used'}
                  {t.expiresAt
                    ? ` · expires ${new Date(t.expiresAt * 1000).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="btn danger tiny" onClick={() => revoke(t)}>
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTokenButton({
  onCreate,
}: {
  onCreate: (input: {
    name: string;
    scope: 'read' | 'write' | 'admin';
    expiry: 'none' | '30d' | '90d' | '1y';
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const scopeId = useId();
  const expiryId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + New token
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget as HTMLFormElement;
        const fd = new FormData(form);
        const name = String(fd.get('name') ?? '').trim();
        if (!name) return;
        setBusy(true);
        try {
          await onCreate({
            name,
            scope: String(fd.get('scope') ?? 'write') as 'read' | 'write' | 'admin',
            expiry: String(fd.get('expiry') ?? 'none') as 'none' | '30d' | '90d' | '1y',
          });
          form.reset();
          setOpen(false);
        } catch {
          // flash shown by parent
        } finally {
          setBusy(false);
        }
      }}
      style={{ flex: 1, maxWidth: 640, display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label htmlFor={nameId} className="visually-hidden">
          Name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          name="name"
          placeholder="Name (e.g. iPhone Claude)"
          required
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            font: 'inherit',
            background: 'var(--surface)',
          }}
        />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
        <label htmlFor={scopeId} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Scope
          <select id={scopeId} name="scope" defaultValue="write" style={selectStyle}>
            <option value="read">read (view only)</option>
            <option value="write">write (recommended)</option>
            <option value="admin">admin (includes delete)</option>
          </select>
        </label>
        <label htmlFor={expiryId} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Expires
          <select id={expiryId} name="expiry" defaultValue="none" style={selectStyle}>
            <option value="none">Never</option>
            <option value="30d">30 days</option>
            <option value="90d">90 days</option>
            <option value="1y">1 year</option>
          </select>
        </label>
      </div>
    </form>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  font: 'inherit',
  background: 'var(--surface)',
};
