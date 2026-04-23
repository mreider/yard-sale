import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type UnstableDevWorker, unstable_dev } from 'wrangler';

/**
 * Dedicated CSRF test. Runs WITHOUT CSRF_SKIP so the double-submit
 * check in lib/auth.ts requireAuth actually fires.
 *
 * The other suites bypass CSRF for ergonomic reasons; this is the one
 * place we prove the wire-level enforcement works.
 */

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
      // CSRF_SKIP intentionally not set — we want the check to fire.
      // COOKIE_DOMAIN set so we can assert the Domain attribute widening
      // (prod needs it so the SPA on app.yrdsl.app can read the cookie
      // set by api.yrdsl.app; unsetting it in dev avoids Domain=localhost
      // weirdness).
      COOKIE_DOMAIN: 'example.com',
      SESSION_SIGNING_KEY: 'testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest',
    },
  });
});

afterAll(async () => {
  await worker?.stop();
});

function collectCookies(res: Response): { cookie: string; csrf: string } {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  // Skip deletion headers (Max-Age=0) the way a real browser would — the
  // server may emit a legacy-cleanup Set-Cookie followed by the real one
  // and applying them in order means the final state is just the real one.
  const live = setCookies.filter((s) => !/max-age=0/i.test(s));
  const pairs = live.map((s) => s.split(';')[0]?.trim() ?? '');
  const cookie = pairs.join('; ');
  const csrfPair = pairs.find((p) => p.startsWith('__ys_csrf='));
  const csrf = csrfPair ? decodeURIComponent(csrfPair.slice('__ys_csrf='.length)) : '';
  return { cookie, csrf };
}

async function signupAndConfirm(): Promise<{ cookie: string; csrf: string }> {
  const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;
  const email = `csrf-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const res = await worker.fetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      email,
      password: 'horsebatterystaple42!',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { devConfirmUrl?: string };
  const { cookie, csrf } = collectCookies(res);

  const token = new URL(body.devConfirmUrl!).searchParams.get('token')!;
  await worker.fetch('/auth/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ token }),
  });
  return { cookie, csrf };
}

describe('CSRF double-submit', () => {
  test('signup issues both __ys_sess and __ys_csrf cookies', async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;
    const res = await worker.fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({
        email: `csrf-init-${Math.random().toString(36).slice(2, 10)}@example.com`,
        password: 'horsebatterystaple42!',
      }),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    expect(set.some((s) => s.startsWith('__ys_sess='))).toBe(true);
    expect(set.some((s) => s.startsWith('__ys_csrf='))).toBe(true);
    // The live CSRF cookie is the one that isn't a deletion (Max-Age=0
    // is emitted as a legacy-cleanup that real browsers apply first).
    const csrfCookie = set
      .filter((s) => s.startsWith('__ys_csrf='))
      .find((s) => !/max-age=0/i.test(s))!;
    expect(csrfCookie).toBeTruthy();
    // Must NOT be httpOnly (the SPA needs to read it).
    expect(csrfCookie.toLowerCase()).not.toContain('httponly');
    // Must carry Domain=<apex> so SPA on a sibling subdomain can see it.
    expect(csrfCookie.toLowerCase()).toContain('domain=example.com');
    // Session cookie stays host-only (no Domain attribute).
    const sessCookie = set.find((s) => s.startsWith('__ys_sess='))!;
    expect(sessCookie.toLowerCase()).not.toContain('domain=');
  });

  test('mutating session-auth call without X-CSRF-Token is rejected', async () => {
    const { cookie } = await signupAndConfirm();
    const res = await worker.fetch('/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Forbidden' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('csrf_mismatch');
  });

  test('mutating session-auth call with mismatched X-CSRF-Token is rejected', async () => {
    const { cookie } = await signupAndConfirm();
    const res = await worker.fetch('/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': 'definitely-not-the-real-token',
      },
      body: JSON.stringify({ title: 'Forbidden' }),
    });
    expect(res.status).toBe(403);
  });

  test('mutating session-auth call with matching X-CSRF-Token succeeds', async () => {
    const { cookie, csrf } = await signupAndConfirm();
    const res = await worker.fetch('/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({ title: 'Allowed' }),
    });
    expect(res.status).toBe(201);
  });

  test('GET request with session cookie does NOT require CSRF', async () => {
    const { cookie } = await signupAndConfirm();
    const res = await worker.fetch('/sales', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});
