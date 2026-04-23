import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type UnstableDevWorker, unstable_dev } from 'wrangler';

let worker: UnstableDevWorker;

// Dynamic so re-running the suite against a persisted local D1 doesn't collide
// with the previous run's bootstrap admin row.
const ADMIN_EMAIL = `admin-${Math.random().toString(36).slice(2, 10)}@example.com`;
const PASSWORD = 'horsebatterystaple42!';

beforeAll(async () => {
  worker = await unstable_dev('src/index.ts', {
    experimental: { disableExperimentalWarning: true },
    local: true,
    vars: {
      APP_URL: 'http://localhost',
      EMAIL_FROM: 'test <onboarding@resend.dev>',
      ALLOWED_ORIGINS: 'http://localhost',
      REQUIRE_INVITE: 'true',
      BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
      // See note in auth.test.ts: avoid hitting the real Resend API.
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

function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@example.com`;
}

async function signup(body: Record<string, unknown>, ip?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  const res = await worker.fetch('/auth/signup', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res;
}

describe('invite-only signup', () => {
  let adminCookie: string;

  test('bootstrap admin signs up without an invite code', async () => {
    const res = await signup({ email: ADMIN_EMAIL, password: PASSWORD }, '198.51.100.10');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { isAdmin: boolean } };
    expect(body.user.isAdmin).toBe(true);
    adminCookie = res.headers.get('Set-Cookie')!;
  });

  test('non-admin signup without invite is rejected', async () => {
    const res = await signup({ email: uniqueEmail(), password: PASSWORD }, '198.51.100.11');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invite_required');
  });

  test('non-admin cannot reach /admin/invites', async () => {
    // Create a second user via an invite so we have a non-admin with a session.
    const mkRes = await worker.fetch('/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ expiresInDays: 7 }),
    });
    expect(mkRes.status).toBe(201);
    const mkBody = (await mkRes.json()) as { invite: { code: string } };

    const email = uniqueEmail('plain');
    const signupRes = await signup(
      { email, password: PASSWORD, inviteCode: mkBody.invite.code },
      '198.51.100.12',
    );
    expect(signupRes.status).toBe(201);
    const plainCookie = signupRes.headers.get('Set-Cookie')!;

    const forbid = await worker.fetch('/admin/invites', { headers: { Cookie: plainCookie } });
    expect(forbid.status).toBe(403);
  });

  test('invite: create → consume → reuse fails', async () => {
    const mkRes = await worker.fetch('/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ note: 'for testing', expiresInDays: 7 }),
    });
    expect(mkRes.status).toBe(201);
    const { invite } = (await mkRes.json()) as {
      invite: { code: string; status: string; url: string };
    };
    expect(invite.status).toBe('pending');
    expect(invite.url).toContain(`invite=${invite.code}`);

    const email1 = uniqueEmail('first');
    const first = await signup(
      { email: email1, password: PASSWORD, inviteCode: invite.code },
      '198.51.100.20',
    );
    expect(first.status).toBe(201);

    const email2 = uniqueEmail('second');
    const second = await signup(
      { email: email2, password: PASSWORD, inviteCode: invite.code },
      '198.51.100.21',
    );
    expect(second.status).toBe(400);
    const secondBody = (await second.json()) as { error: string };
    expect(secondBody.error).toBe('invite_already_used');
  });

  test('unknown invite code returns invite_not_found', async () => {
    const res = await signup(
      {
        email: uniqueEmail('ghost'),
        password: PASSWORD,
        inviteCode: 'THIS-DOES-NOT-EXIST',
      },
      '198.51.100.30',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invite_not_found');
  });

  test('revoked invite is rejected on signup', async () => {
    const mkRes = await worker.fetch('/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ expiresInDays: 7 }),
    });
    const { invite } = (await mkRes.json()) as { invite: { code: string } };

    const delRes = await worker.fetch(`/admin/invites/${invite.code}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(204);

    const res = await signup(
      {
        email: uniqueEmail('rev'),
        password: PASSWORD,
        inviteCode: invite.code,
      },
      '198.51.100.40',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invite_revoked');
  });
});
