#!/usr/bin/env node
/**
 * MCP smoke test. Spawns `npx -y -p @yrdsl/mcp yrdsl-mcp` in BOTH hosted
 * and local modes, exercises the same tool flow against each, and
 * asserts tool-list consistency between them.
 *
 * Setup: logs in as the smoke account, creates a scratch sale + write
 * token (hosted), clones yrdsl-self-hosted into a tmpdir (local), then
 * runs the MCP against each.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Valid-enough JPEG that passes the server's sniff (FF D8 FF) and its
// 200-byte minimum. Structure: SOI + APP0(JFIF) + COM segment padded to
// 200 bytes + EOI. ≈226 bytes total.
const TINY_JPEG = (() => {
  const header = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
  ];
  const comPayload = new Array(200).fill(0x20); // spaces, opaque to decoders
  const comSeg = [0xff, 0xfe, 0x00, 0xca, ...comPayload]; // len=202 (0x00CA) incl. len bytes
  const eoi = [0xff, 0xd9];
  return Uint8Array.from([...header, ...comSeg, ...eoi]);
})();

const API = mustEnv('API_URL');
const EMAIL = mustEnv('SMOKE_EMAIL');
const PASSWORD = mustEnv('SMOKE_PASSWORD');
const RUN_ID = mustEnv('RUN_ID');

const PREFIX = `smoke_mcp_${RUN_ID}_`;
const SELFHOSTED_REPO = 'https://github.com/KuvopLLC/yrdsl-self-hosted.git';

// ─── API helpers (for hosted setup/cleanup) ─────────────────────
const jar = new Map();
function setCookies(res) {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const [pair] = c.split(';');
    const [name, ...rest] = pair.split('=');
    const v = rest.join('=').trim();
    if (v === '') jar.delete(name.trim());
    else jar.set(name.trim(), v);
  }
}
const cookieHdr = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
const csrf = () => jar.get('__ys_csrf') ?? '';

async function apiReq(method, path, body) {
  const headers = { Cookie: cookieHdr() };
  if (body != null) headers['Content-Type'] = 'application/json';
  const c = csrf();
  if (c) headers['X-CSRF-Token'] = c;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  setCookies(res);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, body: json };
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(2);
  }
  return v;
}

function die(step, detail) {
  console.error(`::error::${step} failed. ${detail}`);
  throw new Error(`${step} failed`);
}

const created = { saleId: null, tokenId: null, workdir: null };

async function cleanup() {
  console.log('--- cleanup ---');
  if (created.tokenId) {
    const r = await apiReq('DELETE', `/me/tokens/${created.tokenId}`);
    console.log(`cleanup token ${created.tokenId}: ${r.status}`);
  }
  if (created.saleId) {
    const r = await apiReq('DELETE', `/sales/${created.saleId}`);
    console.log(`cleanup sale ${created.saleId}: ${r.status}`);
  }
  if (jar.size > 0) {
    const lo = await apiReq('POST', '/auth/logout');
    console.log(`cleanup logout: ${lo.status}`);
  }
  if (created.workdir && existsSync(created.workdir)) {
    rmSync(created.workdir, { recursive: true, force: true });
    console.log(`cleanup workdir: removed ${created.workdir}`);
  }
}

// ─── MCP stdio client ───────────────────────────────────────────
class McpClient {
  constructor(child, label) {
    this.label = label;
    this.child = child;
    this.buf = '';
    this.pending = new Map();
    this.nextId = 1;
    child.stdout.on('data', (chunk) => this.onStdout(chunk.toString()));
    child.stderr.on('data', (chunk) => process.stderr.write(`[${label}-stderr] ${chunk}`));
    child.on('exit', (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`mcp(${label}) exited ${code}`));
    });
  }
  onStdout(text) {
    this.buf += text;
    for (;;) {
      const idx = this.buf.indexOf('\n');
      if (idx === -1) break;
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stderr.write(`[${this.label}-unparsed] ${line}\n`);
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  }
  send(method, params) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout on ${method}`));
        }
      }, 20000);
    });
  }
  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
  stop() {
    try {
      this.child.kill('SIGTERM');
    } catch {}
  }
}

function spawnMcp(env, label) {
  console.log(`spawning @yrdsl/mcp in ${label} mode...`);
  // `@latest` forces npx to fetch the newest published version rather than
  // reusing a stale runner cache. The `mcp` bin alias (added in 0.1.1)
  // resolves via the scoped-package-last-segment rule.
  return spawn('npx', ['-y', '@yrdsl/mcp@latest'], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function textOf(result) {
  return result?.content?.[0]?.text ?? '';
}

// Run the core tool battery against an already-initialized client. Returns
// the list of tool names (from tools/list) so the caller can diff modes.
// `saleRef` pins tool calls to a specific sale (useful in hosted mode
// when the account may have more than one smoke sale in flight); in
// local mode it's harmless — the backend ignores it.
async function runBattery(client, expectedSaleMarker, itemTitle, saleRef) {
  // initialize
  const init = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-mcp', version: '1.0' },
  });
  if (!init?.serverInfo?.name) die(`initialize(${client.label})`, 'no serverInfo');
  console.log(`  ✓ initialize (server: ${init.serverInfo.name})`);
  client.notify('notifications/initialized');

  const tools = await client.send('tools/list');
  if (!Array.isArray(tools?.tools) || tools.tools.length < 5) {
    die(`tools/list(${client.label})`, `got ${tools?.tools?.length}`);
  }
  console.log(`  ✓ tools/list (${tools.tools.length} tools)`);

  const sales = await client.send('tools/call', { name: 'list_sales', arguments: {} });
  if (!Array.isArray(JSON.parse(textOf(sales)))) {
    die(`list_sales(${client.label})`, `bad response: ${textOf(sales).slice(0, 200)}`);
  }
  console.log('  ✓ list_sales');

  const saleArg = saleRef ? { sale: saleRef } : {};
  const site = await client.send('tools/call', { name: 'get_site', arguments: saleArg });
  if (!textOf(site).includes(expectedSaleMarker)) {
    die(`get_site(${client.label})`, `missing "${expectedSaleMarker}"`);
  }
  console.log('  ✓ get_site');

  await client.send('tools/call', { name: 'list_items', arguments: saleArg });
  console.log('  ✓ list_items (before add)');

  const add = await client.send('tools/call', {
    name: 'add_item',
    arguments: { ...saleArg, title: itemTitle, price: 9 },
  });
  if (add?.isError) die(`add_item(${client.label})`, JSON.stringify(add));
  let addedItem;
  try {
    addedItem = JSON.parse(textOf(add));
  } catch {
    die(`add_item(${client.label})`, `non-JSON result: ${textOf(add).slice(0, 200)}`);
  }
  if (!addedItem?.id && !addedItem?.slug) {
    die(`add_item(${client.label})`, `result missing id/slug: ${textOf(add).slice(0, 200)}`);
  }
  console.log('  ✓ add_item');

  const items = await client.send('tools/call', { name: 'list_items', arguments: saleArg });
  if (!textOf(items).includes(itemTitle)) {
    die(`list_items-after(${client.label})`, `missing "${itemTitle}"`);
  }
  console.log('  ✓ list_items (after add)');

  // attach_image_from_path — exercises readLocalImage in both modes.
  // Regression guard for 0.4.5 "require is not defined" crash that only
  // surfaced at runtime. Writes a tiny valid JPEG to disk and attaches it.
  const imgPath = join(tmpdir(), `smoke-mcp-${RUN_ID}-${client.label}.jpg`);
  writeFileSync(imgPath, TINY_JPEG);
  const attach = await client.send('tools/call', {
    name: 'attach_image_from_path',
    arguments: { ...saleArg, id: addedItem.id ?? addedItem.slug, path: imgPath },
  });
  if (attach?.isError) {
    die(`attach_image_from_path(${client.label})`, textOf(attach).slice(0, 400));
  }
  console.log('  ✓ attach_image_from_path');

  return tools.tools.map((t) => t.name).sort();
}

function cloneSelfHosted() {
  const dir = mkdtempSync(join(tmpdir(), `yrdsl-local-${RUN_ID}-`));
  console.log(`cloning self-hosted template into ${dir}...`);
  const r = spawnSync('git', ['clone', '--depth', '1', SELFHOSTED_REPO, dir], {
    stdio: 'inherit',
  });
  if (r.status !== 0) die('clone self-hosted', `exit ${r.status}`);
  // Verify expected files exist.
  if (!existsSync(join(dir, 'site.json')) || !existsSync(join(dir, 'items.json'))) {
    die('clone self-hosted', 'missing site.json or items.json');
  }
  return dir;
}

/**
 * Retry login once on 503. Scrypt occasionally trips the Worker CPU
 * limit on cold starts — a real user would just retry.
 */
async function loginWithRetry() {
  const first = await apiReq('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (first.status === 200) return first;
  if (first.status !== 503) return first;
  console.log('login got 503 (Worker CPU); retrying in 2s…');
  await new Promise((r) => setTimeout(r, 2000));
  return apiReq('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
}

async function main() {
  console.log(`mcp smoke run ${RUN_ID} against ${API}`);

  // ─── hosted setup ─────────────────────────────────────────────
  const login = await loginWithRetry();
  if (login.status !== 200) die('login', `status=${login.status}`);
  const cs = await apiReq('POST', '/sales', { title: `${PREFIX}sale` });
  if (cs.status !== 201) die('create sale', `status=${cs.status}`);
  created.saleId = cs.body.sale.id;
  const ct = await apiReq('POST', '/me/tokens', {
    name: `${PREFIX}token`,
    scope: 'write',
    expiry: 'none',
  });
  if (ct.status !== 201) die('create token', `status=${ct.status}`);
  created.tokenId = ct.body.token.id;

  // ─── local setup ──────────────────────────────────────────────
  created.workdir = cloneSelfHosted();
  const localSite = JSON.parse(readFileSync(join(created.workdir, 'site.json'), 'utf8'));

  // ─── phase A: hosted mode ─────────────────────────────────────
  console.log('\n=== phase A: HOSTED ===');
  // Hosted mode is account-wide in 0.2+; no YRDSL_SALE_ID. The smoke
  // account has exactly one sale during this run, so tool calls without
  // an explicit `sale` arg resolve it implicitly.
  const mcpHosted = spawnMcp(
    {
      YRDSL_MODE: 'hosted',
      YRDSL_API_URL: API,
      YRDSL_API_TOKEN: ct.body.secret,
    },
    'hosted',
  );
  const hostedClient = new McpClient(mcpHosted, 'hosted');
  let hostedTools;
  try {
    hostedTools = await runBattery(
      hostedClient,
      `${PREFIX}sale`,
      `${PREFIX}hosted-item`,
      cs.body.sale.slug,
    );
  } finally {
    hostedClient.stop();
  }

  // ─── phase B: local mode ──────────────────────────────────────
  console.log('\n=== phase B: LOCAL ===');
  const mcpLocal = spawnMcp(
    {
      YRDSL_MODE: 'local',
      YRDSL_REPO: created.workdir,
    },
    'local',
  );
  const localClient = new McpClient(mcpLocal, 'local');
  let localTools;
  try {
    localTools = await runBattery(localClient, localSite.siteName, `${PREFIX}local-item`);
  } finally {
    localClient.stop();
  }

  // ─── consistency check ────────────────────────────────────────
  console.log('\n=== consistency ===');
  const hostedSet = JSON.stringify(hostedTools);
  const localSet = JSON.stringify(localTools);
  if (hostedSet !== localSet) {
    console.error(`::error::hosted tools: ${hostedSet}`);
    console.error(`::error::local  tools: ${localSet}`);
    die('consistency', 'hosted and local expose different tool lists');
  }
  console.log(`✓ hosted and local expose the same ${hostedTools.length} tools`);
  console.log(`  tools: ${hostedTools.join(', ')}`);

  // Verify items.json on disk got updated by local mode.
  const items = JSON.parse(readFileSync(join(created.workdir, 'items.json'), 'utf8'));
  const arr = Array.isArray(items) ? items : items.items;
  if (!arr?.some((i) => i.title === `${PREFIX}local-item`)) {
    die('local persistence', 'add_item did not write to items.json');
  }
  console.log('✓ local mode persisted add_item to items.json');

  console.log(`\nmcp smoke run ${RUN_ID} all green`);
}

main()
  .catch((e) => {
    console.error(`::error::mcp smoke failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
