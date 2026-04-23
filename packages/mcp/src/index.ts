#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * yrdsl-mcp: single MCP server for yrdsl.app, two backends.
 *
 * Hosted (account-scoped; talks to api.yrdsl.app with a bearer token):
 *   YRDSL_MODE=hosted YRDSL_API_TOKEN=yrs_live_… yrdsl-mcp
 *   (YRDSL_API_URL defaults to https://api.yrdsl.app)
 *
 * Local self-hosted (edits site.json + items.json in a yrdsl-self-hosted fork):
 *   YRDSL_MODE=local YRDSL_REPO=/path/to/your/yrdsl-fork yrdsl-mcp
 *
 * Mode autodetect: YRDSL_API_TOKEN → hosted, YRDSL_REPO → local.
 *
 * Sale selection: hosted mode is account-wide. Tools take an optional
 * `sale` arg (slug or id). When omitted and the user has exactly one
 * sale, that sale is used implicitly. Call `list_sales` to enumerate.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HostedApiBackend } from './backends/hosted.js';
import { LocalFileBackend } from './backends/local.js';
import type { Backend } from './backends/types.js';
import { wireToolHandlers } from './core.js';

/**
 * Read the package version at runtime so serverInfo stays in sync with
 * package.json across bumps. The compiled file sits at dist/index.js,
 * so package.json is two directories up.
 */
const VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function pickBackend(): Backend {
  const explicit = process.env.YRDSL_MODE?.toLowerCase();

  if (explicit === 'hosted' || (explicit !== 'local' && process.env.YRDSL_API_TOKEN)) {
    const token = process.env.YRDSL_API_TOKEN;
    if (!token) {
      throw new Error('Hosted mode requires YRDSL_API_TOKEN.');
    }
    const apiUrl = process.env.YRDSL_API_URL ?? 'https://api.yrdsl.app';
    return new HostedApiBackend({ apiUrl, token });
  }

  const repoEnv = process.env.YRDSL_REPO;
  if (repoEnv) {
    return new LocalFileBackend(resolve(repoEnv));
  }

  // Last resort: cwd if it looks like a yrdsl-self-hosted fork.
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'site.json')) && existsSync(join(cwd, 'items.json'))) {
    return new LocalFileBackend(cwd);
  }

  throw new Error(
    'No backend configured. Set YRDSL_API_TOKEN for hosted, or YRDSL_REPO for local.',
  );
}

async function main(): Promise<void> {
  let backend: Backend;
  try {
    backend = pickBackend();
  } catch (e) {
    process.stderr.write(`yrdsl-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }

  const server = new Server(
    { name: 'yrdsl-mcp', version: VERSION },
    { capabilities: { tools: {} } },
  );
  wireToolHandlers(server, backend);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(
    `yrdsl-mcp fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exit(1);
});
