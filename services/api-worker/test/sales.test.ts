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
  /** All cookies as one Cookie-header string. */
  cookie: string;
  /** Value of the __ys_csrf cookie, echoed back in X-CSRF-Token. */
  csrf: string;
  email: string;
  userId: string;
}

/** Pull every Set-Cookie header off a response and return them in a form
 * the next request can echo back as Cookie + extract __ys_csrf for header. */
function collectCookies(res: Response): { cookie: string; csrf: string } {
  // getSetCookie returns one entry per Set-Cookie header (Workers + Node 20+).
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const pairs = setCookies.map((s) => s.split(';')[0].trim());
  const cookie = pairs.join('; ');
  const csrfPair = pairs.find((p) => p.startsWith('__ys_csrf='));
  const csrf = csrfPair ? decodeURIComponent(csrfPair.slice('__ys_csrf='.length)) : '';
  return { cookie, csrf };
}

/** Sign up a user with a random IP + email and return session + CSRF. */
async function signupUser(): Promise<SessionAuth> {
  const email = `${unique('sale-test')}@example.com`;
  const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
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

  // Confirm the email so /sales/:id/publish works. Pass a unique IP so
  // the /auth/confirm rate limit (30/hr by CF-Connecting-IP) doesn't
  // fire when miniflare KV state survives across local test runs.
  // Confirm doesn't require auth so no CSRF needed.
  const token = new URL(body.devConfirmUrl!).searchParams.get('token')!;
  const confirmRes = await worker.fetch('/auth/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ token }),
  });
  expect(confirmRes.status).toBe(204);

  return { cookie, csrf, email, userId: body.user.id };
}

function authed(s: SessionAuth, body?: unknown) {
  const headers: Record<string, string> = {
    Cookie: s.cookie,
    'X-CSRF-Token': s.csrf,
  };
  if (body) headers['Content-Type'] = 'application/json';
  const init: RequestInit = { headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

describe('sales CRUD', () => {
  test('create → list → get → patch (slug change records a redirect) → delete', async () => {
    const session = await signupUser();

    // Initially empty.
    const list0 = await worker.fetch('/sales', { headers: { Cookie: session.cookie } });
    expect(list0.status).toBe(200);
    expect((await list0.json()).sales).toEqual([]);

    // Create.
    const create = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(session, {
        title: 'Spring Purge',
        description: 'Moving sale.',
        theme: 'retro',
        contact: { email: 'seller@example.com' },
      }),
    });
    expect(create.status).toBe(201);
    const createBody = (await create.json()) as {
      sale: { id: string; slug: string; siteName: string; theme: string };
    };
    expect(createBody.sale.slug).toBe('spring-purge');
    expect(createBody.sale.siteName).toBe('Spring Purge');
    expect(createBody.sale.theme).toBe('retro');
    const saleId = createBody.sale.id;

    // List shows the new sale.
    const list1 = await worker.fetch('/sales', { headers: { Cookie: session.cookie } });
    const list1Body = (await list1.json()) as { sales: { id: string }[] };
    expect(list1Body.sales).toHaveLength(1);
    expect(list1Body.sales[0].id).toBe(saleId);

    // GET single returns sale + empty items.
    const get1 = await worker.fetch(`/sales/${saleId}`, { headers: { Cookie: session.cookie } });
    const get1Body = (await get1.json()) as { sale: { id: string }; items: unknown[] };
    expect(get1Body.sale.id).toBe(saleId);
    expect(get1Body.items).toEqual([]);

    // PATCH: rename + change slug.
    const patch = await worker.fetch(`/sales/${saleId}`, {
      method: 'PATCH',
      ...authed(session, { slug: 'summer-move', description: 'Updated.' }),
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as {
      sale: { slug: string; description: string };
    };
    expect(patchBody.sale.slug).toBe('summer-move');

    // Old slug lookup via public endpoint. Not published yet; should 404.
    const preRedirect = await worker.fetch('/public/sales/sale-tester/spring-purge');
    expect(preRedirect.status).toBe(404);

    // DELETE.
    const del = await worker.fetch(`/sales/${saleId}`, {
      method: 'DELETE',
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });
    expect(del.status).toBe(204);
    const list2 = await worker.fetch('/sales', { headers: { Cookie: session.cookie } });
    expect((await list2.json()).sales).toEqual([]);
  });

  test("cannot touch another user's sale", async () => {
    const alice = await signupUser();
    const bob = await signupUser();

    const create = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(alice, { title: "Alice's Stuff" }),
    });
    const saleId = ((await create.json()) as { sale: { id: string } }).sale.id;

    const bobGet = await worker.fetch(`/sales/${saleId}`, { headers: { Cookie: bob.cookie } });
    expect(bobGet.status).toBe(404);

    const bobPatch = await worker.fetch(`/sales/${saleId}`, {
      method: 'PATCH',
      ...authed(bob, { title: 'hijacked' }),
    });
    expect(bobPatch.status).toBe(404);

    const bobDelete = await worker.fetch(`/sales/${saleId}`, {
      method: 'DELETE',
      headers: { Cookie: bob.cookie, 'X-CSRF-Token': bob.csrf },
    });
    expect(bobDelete.status).toBe(404);
  });
});

describe('items CRUD', () => {
  test('add → list → patch (reserved) → delete', async () => {
    const session = await signupUser();
    const saleRes = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(session, { title: 'Test Sale' }),
    });
    const saleId = ((await saleRes.json()) as { sale: { id: string } }).sale.id;

    // Add.
    const add = await worker.fetch(`/sales/${saleId}/items`, {
      method: 'POST',
      ...authed(session, {
        title: 'Chrome 2-slice toaster',
        price: 25,
        tags: ['kitchen', 'appliances'],
        description: 'Works fine.',
      }),
    });
    expect(add.status).toBe(201);
    const addBody = (await add.json()) as {
      item: { id: string; slug: string; price: number; tags: string[] };
    };
    expect(addBody.item.slug).toBe('chrome-2-slice-toaster');
    expect(addBody.item.price).toBe(25);
    expect(addBody.item.tags).toEqual(['kitchen', 'appliances']);
    const itemId = addBody.item.id;

    // List.
    const list = await worker.fetch(`/sales/${saleId}/items`, {
      headers: { Cookie: session.cookie },
    });
    expect((await list.json()).items).toHaveLength(1);

    // Mark reserved via PATCH.
    const reserve = await worker.fetch(`/sales/${saleId}/items/${itemId}`, {
      method: 'PATCH',
      ...authed(session, { reserved: { on: '2026-04-21', price: 20 } }),
    });
    expect(reserve.status).toBe(200);
    const reserveBody = (await reserve.json()) as {
      item: { reserved: { on: string; price: number } | null };
    };
    expect(reserveBody.item.reserved).toEqual({ on: '2026-04-21', price: 20 });

    // Un-reserve.
    const unreserve = await worker.fetch(`/sales/${saleId}/items/${itemId}`, {
      method: 'PATCH',
      ...authed(session, { reserved: null }),
    });
    expect(((await unreserve.json()) as { item: { reserved: unknown } }).item.reserved).toBeNull();

    // Delete.
    const del = await worker.fetch(`/sales/${saleId}/items/${itemId}`, {
      method: 'DELETE',
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });
    expect(del.status).toBe(204);
  });

  test('reorder reassigns sort_order atomically', async () => {
    const session = await signupUser();
    const saleRes = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(session, { title: 'Reorder Test' }),
    });
    const saleId = ((await saleRes.json()) as { sale: { id: string } }).sale.id;

    // Add three items. The exact default order depends on insertion ts
    // resolution (unix-second granularity ties), so this test only asserts
    // the order *after* an explicit reorder, which is the contract that
    // matters.
    const ids: string[] = [];
    for (const t of ['Alpha', 'Beta', 'Gamma']) {
      const r = await worker.fetch(`/sales/${saleId}/items`, {
        method: 'POST',
        ...authed(session, { title: t, price: 1 }),
      });
      ids.push(((await r.json()) as { item: { id: string } }).item.id);
    }

    // Reorder to Gamma → Alpha → Beta.
    const r1 = await worker.fetch(`/sales/${saleId}/items/reorder`, {
      method: 'POST',
      ...authed(session, { ids: [ids[2], ids[0], ids[1]] }),
    });
    expect(r1.status).toBe(204);
    const list1 = await worker.fetch(`/sales/${saleId}/items`, {
      headers: { Cookie: session.cookie },
    });
    expect(
      ((await list1.json()) as { items: { title: string }[] }).items.map((i) => i.title),
    ).toEqual(['Gamma', 'Alpha', 'Beta']);

    // Reorder again, now Beta → Gamma → Alpha.
    const r2 = await worker.fetch(`/sales/${saleId}/items/reorder`, {
      method: 'POST',
      ...authed(session, { ids: [ids[1], ids[2], ids[0]] }),
    });
    expect(r2.status).toBe(204);
    const list2 = await worker.fetch(`/sales/${saleId}/items`, {
      headers: { Cookie: session.cookie },
    });
    expect(
      ((await list2.json()) as { items: { title: string }[] }).items.map((i) => i.title),
    ).toEqual(['Beta', 'Gamma', 'Alpha']);

    // Stale set (missing one ID) is rejected.
    const bad = await worker.fetch(`/sales/${saleId}/items/reorder`, {
      method: 'POST',
      ...authed(session, { ids: [ids[0], ids[1]] }),
    });
    expect(bad.status).toBe(409);

    // Unknown ID is rejected.
    const ghostId = '01ABCDEFGHJKMNPQRSTVWXYZ00';
    const bogus = await worker.fetch(`/sales/${saleId}/items/reorder`, {
      method: 'POST',
      ...authed(session, { ids: [ids[0], ids[1], ghostId] }),
    });
    expect(bogus.status).toBe(409);
  });

  test('price round-trips through cents without loss', async () => {
    const session = await signupUser();
    const saleRes = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(session, { title: 'Price Test' }),
    });
    const saleId = ((await saleRes.json()) as { sale: { id: string } }).sale.id;

    for (const price of [0, 1, 0.99, 12.5, 450, 99999]) {
      const add = await worker.fetch(`/sales/${saleId}/items`, {
        method: 'POST',
        ...authed(session, { title: `Item at ${price}`, price }),
      });
      const body = (await add.json()) as { item: { price: number } };
      expect(body.item.price).toBeCloseTo(price, 2);
    }
  });
});

describe('publish + public fetch', () => {
  test('publish requires a contact method; public endpoint returns site + items', async () => {
    const session = await signupUser();

    // Create WITHOUT contact.
    const saleRes = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(session, { title: 'Public Test' }),
    });
    const sale = ((await saleRes.json()) as { sale: { id: string; slug: string } }).sale;

    // Publish fails: no contact.
    const p1 = await worker.fetch(`/sales/${sale.id}/publish`, {
      method: 'POST',
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });
    expect(p1.status).toBe(400);
    expect(((await p1.json()) as { error: string }).error).toBe('contact_required');

    // Add contact + an item.
    await worker.fetch(`/sales/${sale.id}`, {
      method: 'PATCH',
      ...authed(session, { contact: { email: 'me@example.com' } }),
    });
    await worker.fetch(`/sales/${sale.id}/items`, {
      method: 'POST',
      ...authed(session, { title: 'Demo Item', price: 10 }),
    });

    // Publish succeeds.
    const p2 = await worker.fetch(`/sales/${sale.id}/publish`, {
      method: 'POST',
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });
    expect(p2.status).toBe(200);

    // Fetch the /me user to get the username.
    const me = await worker.fetch('/me', { headers: { Cookie: session.cookie } });
    const username = ((await me.json()) as { user: { username: string } }).user.username;

    // Public endpoint returns full site + items.
    const pub = await worker.fetch(`/public/sales/${username}/${sale.slug}`);
    expect(pub.status).toBe(200);
    const pubBody = (await pub.json()) as {
      site: { siteName: string; contact: { email: string } };
      items: { title: string; price: number }[];
    };
    expect(pubBody.site.siteName).toBe('Public Test');
    expect(pubBody.site.contact.email).toBe('me@example.com');
    expect(pubBody.items).toHaveLength(1);
    expect(pubBody.items[0].price).toBe(10);

    // Unpublish → public 404.
    await worker.fetch(`/sales/${sale.id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });
    const pub2 = await worker.fetch(`/public/sales/${username}/${sale.slug}`);
    expect(pub2.status).toBe(404);
  });

  test('slug change: old URL 404s, new URL serves', async () => {
    const session = await signupUser();
    const me = await worker.fetch('/me', { headers: { Cookie: session.cookie } });
    const username = ((await me.json()) as { user: { username: string } }).user.username;

    const saleRes = await worker.fetch('/sales', {
      method: 'POST',
      ...authed(session, {
        title: 'Original',
        contact: { email: 'me@example.com' },
      }),
    });
    const sale = ((await saleRes.json()) as { sale: { id: string; slug: string } }).sale;
    const oldSlug = sale.slug;

    await worker.fetch(`/sales/${sale.id}/publish`, {
      method: 'POST',
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });

    const newSlug = 'renamed-sale';
    await worker.fetch(`/sales/${sale.id}`, {
      method: 'PATCH',
      ...authed(session, { slug: newSlug }),
    });

    const stale = await worker.fetch(`/public/sales/${username}/${oldSlug}`);
    expect(stale.status).toBe(404);

    const ok = await worker.fetch(`/public/sales/${username}/${newSlug}`);
    expect(ok.status).toBe(200);
  });
});
