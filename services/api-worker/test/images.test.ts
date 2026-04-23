import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type UnstableDevWorker, unstable_dev } from 'wrangler';

/**
 * Tests for the from-url image endpoint. The happy path requires an
 * external HTTP call to fetch a real image, which would make these tests
 * network-dependent and flaky. We instead cover the validation paths
 * (missing body, invalid URL, blocked hosts, unsupported schemes) — which
 * are the load-bearing checks for SSRF defense and user-facing errors.
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
}
function collectCookies(res: Response): Session {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const pairs = setCookies.map((s) => s.split(';')[0].trim());
  const cookie = pairs.join('; ');
  const csrfPair = pairs.find((p) => p.startsWith('__ys_csrf='));
  const csrf = csrfPair ? decodeURIComponent(csrfPair.slice('__ys_csrf='.length)) : '';
  return { cookie, csrf };
}

async function signupAndCreateItem(): Promise<{
  session: Session;
  saleId: string;
  itemId: string;
}> {
  const email = `${unique('img-test')}@example.com`;
  const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  const su = await worker.fetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email, password: 'horsebatterystaple42!' }),
  });
  expect(su.status).toBe(201);
  const { devConfirmUrl } = (await su.json()) as { devConfirmUrl: string };
  const session = collectCookies(su);
  const token = new URL(devConfirmUrl).searchParams.get('token')!;
  const confirm = await worker.fetch('/auth/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ token }),
  });
  expect(confirm.status).toBe(204);

  // Create a sale.
  const sale = await worker.fetch('/sales', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrf,
    },
    body: JSON.stringify({ title: 'Img Test Sale' }),
  });
  const saleBody = (await sale.json()) as { sale: { id: string } };
  const saleId = saleBody.sale.id;

  // Add an item.
  const item = await worker.fetch(`/sales/${saleId}/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrf,
    },
    body: JSON.stringify({ title: 'Widget', price: 10 }),
  });
  const itemBody = (await item.json()) as { item: { id: string } };
  return { session, saleId, itemId: itemBody.item.id };
}

describe('images from-url endpoint', () => {
  test('rejects missing body', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('url_required');
  });

  test('rejects unparseable URL', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_url');
  });

  test('rejects non-http(s) scheme (file://)', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unsupported_protocol');
  });

  test('rejects blocked hosts (localhost / private IP / link-local)', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const badUrls = [
      'http://localhost/foo.png',
      'http://127.0.0.1/foo.png',
      'http://10.0.0.5/x.png',
      'http://192.168.1.1/x.png',
      'http://172.20.0.1/x.png',
      'http://169.254.169.254/meta/', // AWS/GCP metadata — the classic SSRF vector
    ];
    for (const url of badUrls) {
      const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/from-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.cookie,
          'X-CSRF-Token': session.csrf,
        },
        body: JSON.stringify({ url }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('blocked_host');
    }
  });

  test('404 when item does not belong to caller', async () => {
    const { session, saleId } = await signupAndCreateItem();
    const res = await worker.fetch(
      `/sales/${saleId}/items/01NOPE01NOPE01NOPE01NOPE/images/from-url`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.cookie,
          'X-CSRF-Token': session.csrf,
        },
        body: JSON.stringify({ url: 'https://example.com/foo.png' }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe('images bytes endpoint', () => {
  // Minimal valid PNG (1x1 transparent, 67 bytes). Real-world images are
  // way bigger; this is just enough to pass the min-bytes + magic check.
  const TINY_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  // Pad to 200+ bytes (minimum cap) without breaking magic-bytes check by
  // appending a second IDAT-shaped chunk. Simpler: concatenate with zeros;
  // the magic-byte check only reads the first 12 bytes.
  const PADDED_PNG = new Uint8Array(300);
  PADDED_PNG.set(TINY_PNG, 0);

  test('rejects unsupported Content-Type', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/gif',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: PADDED_PNG,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unsupported_image_type');
  });

  test('rejects mime/bytes mismatch', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    // Claim PNG but body is JPEG magic (FF D8 FF).
    const fakeJpeg = new Uint8Array(300);
    fakeJpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: fakeJpeg,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('mime_mismatch');
  });

  test('rejects bytes shorter than min', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const tooSmall = new Uint8Array(50);
    tooSmall.set(TINY_PNG.slice(0, Math.min(TINY_PNG.length, 50)), 0);
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: tooSmall,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toBe('decoded_too_small');
    // Hint should be present and actionable (mentions path/base64).
    expect(body.hint).toMatch(/path|base64/i);
  });

  test('happy path: stores PNG, appends to images, returns updated item with URLs', async () => {
    const { session, saleId, itemId } = await signupAndCreateItem();
    const res = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: PADDED_PNG,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      url: string;
      images: string[];
      item: { images: string[]; editorUrl: string };
    };
    expect(body.url).toMatch(/\.png$/);
    expect(body.images).toHaveLength(1);
    expect(body.item.images).toHaveLength(1);
    expect(body.item.editorUrl).toContain('/sales/');

    // Second upload appends.
    const res2 = await worker.fetch(`/sales/${saleId}/items/${itemId}/images/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf,
      },
      body: PADDED_PNG,
    });
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { images: string[] };
    expect(body2.images).toHaveLength(2);
  });
});
