/**
 * Transport-agnostic library entry point. Everything a future MCP
 * transport (HTTP, WebSocket, ...) needs to serve yrdsl.app without
 * pulling in the stdio-specific bootstrap in `./index.ts`.
 *
 * Stable import from downstream: `@yrdsl/mcp/core`. The stdio CLI
 * (`./index.ts`, exposed via the `yrdsl-mcp` / `mcp` bins) composes on
 * top of this; a future `mcp.yrdsl.app` Cloudflare Worker would import
 * from here and wire its own transport.
 *
 * Import shape:
 *
 *   import {
 *     HostedApiBackend,
 *     wireToolHandlers,
 *     tools,
 *     zodToJsonSchema,
 *     type Backend,
 *   } from '@yrdsl/mcp/core';
 *
 *   const server = new Server({ name: 'yrdsl-mcp', version: '1.0.0' }, ...);
 *   const backend = new HostedApiBackend({ apiUrl, token });
 *   wireToolHandlers(server, backend);
 *   await server.connect(someHttpTransport);
 *
 * That's the whole contract.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Backend } from './backends/types.js';
import { tools, zodToJsonSchema } from './tools.js';

// ─── Types ───────────────────────────────────────────────────────────────
export type {
  Backend,
  AddItemInput,
  UpdateItemInput,
  UpdateSiteInput,
  MarkReservedInput,
  CreateSaleInput,
  SaleItem,
  SaleSite,
  SaleSummary,
  SaleContact,
  ReservationInfo,
} from './backends/types.js';
export type { ToolDef } from './tools.js';

// ─── Concrete backends ───────────────────────────────────────────────────
// HostedApiBackend talks to api.yrdsl.app over HTTPS with a bearer token.
// LocalFileBackend reads/writes site.json + items.json on disk — not usable
// in edge-runtime environments without a filesystem (e.g. Cloudflare
// Workers). Remote transports should use HostedApiBackend.
export { HostedApiBackend } from './backends/hosted.js';
export { LocalFileBackend } from './backends/local.js';

// ─── Tool registry + helpers ─────────────────────────────────────────────
export { tools, zodToJsonSchema };
export { decodeImageData } from './backends/hosted.js';
export { draftItemFromUrl, parseDraftFromHtml } from './draft.js';

/**
 * Wire the `tools/list` and `tools/call` handlers onto an MCP `Server`.
 * Any transport that produces a `Server` instance can call this; the
 * transport itself is not the library's concern.
 *
 * Centralizes the dispatch logic so stdio and future HTTP entry points
 * don't drift. Error handling mirrors what Claude Desktop expects:
 * invalid args / handler throws become `{ isError: true, content: [...] }`
 * instead of bubbling as protocol errors.
 */
export function wireToolHandlers(server: Server, backend: Backend): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(tools).map(([name, t]) => ({
      name,
      description: `${t.description} [mode: ${backend.mode}]`,
      inputSchema: zodToJsonSchema(t.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools[req.params.name];
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    let parsed: Record<string, unknown>;
    try {
      parsed = tool.schema.parse(req.params.arguments ?? {}) as Record<string, unknown>;
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid arguments: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
      };
    }
    try {
      const result = await tool.handler(backend, parsed);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
      };
    }
  });
}
