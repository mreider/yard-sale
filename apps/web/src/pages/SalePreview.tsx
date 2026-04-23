import type { SaleItem, SaleSite } from '@yrdsl/core';
import { SaleViewer } from '@yrdsl/viewer';
import '@yrdsl/viewer/styles.css';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { type ApiItem, type ApiSale, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

/**
 * /sales/:id/preview — renders the full SaleViewer using the user's
 * current draft (loaded from the authenticated /sales/:id endpoint, not
 * the public /:user/:slug viewer).
 *
 * Why a separate route instead of an inline pane: the viewer is a
 * full-bleed layout with its own search/sort controls; embedding it
 * inside the editor card would either crush it or visually fight the
 * form. Opening in a new tab gives the seller the same view buyers
 * will see, without losing their place in the editor.
 *
 * Auth-gated. Anyone hitting /sales/:id/preview without owning the
 * sale will 404 from the API and we'll show "not found".
 */
export function SalePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [data, setData] = useState<{ sale: ApiSale; items: ApiItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    api
      .getSale(id)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Load failed'));
  }, [user, id]);

  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (err) return <div style={{ padding: 20 }}>{err}</div>;
  if (!data) return <div style={{ padding: 20 }}>Loading sale…</div>;

  const site = apiSaleToSite(data.sale);
  const items = data.items.map(apiItemToSaleItem);

  return (
    <>
      <div
        style={{
          padding: '8px 14px',
          background: '#fff7d6',
          borderBottom: '1px solid #e7d780',
          fontSize: 13,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <b>Preview mode.</b>
        <span style={{ color: '#666' }}>
          You're viewing the draft of "{data.sale.siteName}" (
          {data.sale.publishedAt ? 'live' : 'unpublished'}). Buyers see the same layout at the
          public URL.
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Link to={`/sales/${id}`}>← Back to editor</Link>
        </span>
      </div>
      <SaleViewer site={site} items={items} />
    </>
  );
}

function apiSaleToSite(sale: ApiSale): SaleSite {
  const out: SaleSite = {
    siteName: sale.siteName,
    theme: sale.theme,
    currency: sale.currency,
    language: sale.language,
    slug: sale.slug,
  };
  if (sale.description) out.description = sale.description;
  if (sale.contact) out.contact = sale.contact;
  if (sale.publishedAt) out.publishedAt = sale.publishedAt;
  return out;
}

function apiItemToSaleItem(item: ApiItem): SaleItem {
  return {
    id: item.id,
    title: item.title,
    price: item.price,
    tags: item.tags,
    added: item.added,
    ...(item.slug !== undefined && { slug: item.slug }),
    ...(item.image !== undefined && { image: item.image }),
    ...(item.images !== undefined && { images: item.images }),
    ...(item.description !== undefined && { description: item.description }),
    ...(item.reserved !== undefined && { reserved: item.reserved }),
    ...(item.sortOrder !== undefined && { sortOrder: item.sortOrder }),
    ...(item.updatedAt !== undefined && { updatedAt: item.updatedAt }),
  };
}
