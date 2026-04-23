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
      // Turn off invite gating for the baseline auth/rate-limit suite. the
      // invite-specific flows are covered in invites.test.ts.
      REQUIRE_INVITE: 'false',
      BOOTSTRAP_ADMIN_EMAIL: '',
      // Force the email stub path. the real key in .dev.vars would leak into
      // the test runtime and Resend's sandbox rejects non-owner recipients.
      RESEND_API_KEY: '',
      HIBP_SKIP: 'true',
      CSRF_SKIP: 'true',
      SESSION_SIGNING_KEY: 'testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest',
    },
    // Schema is applied by test/global-setup.ts once before the suite.
  });
});

afterAll(async () => {
  await worker?.stop();
});

function uniqueEmail() {
  return `test-${Math.random().toString(36).slice(2, 10)}@example.com`;
}

describe('auth integration', () => {
  test('GET /health returns 200', async () => {
    const res = await worker.fetch('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('signup → confirm → me → token → bearer auth', async () => {
    const email = uniqueEmail();
    const password = 'horsebatterystaple42!';

    const signupRes = await worker.fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signupRes.status).toBe(201);
    const signupBody = (await signupRes.json()) as {
      user: { email: string; emailConfirmed: boolean };
      devConfirmUrl?: string;
    };
    expect(signupBody.user.email).toBe(email);
    expect(signupBody.user.emailConfirmed).toBe(false);
    expect(signupBody.devConfirmUrl).toBeDefined();

    // Extract confirmation token from the stub-mailer URL.
    const token = new URL(signupBody.devConfirmUrl!).searchParams.get('token')!;
    const cookie = signupRes.headers.get('Set-Cookie')!;

    const confirmRes = await worker.fetch('/auth/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ token }),
    });
    expect(confirmRes.status).toBe(204);

    const meRes = await worker.fetch('/me', { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { user: { emailConfirmed: boolean } };
    expect(meBody.user.emailConfirmed).toBe(true);

    const tokenRes = await worker.fetch('/me/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'test-token', scope: 'read', expiry: 'none' }),
    });
    expect(tokenRes.status).toBe(201);
    const tokenBody = (await tokenRes.json()) as { secret: string };
    expect(tokenBody.secret).toMatch(/^yrs_live_/);

    const bearerMe = await worker.fetch('/me', {
      headers: { Authorization: `Bearer ${tokenBody.secret}` },
    });
    expect(bearerMe.status).toBe(200);
  });

  test('signup rate limit: 6th attempt from same IP returns 429', async () => {
    // Rate limiter keys by CF-Connecting-IP and buckets by wall-clock. Miniflare
    // persists KV state across vitest runs, so use a random IP each run to land
    // in a fresh bucket.
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({
          email: uniqueEmail(),
          password: 'horsebatterystaple42!',
        }),
      });
      results.push(res.status);
    }
    // First 5 should be 201; the 6th should be rate-limited.
    expect(results.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(results[5]).toBe(429);
  });
});
