import { useEffect, useId, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { type PublicInvite, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

/**
 * /admin — invite management for the beta.
 *
 * Single card, same pattern as /sales and /tokens. "+ New invite" in the
 * header reveals a compact form (note + expiry). List of invites below
 * with copy / revoke inline actions.
 */
export function AdminPage() {
  const { user, loading } = useAuth();
  const [invites, setInvites] = useState<PublicInvite[] | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    api
      .listInvites()
      .then((r) => setInvites(r.invites))
      .catch((e) =>
        setFlash({ kind: 'err', msg: e instanceof Error ? e.message : 'Load failed.' }),
      );
  }, [user]);

  if (loading) return <div className="card">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/" replace />;

  async function handleCreate(input: { note: string; expiresInDays: number }) {
    setFlash(null);
    try {
      const r = await api.createInvite({
        note: input.note || undefined,
        expiresInDays: input.expiresInDays,
      });
      setInvites((prev) => [r.invite, ...(prev ?? [])]);
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Create failed.' });
      throw err;
    }
  }

  async function revoke(inv: PublicInvite) {
    if (!confirm(`Revoke invite ${inv.code}? The link will stop working immediately.`)) return;
    try {
      await api.revokeInvite(inv.code);
      setInvites((prev) =>
        (prev ?? []).map((x) =>
          x.code === inv.code
            ? { ...x, status: 'revoked' as const, revokedAt: Math.floor(Date.now() / 1000) }
            : x,
        ),
      );
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Revoke failed.' });
    }
  }

  async function copyUrl(inv: PublicInvite) {
    await navigator.clipboard.writeText(inv.url);
    setCopied(inv.code);
    setTimeout(() => setCopied((c) => (c === inv.code ? null : c)), 1500);
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Invites</h2>
        <NewInviteButton onCreate={handleCreate} />
      </div>
      <p className="sub">
        yrdsl.app is invite-only during the beta. Each code is single-use; share the link with
        someone you trust.
      </p>

      {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}

      {!invites && <div className="sub">Loading…</div>}
      {invites && invites.length === 0 && (
        <div className="empty-state">
          <p className="empty-lead">No invites yet.</p>
          <p className="empty-sub">
            Click <b>+ New invite</b> above to mint one.
          </p>
        </div>
      )}
      {invites && invites.length > 0 && (
        <div className="row-list">
          {invites.map((inv) => (
            <div className="row-item" key={inv.code}>
              <div>
                <div className="row-name">
                  <code>{inv.code}</code> <span className="pill">{inv.status}</span>
                </div>
                <div className="row-meta">
                  {inv.note && <>{inv.note} · </>}created{' '}
                  {new Date(inv.createdAt * 1000).toLocaleDateString()}
                  {inv.status === 'pending' &&
                    ` · expires ${new Date(inv.expiresAt * 1000).toLocaleDateString()}`}
                  {inv.usedBy && ` · used by @${inv.usedBy.username} (${inv.usedBy.email})`}
                  {inv.revokedAt &&
                    ` · revoked ${new Date(inv.revokedAt * 1000).toLocaleDateString()}`}
                </div>
              </div>
              <div className="row-actions">
                {inv.status === 'pending' && (
                  <>
                    <button type="button" className="btn ghost tiny" onClick={() => copyUrl(inv)}>
                      {copied === inv.code ? '✓ Copied' : 'Copy link'}
                    </button>
                    <button type="button" className="btn danger tiny" onClick={() => revoke(inv)}>
                      Revoke
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewInviteButton({
  onCreate,
}: {
  onCreate: (input: { note: string; expiresInDays: number }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const expiryId = useId();
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) noteRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + New invite
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget as HTMLFormElement;
        const fd = new FormData(form);
        setBusy(true);
        try {
          await onCreate({
            note: String(fd.get('note') ?? '').trim(),
            expiresInDays: Number(fd.get('expiresInDays') ?? 30),
          });
          form.reset();
          setOpen(false);
        } catch {
          // parent surfaces flash
        } finally {
          setBusy(false);
        }
      }}
      style={{ flex: 1, maxWidth: 560, display: 'flex', gap: 8, alignItems: 'center' }}
    >
      <label htmlFor={noteId} className="visually-hidden">
        Note
      </label>
      <input
        ref={noteRef}
        id={noteId}
        name="note"
        placeholder="Note (who's this for?)"
        maxLength={200}
        style={{
          flex: 1,
          padding: '8px 12px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          font: 'inherit',
          background: 'var(--surface)',
        }}
      />
      <label htmlFor={expiryId} className="visually-hidden">
        Expires in
      </label>
      <select
        id={expiryId}
        name="expiresInDays"
        defaultValue="30"
        style={{
          padding: '8px 12px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          font: 'inherit',
          background: 'var(--surface)',
        }}
      >
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365">1 year</option>
      </select>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
