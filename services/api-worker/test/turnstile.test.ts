import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type UnstableDevWorker, unstable_dev } from 'wrangler';

/**
 * Dedicated suite that runs the worker WITH a Turnstile secret key set,
 * to exercise the failure paths. The other suites leave the secret unset
 * so signup/auth flows continue to work without a captcha — that's the
 * documented dev/test fall-back.
 *
 * We use Cloudflare's published "always passes" / "always fails" demo
 * keys so we don't need a real Turnstile project for tests, and don't
 * hit the real siteverify in CI.
 *
 *   1x0000000000000000000000000000000AA  → secret that always passes
 *   2x0000000000000000000000000000000AA  → secret that always fails
 *   See https://developers.cloudflare.com/turnstile/troubleshooting/testing/
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
      CSRF_SKIP: 'true',
      SESSION_SIGNING_KEY: 'testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest',
      // Always-passes secret. Sending any non-empty token succeeds at
      // siteverify; missing token still fails locally before the network
      // call.
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    },
  });
});

afterAll(async () => {
  await worker?.stop();
});

function unique() {
  return `ts-test-${Math.random().toString(36).slice(2, 10)}`;
}

async function signup(body: Record<string, unknown>) {
  const ip = `198.51.104.${Math.floor(Math.random() * 254) + 1}`;
  return worker.fetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

describe('signup with TURNSTILE_SECRET_KEY set', () => {
  test('rejects when token is missing', async () => {
    const res = await signup({
      email: `${unique()}@example.com`,
      password: 'horsebatterystaple42!',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe('turnstile_failed');
    expect(body.reason).toBe('missing_token');
  });

  test('accepts when token is present (always-passes secret)', async () => {
    const res = await signup({
      email: `${unique()}@example.com`,
      password: 'horsebatterystaple42!',
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    });
    expect(res.status).toBe(201);
  });
});
