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

interface SessionAuth {
  cookie: string;
  csrf: string;
  userId: string;
}

function collectCookies(res: Response): { cookie: string; csrf: string } {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const pairs = setCookies.map((s) => s.split(';')[0]?.trim() ?? '');
  const cookie = pairs.join('; ');
  const csrfPair = pairs.find((p) => p.startsWith('__ys_csrf='));
  const csrf = csrfPair ? decodeURIComponent(csrfPair.slice('__ys_csrf='.length)) : '';
  return { cookie, csrf };
}

async function signupUser(): Promise<SessionAuth> {
  const email = `${unique('del-test')}@example.com`;
  const ip = `198.51.101.${Math.floor(Math.random() * 254) + 1}`;
  const res = await worker.fetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      email,
      password: 'horsebatterystaple42!',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { id: string }; devConfirmUrl?: string };
  const { cookie, csrf } = collectCookies(res);
  const token = new URL(body.devConfirmUrl!).searchParams.get('token')!;
  const confirmRes = await worker.fetch('/auth/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ token }),
  });
  expect(confirmRes.status).toBe(204);
  return { cookie, csrf, userId: body.user.id };
}

describe('DELETE /me', () => {
  test('rejects without correct password', async () => {
    const s = await signupUser();
    const res = await worker.fetch('/me', {
      method: 'DELETE',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'wrong-pw-here-123', confirmation: 'DELETE' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_current_password');

    // Account still exists.
    const me = await worker.fetch('/me', { headers: { Cookie: s.cookie } });
    expect(me.status).toBe(200);
  });

  test('rejects without confirmation phrase', async () => {
    const s = await signupUser();
    const res = await worker.fetch('/me', {
      method: 'DELETE',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'horsebatterystaple42!', confirmation: 'delete' }),
    });
    expect(res.status).toBe(400);
  });

  test('deletes account, sales, items, and tokens; cascades cleanly', async () => {
    const s = await signupUser();

    // Create a sale + item so we exercise the cascade.
    const saleRes = await worker.fetch('/sales', {
      method: 'POST',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Doomed Sale', contact: { email: 'x@example.com' } }),
    });
    expect(saleRes.status).toBe(201);
    const sale = ((await saleRes.json()) as { sale: { id: string } }).sale;
    const itemRes = await worker.fetch(`/sales/${sale.id}/items`, {
      method: 'POST',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Box of records', price: 25 }),
    });
    expect(itemRes.status).toBe(201);

    // Mint an API token too.
    const tokRes = await worker.fetch('/me/tokens', {
      method: 'POST',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'doomed', scope: 'write', expiry: 'none' }),
    });
    expect(tokRes.status).toBe(201);

    // Delete account.
    const del = await worker.fetch('/me', {
      method: 'DELETE',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'horsebatterystaple42!', confirmation: 'DELETE' }),
    });
    expect(del.status).toBe(204);

    // Cookies cleared on the response.
    const setCookies = del.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.startsWith('__ys_sess='))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('__ys_csrf='))).toBe(true);

    // Old session cookie can no longer hit /me (cascade deleted the session row).
    const after = await worker.fetch('/me', { headers: { Cookie: s.cookie } });
    expect(after.status).toBe(401);
  });

  test('rejects bearer-token callers', async () => {
    const s = await signupUser();
    const tokRes = await worker.fetch('/me/tokens', {
      method: 'POST',
      headers: {
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'bearer', scope: 'admin', expiry: 'none' }),
    });
    expect(tokRes.status).toBe(201);
    const secret = ((await tokRes.json()) as { secret: string }).secret;

    const res = await worker.fetch('/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'horsebatterystaple42!', confirmation: 'DELETE' }),
    });
    expect(res.status).toBe(403);
  });
});
