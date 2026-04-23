import type { SaleItem, SaleSite } from '@yrdsl/core';
import { SaleViewer } from '@yrdsl/viewer';
import '@yrdsl/viewer/styles.css';
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ApiError, type ApiItem, type ApiSale, api } from '../lib/api.js';

/**
 * Published-sale viewer. Mounted at /:user/:slug.
 *
 * Client-side fetch of /public/sales/{user}/{slug} and render with
 * <SaleViewer>. The canonical marketing URL is yrdsl.app/{user}/{slug};
 * today the landing lives on GH Pages and a Cloudflare Worker overlay
 * hasn't been deployed yet. Until that ships, this page under
 * app.yrdsl.app handles direct links.
 */
export function ViewerPage() {
  const { user, slug } = useParams<{ user: string; slug: string }>();
  const [data, setData] = useState<{ site: ApiSale; items: ApiItem[] } | null>(null);
  const [error, setError] = useState<'not_found' | 'network' | null>(null);

  useEffect(() => {
    if (!user || !slug) return;
    let cancelled = false;
    api
      .getPublicSale(user, slug)
      .then((r) => {
        if (cancelled) return;
        if ('redirect' in r) {
          // Legacy API response shape (pre-0.4 backend). Ignore —
          // viewer-side redirects no longer exist.
          setError('not_found');
        } else {
          setData(r);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 404) setError('not_found');
          else setError('network');
        } else {
          setError('network');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, slug]);

  if (!user || !slug) return <Navigate to="/" replace />;

  if (error === 'not_found') {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: '80px auto',
          padding: '0 24px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Nothing here</h1>
        <p style={{ color: '#71717a', lineHeight: 1.5 }}>
          We couldn't find a published sale at{' '}
          <code>
            /{user}/{slug}
          </code>
          . Maybe the owner took it down, or the link has a typo.
        </p>
      </div>
    );
  }
  if (error === 'network' || !data) {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: '80px auto',
          padding: '0 24px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <p style={{ color: '#71717a' }}>
          {error === 'network' ? 'Something went wrong.' : 'Loading…'}
        </p>
      </div>
    );
  }

  // The API's ApiSale / ApiItem are structurally compatible with the zod-inferred
  // SaleSite / SaleItem. Cast through unknown because zod passthrough adds an
  // index signature that plain TS interfaces don't carry.
  const site = data.site as unknown as SaleSite;
  const items = data.items as unknown as SaleItem[];
  return <SaleViewer site={site} items={items} />;
}
