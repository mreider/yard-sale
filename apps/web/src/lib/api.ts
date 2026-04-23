const BASE = import.meta.env.VITE_API_URL || '/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(`${status} ${code}`);
  }
}

/** Read the `__ys_csrf` cookie that the api-worker sets on login/signup. */
function readCsrfCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)__ys_csrf=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  // CSRF: the api-worker enforces double-submit on session-auth'd
  // mutating requests. The cookie is set by login/signup; we just echo it.
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data as { error?: string }).error ?? 'unknown_error';
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}

export interface PublicUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
  username: string;
  avatarUrl: string | null;
  defaultLanguage: string;
  defaultTheme: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface PublicInvite {
  code: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: { id: string; email: string; username: string } | null;
  note: string | null;
  revokedAt: number | null;
  status: 'pending' | 'used' | 'expired' | 'revoked';
  url: string;
}

export interface PublicToken {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write' | 'admin';
  expiresAt: number | null;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  createdAt: number;
}

// Sale + item shapes (mirror @yrdsl/core's SaleSite / SaleItem with the
// host-only `id` field). Defined here so the web app doesn't need to
// import zod schemas at runtime.

export interface ApiSaleContact {
  email?: string;
  sms?: string;
  whatsapp?: string;
  notes?: string;
}

export interface ApiSale {
  id: string;
  siteName: string;
  description?: string;
  slug: string;
  theme: 'conservative' | 'retro' | 'hip' | 'artsy';
  currency: string;
  language: string;
  contact?: ApiSaleContact;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the sale is published. Absolute viewer URL, shareable. */
  publicUrl?: string;
  /** Absolute URL of the edit page for this sale (requires auth). */
  editorUrl?: string;
}

export interface ApiReservation {
  on: string;
  price: number;
  note?: string;
}

export interface ApiItem {
  id: string;
  slug?: string;
  title: string;
  price: number;
  tags: string[];
  added: string;
  image?: string;
  images?: string[];
  description?: string;
  reserved?: ApiReservation | null;
  sortOrder?: number;
  updatedAt?: string;
  /** Set when the parent sale is published. Deep-link to this item. */
  publicUrl?: string;
  /** Absolute URL of the sale's edit page (no per-item editor exists). */
  editorUrl?: string;
}

export const api = {
  signup: (body: {
    email: string;
    password: string;
    username?: string;
    inviteCode?: string;
    turnstileToken?: string;
  }) => call<{ user: PublicUser; devConfirmUrl?: string }>('POST', '/auth/signup', body),
  login: (body: { email: string; password: string }) =>
    call<{ user: PublicUser }>('POST', '/auth/login', body),
  logout: () => call<void>('POST', '/auth/logout'),
  confirm: (token: string) => call<void>('POST', '/auth/confirm', { token }),
  resendConfirmation: () => call<{ devConfirmUrl?: string }>('POST', '/auth/resend-confirmation'),
  forgotPassword: (email: string) => call<void>('POST', '/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    call<void>('POST', '/auth/reset-password', { token, password }),

  me: () => call<{ user: PublicUser }>('GET', '/me'),
  updateMe: (patch: Partial<Pick<PublicUser, 'defaultLanguage' | 'defaultTheme'>>) =>
    call<{ user: PublicUser }>('PATCH', '/me', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<void>('PUT', '/me/password', { currentPassword, newPassword }),
  deleteMe: (currentPassword: string) =>
    call<void>('DELETE', '/me', { currentPassword, confirmation: 'DELETE' }),

  listTokens: () => call<{ tokens: PublicToken[] }>('GET', '/me/tokens'),
  createToken: (body: {
    name: string;
    scope: 'read' | 'write' | 'admin';
    expiry: 'none' | '30d' | '90d' | '1y';
  }) => call<{ token: PublicToken; secret: string }>('POST', '/me/tokens', body),
  deleteToken: (id: string) => call<void>('DELETE', `/me/tokens/${id}`),

  listInvites: () => call<{ invites: PublicInvite[] }>('GET', '/admin/invites'),
  createInvite: (body: { note?: string; expiresInDays?: number }) =>
    call<{ invite: PublicInvite }>('POST', '/admin/invites', body),
  revokeInvite: (code: string) => call<void>('DELETE', `/admin/invites/${code}`),

  // ─── Sales ─────────────────────────────────────────────────────────────
  listSales: () => call<{ sales: ApiSale[] }>('GET', '/sales'),
  getSale: (id: string) => call<{ sale: ApiSale; items: ApiItem[] }>('GET', `/sales/${id}`),
  createSale: (body: {
    title: string;
    description?: string;
    theme?: ApiSale['theme'];
    language?: string;
    currency?: string;
    contact?: ApiSaleContact;
  }) => call<{ sale: ApiSale }>('POST', '/sales', body),
  updateSale: (id: string, patch: Partial<Omit<ApiSale, 'id' | 'createdAt' | 'updatedAt'>>) =>
    call<{ sale: ApiSale }>('PATCH', `/sales/${id}`, patch),
  deleteSale: (id: string) => call<void>('DELETE', `/sales/${id}`),
  publishSale: (id: string) =>
    call<{ publishedAt: string; publicUrl: string }>('POST', `/sales/${id}/publish`),
  unpublishSale: (id: string) => call<void>('POST', `/sales/${id}/unpublish`),
  exportSale: async (id: string): Promise<Blob> => {
    // Returns a binary ZIP rather than JSON, so it bypasses call() and
    // talks to fetch directly. Errors still come back as JSON.
    const res = await fetch(`${BASE}/sales/${id}/export`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const code = (data as { error?: string }).error ?? 'unknown_error';
      throw new ApiError(res.status, code, data);
    }
    return res.blob();
  },

  // ─── Items ─────────────────────────────────────────────────────────────
  addItem: (
    saleId: string,
    body: {
      title: string;
      price: number;
      tags?: string[];
      description?: string;
      image?: string;
      images?: string[];
      added?: string;
    },
  ) => call<{ item: ApiItem }>('POST', `/sales/${saleId}/items`, body),
  updateItem: (
    saleId: string,
    itemId: string,
    patch: Partial<{
      title: string;
      price: number;
      tags: string[];
      description: string;
      image: string;
      images: string[];
      added: string;
      sortOrder: number;
      reserved: ApiReservation | null;
    }>,
  ) => call<{ item: ApiItem }>('PATCH', `/sales/${saleId}/items/${itemId}`, patch),
  deleteItem: (saleId: string, itemId: string) =>
    call<void>('DELETE', `/sales/${saleId}/items/${itemId}`),
  reorderItems: (saleId: string, ids: string[]) =>
    call<void>('POST', `/sales/${saleId}/items/reorder`, { ids }),

  // ─── Item image uploads ────────────────────────────────────────────────
  uploadAvatar: async (webpBlob: Blob): Promise<{ avatarUrl: string }> => {
    // Raw fetch (not call()) because the body is binary image bytes,
    // not JSON. Still needs to echo the CSRF token and go through the
    // same BASE as every other API call so it lands on api.yrdsl.app.
    const headers: Record<string, string> = { 'Content-Type': 'image/webp' };
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(`${BASE}/me/avatar`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: webpBlob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (data as { error?: string }).error ?? 'unknown_error';
      throw new ApiError(res.status, code, data);
    }
    return data as { avatarUrl: string };
  },
  /**
   * POSTs pre-resized image bytes to /images/bytes. The server sniffs
   * magic bytes, validates against the Content-Type, stores in R2, and
   * appends to the item's images array. `mime` must match the actual
   * encoding of `blob` (pair with `resizeForUpload`, which returns
   * matching pairs).
   */
  uploadItemImage: async (
    saleId: string,
    itemId: string,
    blob: Blob,
    mime: 'image/webp' | 'image/jpeg' | 'image/png',
  ) => {
    const headers: Record<string, string> = { 'Content-Type': mime };
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(`${BASE}/sales/${saleId}/items/${itemId}/images/bytes`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (data as { error?: string }).error ?? 'unknown_error';
      throw new ApiError(res.status, code, data);
    }
    return data as { url: string; images: string[] };
  },
  deleteItemImage: (saleId: string, itemId: string, url: string) =>
    call<{ images: string[] }>(
      'DELETE',
      `/sales/${saleId}/items/${itemId}/images?url=${encodeURIComponent(url)}`,
    ),

  // ─── Public viewer ─────────────────────────────────────────────────────
  getPublicSale: (username: string, slug: string) =>
    call<{ site: ApiSale; items: ApiItem[] } | { redirect: string }>(
      'GET',
      `/public/sales/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
    ),
};
