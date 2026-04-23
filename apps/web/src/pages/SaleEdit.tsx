import { useEffect, useId, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { PhoneInput } from '../components/PhoneInput.js';
import { ApiError, type ApiItem, type ApiSale, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { resizeForUpload } from '../lib/image.js';

export function SaleEditPage() {
  const { user, loading: authLoading } = useAuth();
  const { id: saleId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [sale, setSale] = useState<ApiSale | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!user || !saleId) return;
    api
      .getSale(saleId)
      .then((r) => {
        setSale(r.sale);
        setItems(r.items);
      })
      .catch((e) => setFlash({ kind: 'err', msg: e instanceof Error ? e.message : 'Load failed.' }))
      .finally(() => setLoading(false));
  }, [user, saleId]);

  if (authLoading || loading) return <div className="card">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!saleId) return <Navigate to="/sales" replace />;
  // Narrow for closures below; TS doesn't propagate the !saleId guard inside async fns.
  const id: string = saleId;
  if (!sale) {
    return (
      <div className="card">
        <h2>Sale not found</h2>
        <p className="sub">
          Maybe deleted? <Link to="/sales">Back to your sales.</Link>
        </p>
      </div>
    );
  }

  const status = sale.publishedAt ? 'published' : 'draft';
  // Prefer the API-provided URL (which points at the viewer origin, not
  // the SPA origin). Fall back to a constructed URL while a draft sale
  // has no publicUrl set yet.
  const publicUrl = sale.publicUrl ?? `https://yrdsl.app/${user.username}/${sale.slug}`;

  async function patch(updates: Partial<ApiSale>) {
    setFlash(null);
    try {
      const r = await api.updateSale(id, updates);
      setSale(r.sale);
      setFlash({ kind: 'ok', msg: 'Saved.' });
    } catch (err) {
      setFlash({
        kind: 'err',
        msg: err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'Failed.',
      });
    }
  }

  async function publish() {
    if (!sale) return;
    if (!sale.contact?.email && !sale.contact?.sms && !sale.contact?.whatsapp) {
      setFlash({ kind: 'err', msg: 'Add at least one contact method (email, SMS, or WhatsApp).' });
      return;
    }
    try {
      const r = await api.publishSale(id);
      setSale((p) => (p ? { ...p, publishedAt: r.publishedAt } : p));
      setFlash({ kind: 'ok', msg: `Published. Live at ${publicUrl}` });
    } catch (err) {
      setFlash({
        kind: 'err',
        msg: err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'Failed.',
      });
    }
  }

  async function unpublish() {
    if (!confirm('Unpublish this sale? The public URL will return 404.')) return;
    await api.unpublishSale(id);
    setSale((p) => (p ? { ...p, publishedAt: undefined } : p));
    setFlash({ kind: 'ok', msg: 'Unpublished.' });
  }

  async function deleteSale() {
    if (!confirm(`Delete "${sale?.siteName}"? This cannot be undone.`)) return;
    await api.deleteSale(id);
    nav('/sales');
  }

  async function exportZip() {
    setFlash(null);
    try {
      const blob = await api.exportSale(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sale?.slug ?? 'sale'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFlash({ kind: 'ok', msg: 'Export downloaded.' });
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Export failed.' });
    }
  }

  async function reload() {
    const r = await api.getSale(id);
    setSale(r.sale);
    setItems(r.items);
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>{sale.siteName}</h2>
          <span className="pill">{status}</span>
        </div>
        <p className="sub">
          {sale.publishedAt ? (
            <>
              Live at{' '}
              <a href={publicUrl} target="_blank" rel="noreferrer">
                {publicUrl}
              </a>
            </>
          ) : (
            <>Draft. Publish to make it live.</>
          )}
        </p>
        {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {sale.publishedAt ? (
            <button type="button" className="btn ghost" onClick={unpublish}>
              Unpublish
            </button>
          ) : (
            <button type="button" className="btn" onClick={publish}>
              Publish
            </button>
          )}
          <a
            className="btn ghost"
            href={`/sales/${id}/preview`}
            target="_blank"
            rel="noreferrer"
            title="See your draft as buyers will see the public sale"
          >
            Preview
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={exportZip}
            title="Download a ZIP that drops into the yrdsl-self-hosted template"
          >
            Export as ZIP
          </button>
          <button type="button" className="btn danger" onClick={deleteSale}>
            Delete sale
          </button>
        </div>
      </div>

      <SaleMetadataForm sale={sale} username={user.username} onSave={patch} />
      <SaleContactForm sale={sale} onSave={patch} />
      <ItemsSection saleId={id} items={items} onChange={reload} />
    </>
  );
}

function SaleMetadataForm({
  sale,
  username,
  onSave,
}: {
  sale: ApiSale;
  username: string;
  onSave: (patch: Partial<ApiSale>) => Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const slugId = useId();
  const themeId = useId();
  const currencyId = useId();
  const [title, setTitle] = useState(sale.siteName);
  const [description, setDescription] = useState(sale.description ?? '');
  const [theme, setTheme] = useState<ApiSale['theme']>(sale.theme);
  const [slug, setSlug] = useState(sale.slug);
  const [currency, setCurrency] = useState(sale.currency);

  return (
    <div className="card">
      <h2>Sale details</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            siteName: title,
            description: description || undefined,
            theme,
            slug,
            currency,
          });
        }}
      >
        <div className="field">
          <label htmlFor={titleId}>Title</label>
          <input
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
          />
        </div>
        <div className="field">
          <label htmlFor={descriptionId}>Description</label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="A sentence or two about what's going on."
          />
        </div>
        <div className="field">
          <label htmlFor={slugId}>Web address</label>
          <input
            id={slugId}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            pattern="[a-z0-9][a-z0-9-]*"
            maxLength={64}
            required
          />
          <small style={{ color: 'var(--muted)' }}>
            Your sale lives at{' '}
            <code>
              yrdsl.app/{username}/{slug}
            </code>
            . Renaming changes the URL; old links stop working immediately.
          </small>
        </div>
        <div className="field">
          <label htmlFor={themeId}>Theme</label>
          <select
            id={themeId}
            value={theme}
            onChange={(e) => setTheme(e.target.value as ApiSale['theme'])}
          >
            <option value="conservative">Clean</option>
            <option value="artsy">Magazine</option>
            <option value="hip">Bold</option>
            <option value="retro">Retro</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={currencyId}>Currency</label>
          <input
            id={currencyId}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            required
            placeholder="USD"
          />
          <small style={{ color: 'var(--muted)' }}>
            3-letter code (USD, EUR, GBP, CHF…). Shown on every item's price.
          </small>
        </div>
        <div className="row">
          <button type="submit" className="btn">
            Save details
          </button>
        </div>
      </form>
    </div>
  );
}

function SaleContactForm({
  sale,
  onSave,
}: {
  sale: ApiSale;
  onSave: (patch: Partial<ApiSale>) => Promise<void>;
}) {
  const emailId = useId();
  const smsId = useId();
  const whatsappId = useId();
  const notesId = useId();
  const [email, setEmail] = useState(sale.contact?.email ?? '');
  const [sms, setSms] = useState(sale.contact?.sms ?? '');
  const [whatsapp, setWhatsapp] = useState(sale.contact?.whatsapp ?? '');
  const [notes, setNotes] = useState(sale.contact?.notes ?? '');

  return (
    <div className="card">
      <h2>Contact methods</h2>
      <p className="sub">Buyers contact you via these. One required to publish.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            contact: {
              email: email || undefined,
              sms: sms || undefined,
              whatsapp: whatsapp || undefined,
              notes: notes || undefined,
            },
          });
        }}
      >
        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seller@example.com"
          />
        </div>
        <div className="field">
          <label htmlFor={smsId}>SMS</label>
          <PhoneInput id={smsId} value={sms} onChange={setSms} />
        </div>
        <div className="field">
          <label htmlFor={whatsappId}>WhatsApp</label>
          <PhoneInput id={whatsappId} value={whatsapp} onChange={setWhatsapp} />
        </div>
        <div className="field">
          <label htmlFor={notesId}>Notes</label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="How to pay, pickup hours, etc."
          />
        </div>
        <div className="row">
          <button type="submit" className="btn">
            Save contact
          </button>
        </div>
      </form>
    </div>
  );
}

function ItemsSection({
  saleId,
  items,
  onChange,
}: {
  saleId: string;
  items: ApiItem[];
  onChange: () => Promise<void>;
}) {
  const titleId = useId();
  const priceId = useId();
  const tagsId = useId();
  const descriptionId = useId();
  const photoId = useId();
  const imageUrlId = useId();
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Tracks an in-flight batch upload so the form can show "Uploading N of M"
  // instead of a dead UI while dozens of photos resize + upload sequentially.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const title = String(fd.get('title') ?? '').trim();
    const priceStr = String(fd.get('price') ?? '').trim();
    const tagsRaw = String(fd.get('tags') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim();
    const imageUrl = String(fd.get('imageUrl') ?? '').trim();
    const photoFiles = fd.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
    const price = Number(priceStr);
    if (!title || !Number.isFinite(price)) return;
    setFlash(null);
    try {
      const created = await api.addItem(saleId, {
        title,
        price,
        tags: tagsRaw
          ? tagsRaw
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        description: description || undefined,
        image: imageUrl || undefined,
      });
      // Upload files sequentially. The /images endpoint accepts one image
      // per request and appends to item.images, so the DB state builds up
      // in the order files were picked.
      if (photoFiles.length > 0) {
        setUploadProgress({ done: 0, total: photoFiles.length });
        for (let i = 0; i < photoFiles.length; i++) {
          const { blob, mime } = await resizeForUpload(photoFiles[i] as File);
          await api.uploadItemImage(saleId, created.item.id, blob, mime);
          setUploadProgress({ done: i + 1, total: photoFiles.length });
        }
        setUploadProgress(null);
      }
      form.reset();
      await onChange();
    } catch (err) {
      setUploadProgress(null);
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed.' });
    }
  }

  async function reserve(item: ApiItem) {
    const priceStr = prompt(
      `Mark "${item.title}" reserved at what price? (default: listed $${item.price})`,
      String(item.price),
    );
    if (priceStr === null) return;
    const price = Number(priceStr);
    if (!Number.isFinite(price)) return;
    await api.updateItem(saleId, item.id, {
      reserved: { on: new Date().toISOString().slice(0, 10), price },
    });
    await onChange();
  }

  async function unreserve(item: ApiItem) {
    await api.updateItem(saleId, item.id, { reserved: null });
    await onChange();
  }

  async function deleteItem(item: ApiItem) {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await api.deleteItem(saleId, item.id);
    await onChange();
  }

  async function move(item: ApiItem, direction: -1 | 1) {
    const idx = items.findIndex((i) => i.id === item.id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[idx], ids[target]] = [ids[target]!, ids[idx]!];
    try {
      await api.reorderItems(saleId, ids);
      await onChange();
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Reorder failed.' });
    }
  }

  async function addPhotosToExisting(item: ApiItem, files: File[]) {
    setFlash(null);
    try {
      setUploadProgress({ done: 0, total: files.length });
      for (let i = 0; i < files.length; i++) {
        const { blob, mime } = await resizeForUpload(files[i] as File);
        await api.uploadItemImage(saleId, item.id, blob, mime);
        setUploadProgress({ done: i + 1, total: files.length });
      }
      setUploadProgress(null);
      await onChange();
    } catch (err) {
      setUploadProgress(null);
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Upload failed.' });
    }
  }

  async function deletePhoto(item: ApiItem, url: string) {
    if (!confirm('Delete this photo?')) return;
    await api.deleteItemImage(saleId, item.id, url);
    await onChange();
  }

  /**
   * Promote a photo to cover (position 0). Reorders by PATCHing the full
   * `images` array; the server accepts that as-is. item.image (legacy
   * single field) is cleared to keep the canonical array in charge.
   */
  async function makeCover(item: ApiItem, url: string) {
    const current = item.images ?? (item.image ? [item.image] : []);
    if (current[0] === url) return;
    const reordered = [url, ...current.filter((u) => u !== url)];
    try {
      await api.updateItem(saleId, item.id, { images: reordered });
      await onChange();
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Reorder failed.' });
    }
  }

  return (
    <>
      <div className="card">
        <h2>Items ({items.length})</h2>
        {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
        {uploadProgress && (
          <div className="flash ok" aria-live="polite">
            Uploading photo{' '}
            {uploadProgress.done + (uploadProgress.done < uploadProgress.total ? 1 : 0)} of{' '}
            {uploadProgress.total}…
          </div>
        )}
        {items.length === 0 && (
          <p className="sub" style={{ marginTop: 0, marginBottom: 12 }}>
            No items yet. Add one below, or{' '}
            <Link to="/connect">
              let Claude generate listings (title, price, description) from your photos
            </Link>
            {'.'}
          </p>
        )}
        <AddItemForm
          titleId={titleId}
          priceId={priceId}
          tagsId={tagsId}
          descriptionId={descriptionId}
          photoId={photoId}
          imageUrlId={imageUrlId}
          onSubmit={add}
        />
        {items.length > 0 && (
          <div className="row-list">
            {items.map((item, idx) => {
              const imgs = item.images ?? (item.image ? [item.image] : []);
              const isFirst = idx === 0;
              const isLast = idx === items.length - 1;
              return (
                <div className="row-item-stack" key={item.id}>
                  <div className="row-header">
                    <div>
                      <div className="row-name">
                        {item.title} {item.reserved && <span className="pill">reserved</span>}
                      </div>
                      <div className="row-meta">
                        ${item.price}
                        {item.reserved && ` → $${item.reserved.price}`} · added {item.added}
                        {item.tags.length > 0 && ` · ${item.tags.join(', ')}`}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn ghost tiny"
                        onClick={() => move(item, -1)}
                        disabled={isFirst}
                        aria-label={`Move "${item.title}" up`}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn ghost tiny"
                        onClick={() => move(item, 1)}
                        disabled={isLast}
                        aria-label={`Move "${item.title}" down`}
                        title="Move down"
                      >
                        ↓
                      </button>
                      {item.reserved ? (
                        <button
                          type="button"
                          className="btn ghost tiny"
                          onClick={() => unreserve(item)}
                        >
                          Unreserve
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost tiny"
                          onClick={() => reserve(item)}
                        >
                          Reserve
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn danger tiny"
                        onClick={() => deleteItem(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="photo-grid">
                    {imgs.map((url, imgIdx) => (
                      <div key={url} className={`photo-cell${imgIdx === 0 ? ' cover' : ''}`}>
                        <img src={url} alt="" loading="lazy" />
                        {imgIdx === 0 && <span className="photo-badge">Cover</span>}
                        <div className="photo-actions">
                          {imgIdx !== 0 && (
                            <button
                              type="button"
                              onClick={() => makeCover(item, url)}
                              title="Make this the cover photo"
                              aria-label="Make cover"
                            >
                              ★
                            </button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deletePhoto(item, url)}
                            title="Delete this photo"
                            aria-label="Delete photo"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                    <label className="photo-add" title="Add photos">
                      <span className="photo-add-plus">+</span>
                      <span className="photo-add-label">
                        {imgs.length === 0 ? 'Add photos' : 'Add more'}
                      </span>
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/jpeg,image/webp,image/heic"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          if (files.length > 0) addPhotosToExisting(item, files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function AddItemForm(props: {
  titleId: string;
  priceId: string;
  tagsId: string;
  descriptionId: string;
  photoId: string;
  imageUrlId: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fileCount, setFileCount] = useState(0);

  if (!open) {
    return (
      <div className="row" style={{ margin: '8px 0' }}>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          + Add item
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        await props.onSubmit(e);
        setOpen(false);
      }}
      style={{
        marginTop: 12,
        padding: 16,
        border: '1px solid var(--line)',
        borderRadius: 8,
      }}
    >
      <div className="field">
        <label htmlFor={props.titleId}>Title</label>
        <input id={props.titleId} name="title" required maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor={props.priceId}>Price</label>
        <input id={props.priceId} name="price" type="number" step="0.01" min="0" required />
      </div>
      <div className="field">
        <label htmlFor={props.tagsId}>Tags (comma-separated)</label>
        <input id={props.tagsId} name="tags" placeholder="furniture, vintage" />
      </div>
      <div className="field">
        <label htmlFor={props.descriptionId}>Description</label>
        <textarea id={props.descriptionId} name="description" rows={3} maxLength={4000} />
      </div>
      <div className="field">
        <label htmlFor={props.photoId}>Photos (upload)</label>
        <input
          id={props.photoId}
          name="photo"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/heic"
          onChange={(e) => {
            const n = e.currentTarget.files?.length ?? 0;
            setFileCount(n);
          }}
        />
        {fileCount > 0 && (
          <small style={{ color: 'var(--ink-2)', fontWeight: 500, marginTop: 2, display: 'block' }}>
            {fileCount} {fileCount === 1 ? 'photo' : 'photos'} selected. First will be the cover.
          </small>
        )}
        <small style={{ color: 'var(--muted)' }}>
          Pick one or many. Each is auto-resized to 1200px and converted to WebP in your browser.
          EXIF stripped.
        </small>
      </div>
      <div className="field">
        <label htmlFor={props.imageUrlId}>Or external image URL</label>
        <input
          id={props.imageUrlId}
          name="imageUrl"
          type="url"
          placeholder="https://… (skip if you uploaded photos above)"
        />
      </div>
      <div className="row">
        <button type="submit" className="btn">
          Add item
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
