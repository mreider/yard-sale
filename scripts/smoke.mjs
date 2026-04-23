#!/usr/bin/env node
/**
 * Prod smoke test. Exercises the full seller flow against api.yrdsl.app
 * using a long-lived, email-confirmed test account seeded by
 * scripts/seed-smoke-user.mjs.
 *
 * Every artifact (sale, item, token) is prefixed `smoke_<run-id>_` so
 * the reaper can sweep orphans from aborted runs.
 *
 * Required env:
 *   API_URL, PUBLIC_URL, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_USERNAME, RUN_ID
 *
 * Exits non-zero on any failure. Attempts cleanup regardless.
 */

const API = mustEnv('API_URL');
const EMAIL = mustEnv('SMOKE_EMAIL');
const PASSWORD = mustEnv('SMOKE_PASSWORD');
const USERNAME = mustEnv('SMOKE_USERNAME');
const RUN_ID = mustEnv('RUN_ID');

const PREFIX = `smoke_${RUN_ID}_`;

const jar = new Map(); // cookie name -> value

function setCookies(res) {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const [pair] = c.split(';');
    const [name, ...rest] = pair.split('=');
    const v = rest.join('=').trim();
    // "deleted"-style cookies come back with Max-Age=0 and empty value; mirror that.
    if (v === '') jar.delete(name.trim());
    else jar.set(name.trim(), v);
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function csrf() {
  return jar.get('__ys_csrf') ?? '';
}

async function req(method, path, body, opts = {}) {
  const headers = { Cookie: cookieHeader(), ...(opts.headers ?? {}) };
  if (body != null && !(body instanceof Uint8Array)) {
    headers['Content-Type'] = 'application/json';
  }
  const csrfVal = csrf();
  if (csrfVal) headers['X-CSRF-Token'] = csrfVal;

  const fetchBody =
    body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body);

  const res = await fetch(`${API}${path}`, { method, headers, body: fetchBody });
  setCookies(res);
  const text = opts.raw ? null : await res.text();
  let json = null;
  if (!opts.raw && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text };
    }
  }
  return {
    status: res.status,
    body: json,
    headers: res.headers,
    bytes: opts.raw ? await res.arrayBuffer() : null,
  };
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(2);
  }
  return v;
}

function die(step, r) {
  console.error(`::error::${step} failed. status=${r.status} body=${JSON.stringify(r.body)}`);
  throw new Error(`${step} failed`);
}
function check(step, r, expect) {
  if (Array.isArray(expect) ? !expect.includes(r.status) : r.status !== expect) die(step, r);
  console.log(`✓ ${step}`);
}

const created = {
  saleIds: [],
  tokenIds: [],
};

async function cleanup() {
  console.log('--- cleanup ---');
  for (const id of created.tokenIds) {
    const r = await req('DELETE', `/me/tokens/${id}`);
    console.log(`cleanup token ${id}: ${r.status}`);
  }
  for (const id of created.saleIds) {
    const r = await req('DELETE', `/sales/${id}`);
    console.log(`cleanup sale ${id}: ${r.status}`);
  }
  const lo = await req('POST', '/auth/logout');
  console.log(`cleanup logout: ${lo.status}`);
}

/**
 * Scrypt on Cloudflare Workers occasionally hits the 30s CPU budget
 * on cold starts and returns a 503 "Worker exceeded resource limits"
 * page. A real user hits Retry and it works. The smoke needs to do the
 * same — otherwise we page ourselves on flakes that a user would never
 * see. One retry with a short delay.
 */
async function loginWithRetry() {
  const first = await req('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (first.status === 200) return first;
  if (first.status !== 503) return first; // not a CPU flake; surface normally
  console.log('login got 503 (Worker CPU); retrying in 2s…');
  await new Promise((r) => setTimeout(r, 2000));
  return req('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
}

async function main() {
  console.log(`smoke run ${RUN_ID} against ${API}`);

  // ─── auth ─────────────────────────────────────────────────────
  check('login', await loginWithRetry(), 200);

  const me = await req('GET', '/me');
  check('GET /me', me, 200);
  const userId = me.body?.user?.id;

  // No-op patch (keep current prefs)
  check(
    'PATCH /me (no-op)',
    await req('PATCH', '/me', {
      defaultLanguage: me.body.user.defaultLanguage,
      defaultTheme: me.body.user.defaultTheme,
    }),
    200,
  );

  // ─── sale CRUD ────────────────────────────────────────────────
  const createSale = await req('POST', '/sales', { title: `${PREFIX}sale` });
  check('POST /sales', createSale, 201);
  const saleId = createSale.body.sale.id;
  created.saleIds.push(saleId);
  const slug = createSale.body.sale.slug;

  check('GET /sales', await req('GET', '/sales'), 200);
  check('GET /sales/:id', await req('GET', `/sales/${saleId}`), 200);

  // ─── items CRUD ────────────────────────────────────────────────
  const addItem1 = await req('POST', `/sales/${saleId}/items`, {
    title: `${PREFIX}item-one`,
    price: 12,
    tags: ['smoke'],
  });
  check('POST /sales/:id/items (#1)', addItem1, 201);
  const itemId1 = addItem1.body.item.id;

  const addItem2 = await req('POST', `/sales/${saleId}/items`, {
    title: `${PREFIX}item-two`,
    price: 34,
    description: 'second',
  });
  check('POST /sales/:id/items (#2)', addItem2, 201);
  const itemId2 = addItem2.body.item.id;

  check(
    'PATCH /sales/:id/items/:itemId',
    await req('PATCH', `/sales/${saleId}/items/${itemId1}`, { price: 15 }),
    200,
  );

  check(
    'POST /sales/:id/items/reorder',
    await req('POST', `/sales/${saleId}/items/reorder`, { ids: [itemId2, itemId1] }),
    204,
  );

  check('GET /sales/:id/items', await req('GET', `/sales/${saleId}/items`), 200);

  check(
    'DELETE /sales/:id/items/:itemId',
    await req('DELETE', `/sales/${saleId}/items/${itemId2}`),
    [200, 204],
  );

  // ─── publish flow ──────────────────────────────────────────────
  check(
    'PATCH /sales/:id (contact)',
    await req('PATCH', `/sales/${saleId}`, { contact: { email: EMAIL } }),
    200,
  );
  check('POST /sales/:id/publish', await req('POST', `/sales/${saleId}/publish`), 200);

  // Public viewer endpoint is unauthenticated; skip cookie jar by using bare fetch.
  const pub = await fetch(`${API}/public/sales/${USERNAME}/${slug}`);
  if (pub.status !== 200) die('GET /public/sales/:u/:slug', { status: pub.status, body: null });
  console.log('✓ GET /public/sales/:u/:slug');

  check('POST /sales/:id/unpublish', await req('POST', `/sales/${saleId}/unpublish`), 204);

  // ─── export ────────────────────────────────────────────────────
  const exp = await req('GET', `/sales/${saleId}/export`, null, { raw: true });
  if (exp.status !== 200) die('GET /sales/:id/export', exp);
  const expCt = exp.headers.get('content-type') ?? '';
  if (!expCt.includes('zip'))
    die('GET /sales/:id/export (content-type)', { status: exp.status, body: expCt });
  console.log(`✓ GET /sales/:id/export (${exp.bytes?.byteLength ?? 0} bytes, ${expCt})`);

  // ─── tokens ────────────────────────────────────────────────────
  check('GET /me/tokens', await req('GET', '/me/tokens'), 200);

  const createTok = await req('POST', '/me/tokens', {
    name: `${PREFIX}token`,
    scope: 'read',
    expiry: 'none',
  });
  check('POST /me/tokens', createTok, 201);
  const tokId = createTok.body?.token?.id;
  if (!tokId) die('POST /me/tokens (missing id)', createTok);
  created.tokenIds.push(tokId);

  check('DELETE /me/tokens/:id', await req('DELETE', `/me/tokens/${tokId}`), [200, 204]);
  // Popping it out of cleanup list since we already deleted it successfully.
  created.tokenIds.pop();

  console.log(`smoke run ${RUN_ID} all green`);
}

main()
  .catch((e) => {
    console.error(`::error::smoke failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
