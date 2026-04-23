import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type UnstableDevWorker, unstable_dev } from 'wrangler';

let worker: UnstableDevWorker;

beforeAll(async () => {
  worker = await unstable_dev('src/index.ts', {
    experimental: { disableExperimentalWarning: true },
    local: true,
    vars: {
      APP_URL: 'http://localhost',
      EMAIL_FROM: 'test <onboarding@resend.dev>',
      ALLOWED_ORIGINS: 'http://localhost',
      REQUIRE_INVITE: 'false',
      BOOTSTRAP_ADMIN_EMAIL: '',
      RESEND_API_KEY: '',
      HIBP_SKIP: 'true',
      CSRF_SKIP: 'true',
      SESSION_SIGNING_KEY: 'testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest',
    },
  });
});

afterAll(async () => {
  await worker?.stop();
});

function unique(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

interface Session {
  cookie: string;
  csrf: string;
  username: string;
}

function collectCookies(res: Response): { cookie: string; csrf: string } {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const pairs = setCookies.map((s) => s.split(';')[0]?.trim() ?? '');
  const cookie = pairs.join('; ');
  const csrfPair = pairs.find((p) => p.startsWith('__ys_csrf='));
  const csrf = csrfPair ? decodeURIComponent(csrfPair.slice('__ys_csrf='.length)) : '';
  return { cookie, csrf };
}

async function signupUser(): Promise<Session> {
  const email = `${unique('export-test')}@example.com`;
  const ip = `198.51.103.${Math.floor(Math.random() * 254) + 1}`;
  const res = await worker.fetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      email,
      password: 'horsebatterystaple42!',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { username: string }; devConfirmUrl?: string };
  const { cookie, csrf } = collectCookies(res);
  const token = new URL(body.devConfirmUrl!).searchParams.get('token')!;
  await worker.fetch('/auth/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ token }),
  });
  return { cookie, csrf, username: body.user.username };
}

function authed(s: Session, body?: unknown): RequestInit {
  const headers: Record<string, string> = { Cookie: s.cookie, 'X-CSRF-Token': s.csrf };
  if (body) headers['Content-Type'] = 'application/json';
  const init: RequestInit = { headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

describe('GET /sales/:id/export', () => {
  test('returns a ZIP with site.json + items.json + README.md', async () => {
    const s = await signupUser();
    const sale = (
      (await (
        await worker.fetch('/sales', {
          method: 'POST',
          ...authed(s, {
            title: 'Export Sample',
            description: 'Things I no longer need.',
            contact: { email: 'me@example.com' },
          }),
        })
      ).json()) as { sale: { id: string; slug: string } }
    ).sale;
    await worker.fetch(`/sales/${sale.id}/items`, {
      method: 'POST',
      ...authed(s, { title: 'Toaster', price: 25, tags: ['kitchen'] }),
    });
    await worker.fetch(`/sales/${sale.id}/items`, {
      method: 'POST',
      ...authed(s, { title: 'Lamp', price: 15, description: 'Works.' }),
    });

    const res = await worker.fetch(`/sales/${sale.id}/export`, {
      headers: { Cookie: s.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain(sale.slug);

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(100);
    const entries = unzipSync(buf);

    expect(Object.keys(entries).sort()).toEqual(['README.md', 'items.json', 'site.json']);

    const dec = new TextDecoder();
    const site = JSON.parse(dec.decode(entries['site.json']!));
    expect(site.siteName).toBe('Export Sample');
    expect(site.contact.email).toBe('me@example.com');
    // Host-only id is dropped from the export.
    expect(site.id).toBeUndefined();
    // Slug is preserved (it identifies the sale in the template).
    expect(site.slug).toBe(sale.slug);

    const items = JSON.parse(dec.decode(entries['items.json']!));
    expect(items).toHaveLength(2);
    const titles = items.map((i: { title: string }) => i.title).sort();
    expect(titles).toEqual(['Lamp', 'Toaster']);

    const readme = dec.decode(entries['README.md']!);
    expect(readme).toContain('yrdsl-self-hosted');
    expect(readme).toContain(sale.slug);
  });

  test('rejects bearer-token callers', async () => {
    const s = await signupUser();
    const sale = (
      (await (
        await worker.fetch('/sales', { method: 'POST', ...authed(s, { title: 'Bearer Test' }) })
      ).json()) as { sale: { id: string } }
    ).sale;
    const tokSecret = (
      (await (
        await worker.fetch('/me/tokens', {
          method: 'POST',
          ...authed(s, { name: 'export-bearer', scope: 'admin', expiry: 'none' }),
        })
      ).json()) as { secret: string }
    ).secret;

    const res = await worker.fetch(`/sales/${sale.id}/export`, {
      headers: { Authorization: `Bearer ${tokSecret}` },
    });
    expect(res.status).toBe(403);
  });

  test('404 for not-owned sale', async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const sale = (
      (await (
        await worker.fetch('/sales', { method: 'POST', ...authed(alice, { title: "Alice's" }) })
      ).json()) as { sale: { id: string } }
    ).sale;

    const res = await worker.fetch(`/sales/${sale.id}/export`, {
      headers: { Cookie: bob.cookie },
    });
    expect(res.status).toBe(404);
  });
});
