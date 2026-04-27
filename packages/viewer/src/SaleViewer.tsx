import type { SaleItem, SaleSite } from '@yrdsl/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCALE_NAMES, SUPPORTED_LOCALES, detectLocale, t, tPlural } from './i18n';

export interface SaleViewerProps {
  site: SaleSite;
  items: SaleItem[];
  /** Locale suffix, e.g. "de" → reads `siteName_de` / `subtitle_de` from site. */
  locale?: string;
  /**
   * When the page URL is a path-based item deep-link (e.g.
   * /matt/moving-sale/moccamaster-select-coffee-maker), pass the third
   * segment in here so the modal opens on first paint without a flash
   * of the grid. Takes precedence over the legacy `#item-id` hash.
   */
  initialItemSlug?: string;
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

function LanguagePicker({ locale, onChange }: { locale: string; onChange: (l: string) => void }) {
  return (
    <select
      className="lang-picker"
      value={locale}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Language"
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAMES[l] ?? l}
        </option>
      ))}
    </select>
  );
}

export function SaleViewer({ site, items, locale, initialItemSlug }: SaleViewerProps) {
  const [activeLocale, setActiveLocale] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('yrdsl-locale');
      if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;
    } catch {}
    return locale ?? detectLocale();
  });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [hideReserved, setHideReserved] = useState(true);
  const [onlyReserved, setOnlyReserved] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [openItem, setOpenItem] = useState<SaleItem | null>(() => {
    // Synchronous initial-state fn so the modal is open on first paint
    // when the URL is a path-based item deep-link (no flash of grid).
    if (initialItemSlug) {
      return items.find((i) => i.slug === initialItemSlug) ?? null;
    }
    return null;
  });

  // Path-based deep-link prop changes (rare — happens if the host
  // navigates client-side between item URLs without a remount).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when slug changes
  useEffect(() => {
    if (!initialItemSlug) return;
    const found = items.find((i) => i.slug === initialItemSlug);
    if (found) setOpenItem(found);
  }, [initialItemSlug]);

  // Legacy hash deep-link (#item-id). Skipped when the host already
  // gave us a path-based slug, otherwise the hash would clobber it.
  useEffect(() => {
    if (initialItemSlug) return;
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const found = items.find((i) => i.id === hash);
      if (found) setOpenItem(found);
    }
  }, [items, initialItemSlug]);

  // Mirror the open item into the URL so refreshes keep state and
  // copy-link gets the right form. Path-based when the host is using
  // it (initialItemSlug truthy), otherwise legacy hash.
  useEffect(() => {
    if (initialItemSlug !== undefined) {
      // Path-mode: caller is in charge of routing. We don't push history.
      return;
    }
    if (openItem) {
      history.replaceState(null, '', `#${openItem.id}`);
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname);
    }
  }, [openItem, initialItemSlug]);

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

  function switchLocale(l: string) {
    setActiveLocale(l);
    try {
      localStorage.setItem('yrdsl-locale', l);
    } catch {}
  }

  const siteName = localized<string>(site, 'siteName', locale) ?? '';
  const subtitle = localized<string>(site, 'subtitle', locale) ?? '';
  const location = localized<string>(site, 'location', locale) ?? '';
  const money = useMemo(
    () => makeMoneyFormatter(site.currency ?? 'USD', activeLocale),
    [site.currency, activeLocale],
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
          <div className="header-right">
            <div className="stats">
              <b>{available}</b> {t('stats.available', activeLocale)} · <b>{reservedCount}</b>{' '}
              {t('stats.reserved', activeLocale)} · <b>{items.length}</b>{' '}
              {t('stats.total', activeLocale)}
            </div>
            <LanguagePicker locale={activeLocale} onChange={switchLocale} />
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
        locale={activeLocale}
      />

      {allTags.length > 0 && (
        <TagChips
          tags={allTags}
          active={activeTags}
          onToggle={toggleTag}
          onClear={() => setActiveTags([])}
          locale={activeLocale}
        />
      )}

      <main className="grid">
        {filtered.length === 0 ? (
          <div className="empty">{t('empty.no_results', activeLocale)}</div>
        ) : (
          filtered.map((item) => (
            <Card
              key={item.id}
              item={item}
              onOpen={setOpenItem}
              money={money}
              locale={activeLocale}
            />
          ))
        )}
      </main>

      <footer className="footer">
        <span>
          {siteName}
          {location ? ` · ${location}` : ''}
        </span>
        <span>
          {t('footer.updated', activeLocale)}{' '}
          {items[0]?.added ?? t('footer.just_now', activeLocale)}
        </span>
      </footer>

      {openItem && (
        <Modal
          item={openItem}
          site={site}
          money={money}
          onClose={() => setOpenItem(null)}
          locale={activeLocale}
        />
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
  locale: string;
}

function Controls(p: ControlsProps) {
  return (
    <div className="controls">
      <div className="search-wrap">
        <input
          placeholder={t('filter.search', p.locale)}
          value={p.q}
          onChange={(e) => p.setQ(e.target.value)}
        />
      </div>
      <select
        className="select"
        value={p.sort}
        onChange={(e) => p.setSort(e.target.value as SortKey)}
      >
        <option value="newest">{t('sort.newest', p.locale)}</option>
        <option value="oldest">{t('sort.oldest', p.locale)}</option>
        <option value="price-asc">{t('sort.price_asc', p.locale)}</option>
        <option value="price-desc">{t('sort.price_desc', p.locale)}</option>
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
        <span className="lbl">{t('filter.hide_reserved', p.locale)}</span>
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
        <span className="lbl">{t('filter.only_reserved', p.locale)}</span>
      </label>
    </div>
  );
}

function TagChips({
  tags,
  active,
  onToggle,
  onClear,
  locale,
}: {
  tags: string[];
  active: string[];
  onToggle: (t: string) => void;
  onClear: () => void;
  locale: string;
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
          {t('filter.clear_tags', locale)}
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
  locale,
}: {
  item: SaleItem;
  onOpen: (i: SaleItem) => void;
  money: (n: number) => string;
  locale: string;
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
        {reserved && (
          <span className="badge reserved-badge badge-abs">{t('item.reserved', locale)}</span>
        )}
        {imgs[0] && <img src={imgs[0]} alt={item.title} loading="lazy" />}
        {imgs.length > 1 && (
          <span className="photo-count" aria-label={tPlural('item.photos', imgs.length, locale)}>
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
  locale,
}: {
  item: SaleItem;
  site: SaleSite;
  money: (n: number) => string;
  onClose: () => void;
  locale: string;
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
    // Prefer the path-based item URL so social-card crawlers (Facebook,
    // Twitter, LinkedIn, iMessage) hit a server-rendered page with
    // item-specific Open Graph tags. The pathname might already be an
    // item URL (3 segments) if the user navigated here via path-based
    // deep-link — strip back to /user/sale before appending. Falls
    // back to the legacy hash form on items without a slug.
    const origin = window.location.origin;
    const segs = window.location.pathname.split('/').filter(Boolean);
    const saleBase = `/${segs.slice(0, 2).join('/')}`;
    const url = item.slug ? `${origin}${saleBase}/${item.slug}` : `${origin}${saleBase}#${item.id}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const priceBlock = (
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
  );

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="close"
          onClick={onClose}
          aria-label={t('modal.close', locale)}
        >
          ×
        </button>
        <div className="image" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {reserved && (
            <span className="badge reserved-badge badge-abs">{t('item.reserved', locale)}</span>
          )}
          {imgs[imgIdx] && <img src={imgs[imgIdx]} alt={item.title} />}
          {imgs.length > 1 && (
            <>
              <button
                type="button"
                className="carousel-nav carousel-prev"
                onClick={prev}
                aria-label={t('modal.prev', locale)}
              >
                ‹
              </button>
              <button
                type="button"
                className="carousel-nav carousel-next"
                onClick={next}
                aria-label={t('modal.next', locale)}
              >
                ›
              </button>
              <div
                className="carousel-dots"
                role="tablist"
                aria-label={t('modal.selector', locale)}
              >
                {imgs.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    className={`carousel-dot${i === imgIdx ? ' active' : ''}`}
                    onClick={() => setImgIdx(i)}
                    aria-label={t('modal.photo_of', locale, { current: i + 1, total: imgs.length })}
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
          {priceBlock}
          {item.description && <div className="desc">{item.description}</div>}
          <div className="meta">
            <span>
              <b>{t('modal.listed', locale)}</b> {item.added}
            </span>
            {item.tags.length > 0 && (
              <span>
                <b>{t('modal.tags', locale)}</b> {item.tags.join(', ')}
              </span>
            )}
          </div>
          <div className="share-row">
            <span>{t('share.label', locale)}</span>
            <button type="button" onClick={share}>
              {copied ? `✓ ${t('share.copied', locale)}` : t('share.copy', locale)}
            </button>
          </div>
          {!reserved && contact && (
            <ContactBlock item={item} contact={contact} money={money} locale={locale} />
          )}
        </div>
      </div>
    </div>
  );
}

function ContactBlock({
  item,
  contact,
  money,
  locale,
}: {
  item: SaleItem;
  contact: { email?: string; sms?: string; whatsapp?: string };
  money: (n: number) => string;
  locale: string;
}) {
  const subject = encodeURIComponent(`Re: ${item.title}`);
  const body = encodeURIComponent(
    t('contact.body', locale, { title: item.title, price: money(item.price) }),
  );
  return (
    <div className="form">
      <h3>{t('contact.title', locale)}</h3>
      <div className="contact-row">
        {contact.email && (
          <a className="btn" href={`mailto:${contact.email}?subject=${subject}&body=${body}`}>
            {t('contact.email', locale)}
          </a>
        )}
        {contact.sms && (
          <a className="btn" href={`sms:${contact.sms}?body=${body}`}>
            {t('contact.sms', locale)}
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
            {t('contact.whatsapp', locale)}
          </a>
        )}
      </div>
    </div>
  );
}
