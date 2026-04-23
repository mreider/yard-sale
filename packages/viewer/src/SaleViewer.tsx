import type { SaleItem, SaleSite } from '@yrdsl/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface SaleViewerProps {
  site: SaleSite;
  items: SaleItem[];
  /** Locale suffix, e.g. "de" → reads `siteName_de` / `subtitle_de` from site. */
  locale?: string;
}

function makeMoneyFormatter(currency: string, locale: string) {
  try {
    const fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    return (n: number) => fmt.format(n);
  } catch {
    // Unknown currency / locale: fall back to bare number.
    return (n: number) => `${currency} ${n.toLocaleString()}`;
  }
}

type SortKey = 'newest' | 'oldest' | 'price-asc' | 'price-desc';

/** Look up `field` on `site`, preferring `${field}_${locale}` when a locale is set. */
function localized<T>(site: SaleSite, field: string, locale?: string): T | undefined {
  const s = site as unknown as Record<string, unknown>;
  if (locale) {
    const val = s[`${field}_${locale}`];
    if (val !== undefined && val !== null && val !== '') return val as T;
  }
  return s[field] as T | undefined;
}

export function SaleViewer({ site, items, locale }: SaleViewerProps) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [hideReserved, setHideReserved] = useState(true);
  const [onlyReserved, setOnlyReserved] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [openItem, setOpenItem] = useState<SaleItem | null>(null);

  // Deep-link support: #item-id opens that item.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const found = items.find((i) => i.id === hash);
      if (found) setOpenItem(found);
    }
  }, [items]);

  useEffect(() => {
    if (openItem) {
      history.replaceState(null, '', `#${openItem.id}`);
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname);
    }
  }, [openItem]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) for (const t of i.tags) s.add(t);
    return [...s].sort();
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (hideReserved) out = out.filter((i) => !i.reserved);
    if (onlyReserved) out = out.filter((i) => !!i.reserved);
    if (activeTags.length) {
      out = out.filter((i) => activeTags.every((t) => i.tags.includes(t)));
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      out = out.filter(
        (i) =>
          i.title.toLowerCase().includes(needle) ||
          (i.description?.toLowerCase().includes(needle) ?? false) ||
          i.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    // `sortOrder` tie-breaks items added the same day: lower index wins,
    // so the editor's ↑/↓ arrows shuffle same-day additions. Items from
    // different days fall purely on `added`.
    const byOrder = (a: SaleItem, b: SaleItem) => {
      const ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      return ao - bo;
    };
    return [...out].sort((a, b) => {
      if (sort === 'newest') {
        const d = b.added.localeCompare(a.added);
        return d !== 0 ? d : byOrder(a, b);
      }
      if (sort === 'oldest') {
        const d = a.added.localeCompare(b.added);
        return d !== 0 ? d : byOrder(a, b);
      }
      if (sort === 'price-asc') return a.price - b.price;
      if (sort === 'price-desc') return b.price - a.price;
      return 0;
    });
  }, [items, q, sort, hideReserved, onlyReserved, activeTags]);

  const reservedCount = items.filter((i) => i.reserved).length;
  const available = items.length - reservedCount;

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const siteName = localized<string>(site, 'siteName', locale) ?? '';
  const subtitle = localized<string>(site, 'subtitle', locale) ?? '';
  const location = localized<string>(site, 'location', locale) ?? '';
  const money = useMemo(
    () => makeMoneyFormatter(site.currency ?? 'USD', locale ?? site.language ?? 'en'),
    [site.currency, site.language, locale],
  );

  return (
    <div className="sale-viewer" data-theme={site.theme ?? 'conservative'}>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand">
            <h1>{siteName}</h1>
            <span className="sub">
              {subtitle}
              {subtitle && location ? ' · ' : ''}
              {location}
            </span>
          </div>
          <div className="stats">
            <b>{available}</b> available · <b>{reservedCount}</b> reserved · <b>{items.length}</b>{' '}
            total
          </div>
        </div>
      </header>

      <Controls
        q={q}
        setQ={setQ}
        sort={sort}
        setSort={setSort}
        hideReserved={hideReserved}
        setHideReserved={setHideReserved}
        onlyReserved={onlyReserved}
        setOnlyReserved={setOnlyReserved}
      />

      {allTags.length > 0 && (
        <TagChips
          tags={allTags}
          active={activeTags}
          onToggle={toggleTag}
          onClear={() => setActiveTags([])}
        />
      )}

      <main className="grid">
        {filtered.length === 0 ? (
          <div className="empty">
            Nothing matches. Try clearing filters or toggling "Hide reserved" off.
          </div>
        ) : (
          filtered.map((item) => (
            <Card key={item.id} item={item} onOpen={setOpenItem} money={money} />
          ))
        )}
      </main>

      <footer className="footer">
        <span>
          {siteName}
          {location ? ` · ${location}` : ''}
        </span>
        <span>Updated {items[0]?.added ?? 'just now'}</span>
      </footer>

      {openItem && (
        <Modal item={openItem} site={site} money={money} onClose={() => setOpenItem(null)} />
      )}
    </div>
  );
}

interface ControlsProps {
  q: string;
  setQ: (v: string) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  hideReserved: boolean;
  setHideReserved: (v: boolean) => void;
  onlyReserved: boolean;
  setOnlyReserved: (v: boolean) => void;
}

function Controls(p: ControlsProps) {
  return (
    <div className="controls">
      <div className="search-wrap">
        <input
          placeholder="Search title, description, tags…"
          value={p.q}
          onChange={(e) => p.setQ(e.target.value)}
        />
      </div>
      <select
        className="select"
        value={p.sort}
        onChange={(e) => p.setSort(e.target.value as SortKey)}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="price-asc">Price: low to high</option>
        <option value="price-desc">Price: high to low</option>
      </select>
      <label className="toggle">
        <input
          type="checkbox"
          checked={p.hideReserved}
          onChange={(e) => {
            p.setHideReserved(e.target.checked);
            if (e.target.checked) p.setOnlyReserved(false);
          }}
        />
        <span className="dot" />
        <span className="lbl">Hide reserved</span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={p.onlyReserved}
          onChange={(e) => {
            p.setOnlyReserved(e.target.checked);
            if (e.target.checked) p.setHideReserved(false);
          }}
        />
        <span className="dot" />
        <span className="lbl">Only reserved</span>
      </label>
    </div>
  );
}

function TagChips({
  tags,
  active,
  onToggle,
  onClear,
}: {
  tags: string[];
  active: string[];
  onToggle: (t: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="chip-row">
      {tags.map((t) => (
        <button
          type="button"
          key={t}
          className={`chip${active.includes(t) ? ' active' : ''}`}
          onClick={() => onToggle(t)}
        >
          {t}
        </button>
      ))}
      {active.length > 0 && (
        <button type="button" className="chip clear" onClick={onClear}>
          clear tags
        </button>
      )}
    </div>
  );
}

/**
 * Normalize the images on an item. The schema has both a legacy `image`
 * (single) and `images[]` (array). Viewer + editor standardize on the
 * array, falling back to [image] when that's all that exists.
 */
function imagesOf(item: SaleItem): string[] {
  if (item.images && item.images.length > 0) return item.images;
  if (item.image) return [item.image];
  return [];
}

function Card({
  item,
  onOpen,
  money,
}: {
  item: SaleItem;
  onOpen: (i: SaleItem) => void;
  money: (n: number) => string;
}) {
  const reserved = !!item.reserved;
  const imgs = imagesOf(item);
  return (
    <article
      className={`card${reserved ? ' reserved' : ''}`}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(item);
      }}
    >
      <div className="thumb">
        {reserved && <span className="badge reserved-badge badge-abs">Reserved</span>}
        {imgs[0] && <img src={imgs[0]} alt={item.title} loading="lazy" />}
        {imgs.length > 1 && (
          <span className="photo-count" aria-label={`${imgs.length} photos`}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7h4l2-2h6l2 2h4v12H3z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
              />
            </svg>
            {imgs.length}
          </span>
        )}
      </div>
      <div className="body">
        <div className="title">{item.title}</div>
        <div className="row2">
          {reserved && item.reserved ? (
            <>
              <span className="price strike">{money(item.price)}</span>
              <span className="price">{money(item.reserved.price)}</span>
            </>
          ) : (
            <span className="price">{money(item.price)}</span>
          )}
        </div>
        <div className="tags">
          {item.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function Modal({
  item,
  site,
  money,
  onClose,
}: {
  item: SaleItem;
  site: SaleSite;
  money: (n: number) => string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const imgs = imagesOf(item);
  const imgCount = imgs.length;
  const [imgIdx, setImgIdx] = useState(0);

  // Reset carousel position when switching items without closing the modal
  // (relevant if we later add prev/next-item nav; harmless otherwise).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset only on item change
  useEffect(() => {
    setImgIdx(0);
  }, [item.id]);

  const prev = useCallback(() => setImgIdx((i) => (i - 1 + imgCount) % imgCount), [imgCount]);
  const next = useCallback(() => setImgIdx((i) => (i + 1) % imgCount), [imgCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (imgCount > 1) {
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, imgCount, prev, next]);

  // Minimal touch-swipe: record the start X on touchstart, fire prev/next
  // on touchend when the horizontal delta exceeds a small threshold.
  // Vertical-dominant gestures fall through so the page can scroll.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || imgs.length <= 1) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) prev();
    else next();
  };

  const reserved = !!item.reserved;
  const contact = site.contact;

  function share() {
    const url = `${window.location.origin}${window.location.pathname}#${item.id}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="image" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {reserved && <span className="badge reserved-badge badge-abs">Reserved</span>}
          {imgs[imgIdx] && <img src={imgs[imgIdx]} alt={item.title} />}
          {imgs.length > 1 && (
            <>
              <button
                type="button"
                className="carousel-nav carousel-prev"
                onClick={prev}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                type="button"
                className="carousel-nav carousel-next"
                onClick={next}
                aria-label="Next photo"
              >
                ›
              </button>
              <div className="carousel-dots" role="tablist" aria-label="Photo selector">
                {imgs.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    className={`carousel-dot${i === imgIdx ? ' active' : ''}`}
                    onClick={() => setImgIdx(i)}
                    aria-label={`Photo ${i + 1} of ${imgs.length}`}
                    aria-selected={i === imgIdx}
                    role="tab"
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <div className="content">
          <h2>{item.title}</h2>
          <div className="price-block">
            {reserved && item.reserved ? (
              <>
                <span className="num strike">{money(item.price)}</span>
                <span className="num">{money(item.reserved.price)}</span>
              </>
            ) : (
              <span className="num">{money(item.price)}</span>
            )}
          </div>
          {item.description && <div className="desc">{item.description}</div>}
          <div className="meta">
            <span>
              <b>Listed</b> {item.added}
            </span>
            {item.tags.length > 0 && (
              <span>
                <b>Tags</b> {item.tags.join(', ')}
              </span>
            )}
          </div>
          <div className="share-row">
            <span>Share:</span>
            <button type="button" onClick={share}>
              {copied ? '✓ Link copied' : 'Copy link'}
            </button>
          </div>
          {!reserved && contact && <ContactBlock item={item} contact={contact} money={money} />}
        </div>
      </div>
    </div>
  );
}

function ContactBlock({
  item,
  contact,
  money,
}: {
  item: SaleItem;
  contact: { email?: string; sms?: string; whatsapp?: string };
  money: (n: number) => string;
}) {
  const subject = encodeURIComponent(`Re: ${item.title}`);
  const body = encodeURIComponent(
    `Hi, I'd like to grab the ${item.title} (${money(item.price)}).\nWhen's a good pickup time?`,
  );
  return (
    <div className="form">
      <h3>Want it? Reach out directly.</h3>
      <div className="contact-row">
        {contact.email && (
          <a className="btn" href={`mailto:${contact.email}?subject=${subject}&body=${body}`}>
            Email
          </a>
        )}
        {contact.sms && (
          <a className="btn" href={`sms:${contact.sms}?body=${body}`}>
            Text
          </a>
        )}
        {contact.whatsapp && (
          <a
            className="btn"
            // wa.me expects digits only, no leading "+". Strip the + that
            // the editor's PhoneInput writes in E.164 format.
            href={`https://wa.me/${contact.whatsapp.replace(/^\+/, '')}?text=${body}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
