import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { GettingStarted } from '../components/GettingStarted.js';
import { ApiError, type ApiSale, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

/**
 * /sales — the user's sales dashboard.
 *
 * One card does two jobs, unambiguously:
 *   - Empty state: a focused "start your first sale" CTA with the
 *     compact create form inline.
 *   - Populated state: the sales list, with a "+ New sale" button
 *     sitting in the card header that reveals the same compact form.
 *
 * No separate "Existing sales" section. No form dangling above the list.
 */
export function SalesPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [sales, setSales] = useState<ApiSale[] | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .listSales()
      .then((r) => setSales(r.sales))
      .catch((e) =>
        setFlash({ kind: 'err', msg: e instanceof Error ? e.message : 'Load failed.' }),
      );
  }, [user]);

  if (loading) return <div className="card">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  async function deleteSale(id: string, title: string) {
    if (!confirm(`Delete "${title}"? Reverts to a draft state; published URL stops working.`)) {
      return;
    }
    try {
      await api.deleteSale(id);
      setSales((prev) => (prev ?? []).filter((s) => s.id !== id));
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Delete failed.' });
    }
  }

  async function handleCreate(title: string): Promise<void> {
    setFlash(null);
    try {
      const r = await api.createSale({ title });
      nav(`/sales/${r.sale.id}`);
    } catch (err) {
      setFlash({
        kind: 'err',
        msg: err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'Failed.',
      });
      throw err;
    }
  }

  // Show the loading card before `sales` arrives to avoid layout flash.
  if (!sales) return <div className="card">Loading…</div>;

  const empty = sales.length === 0;

  return (
    <>
      <GettingStarted user={user} sales={sales} />

      <div className="card">
        <div className="card-header">
          <h2>Your sales</h2>
          {!empty && <NewSaleButton onCreate={handleCreate} />}
        </div>
        {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}

        {empty ? (
          <EmptyState username={user.username} onCreate={handleCreate} />
        ) : (
          <SalesList
            sales={sales}
            username={user.username}
            onDelete={(s) => deleteSale(s.id, s.siteName)}
          />
        )}
      </div>
    </>
  );
}

function SalesList({
  sales,
  username,
  onDelete,
}: {
  sales: ApiSale[];
  username: string;
  onDelete: (sale: ApiSale) => void;
}) {
  return (
    <div className="row-list">
      {sales.map((s) => {
        const status = s.publishedAt ? 'published' : 'draft';
        return (
          <div className="row-item" key={s.id}>
            <div>
              <div className="row-name">
                <Link to={`/sales/${s.id}`}>{s.siteName}</Link>{' '}
                <span className="pill">{status}</span>
              </div>
              <div className="row-meta">
                {s.publishedAt ? (
                  <a
                    href={`https://yrdsl.app/${username}/${s.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    yrdsl.app/{username}/{s.slug}
                  </a>
                ) : (
                  <>not yet published</>
                )}{' '}
                · {s.theme} · {s.currency} · created {new Date(s.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="row-actions">
              <Link to={`/sales/${s.id}`} className="btn ghost tiny">
                Edit
              </Link>
              <button type="button" className="btn danger tiny" onClick={() => onDelete(s)}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({
  username,
  onCreate,
}: {
  username: string;
  onCreate: (title: string) => Promise<void>;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Focus the input on mount — empty-state pages exist to get the user
  // straight into one action.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="empty-state">
      <p className="empty-lead">
        One title to start. You can pick a theme, add items, and publish on the next screen.
      </p>
      <p className="empty-sub">
        Your sale will live at <code>yrdsl.app/{username}/…</code> when you publish.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const title = String(fd.get('title') ?? '').trim();
          if (!title) return;
          setBusy(true);
          try {
            await onCreate(title);
          } finally {
            setBusy(false);
          }
        }}
        className="empty-form"
      >
        <label htmlFor={titleId} className="visually-hidden">
          Sale title
        </label>
        <input
          id={titleId}
          ref={inputRef}
          name="title"
          placeholder="e.g. Spring purge, Moving sale…"
          required
          maxLength={100}
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create sale'}
        </button>
      </form>
    </div>
  );
}

/** Inline "+ New sale" toggle on the card header. Expands to a compact
 * single-field form. Matches SaleEdit's AddItemForm pattern. */
function NewSaleButton({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + New sale
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const title = String(fd.get('title') ?? '').trim();
        if (!title) return;
        setBusy(true);
        try {
          await onCreate(title);
          setOpen(false);
        } finally {
          setBusy(false);
        }
      }}
      className="inline-form"
    >
      <label htmlFor={titleId} className="visually-hidden">
        Sale title
      </label>
      <input
        id={titleId}
        ref={inputRef}
        name="title"
        placeholder="Sale title"
        required
        maxLength={100}
        autoComplete="off"
      />
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
