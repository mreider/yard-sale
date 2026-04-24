import { z } from 'zod';
import type { Backend, CreateSaleInput } from './backends/types.js';
import { draftItemFromUrl } from './draft.js';

/**
 * Single tool registry. Every tool dispatches via the Backend interface,
 * so the same MCP catalog works for hosted and local modes. A handful of
 * tools are mode-specific (publish/unpublish for hosted, commit_and_push
 * for local) and the underlying Backend method throws a clear message
 * when the user calls one on the wrong backend.
 */

export interface ToolDef {
  description: string;
  schema: z.ZodTypeAny;
  handler: (backend: Backend, args: Record<string, unknown>) => Promise<unknown>;
}

const SaleRefField = {
  sale: z
    .string()
    .optional()
    .describe(
      'Slug or id of the sale. Omit when the user has only one sale. Call list_sales to pick.',
    ),
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const tools: Record<string, ToolDef> = {
  list_sales: {
    description:
      'List every sale the signed-in user owns (slug, id, display name, publicUrl when published, editorUrl). ' +
      'Use the slug with other tools when the user has 2+ sales.',
    schema: z.object({}),
    handler: async (backend) => backend.listSales(),
  },

  create_sale: {
    description:
      '[hosted only] Create a new sale for the signed-in user. Required: `title`. ' +
      'Optional: description, theme (conservative/retro/hip/artsy), language, currency (ISO 4217), ' +
      'and contact (email/sms/whatsapp/notes). ' +
      'Returns the created sale summary including `editorUrl` — point the user there to finish ' +
      'setup and publish. Self-hosted users clone the template repo instead.',
    schema: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      theme: z.enum(['conservative', 'retro', 'hip', 'artsy']).optional(),
      language: z.string().optional(),
      currency: z.string().length(3).optional(),
      contact: z
        .object({
          email: z.string().email().optional(),
          sms: z.string().optional(),
          whatsapp: z.string().optional(),
          notes: z.string().optional(),
        })
        .optional(),
    }),
    handler: async (backend, args) =>
      backend.createSale({
        title: String(args.title),
        description: args.description as string | undefined,
        theme: args.theme as CreateSaleInput['theme'],
        language: args.language as string | undefined,
        currency: args.currency as string | undefined,
        contact: args.contact as CreateSaleInput['contact'],
      }),
  },

  get_site: {
    description:
      'Read the sale metadata (name, subtitle, theme, contact, currency, publicUrl, editorUrl).',
    schema: z.object({ ...SaleRefField }),
    handler: async (backend, args) => backend.getSite(str(args.sale)),
  },

  update_site: {
    description:
      'Patch fields on the sale metadata. Pass only what you want to change. ' +
      "`contact` is merged shallowly: passing `{ email: 'x' }` keeps existing sms/whatsapp.",
    schema: z.object({
      ...SaleRefField,
      siteName: z.string().optional(),
      subtitle: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional(),
      theme: z.enum(['conservative', 'retro', 'hip', 'artsy']).optional(),
      currency: z.string().length(3).optional(),
      language: z.string().optional(),
      contact: z
        .object({
          email: z.string().email().optional(),
          sms: z.string().optional(),
          whatsapp: z.string().optional(),
          notes: z.string().optional(),
        })
        .optional(),
    }),
    handler: async (backend, args) => {
      const { sale, ...patch } = args;
      return backend.updateSite(patch, str(sale));
    },
  },

  list_items: {
    description:
      'List every item with id, title, price, reserved status, and publicUrl (when the sale is published). ' +
      'If the list is empty, offer to draft an item from a product URL or a photo the user shares.',
    schema: z.object({ ...SaleRefField }),
    handler: async (backend, args) => {
      const items = await backend.listItems(str(args.sale));
      return items.map((i) => ({
        id: i.id,
        title: i.title,
        price: i.price,
        reserved: !!i.reserved,
        ...(i.publicUrl ? { publicUrl: i.publicUrl } : {}),
      }));
    },
  },

  get_item: {
    description: 'Get one item by id with all fields.',
    schema: z.object({ id: z.string(), ...SaleRefField }),
    handler: async (backend, args) => backend.getItem(String(args.id), str(args.sale)),
  },

  recent_items: {
    description:
      "List the N most-recently-added items. Use this to offer 'undo' after a batch of " +
      "`add_item` calls (e.g. 'I added these 4 things — want me to remove any?'). " +
      'Defaults to 5 items; pass `limit` to adjust. Pair with `delete_item` to actually remove.',
    schema: z.object({
      ...SaleRefField,
      limit: z.number().int().positive().max(50).optional(),
    }),
    handler: async (backend, args) => {
      const limit = typeof args.limit === 'number' ? args.limit : 5;
      const items = await backend.listItems(str(args.sale));
      // `added` is ISO-date-only (YYYY-MM-DD), so multiple items added the
      // same day tie on this sort. `updatedAt` is full ISO, used as a
      // tiebreaker since we update it on each change including creation.
      const sorted = [...items].sort((a, b) => {
        const dateCmp = (b.added ?? '').localeCompare(a.added ?? '');
        if (dateCmp !== 0) return dateCmp;
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      });
      return sorted.slice(0, limit).map((i) => ({
        id: i.id,
        title: i.title,
        price: i.price,
        added: i.added,
        reserved: !!i.reserved,
        ...(i.publicUrl ? { publicUrl: i.publicUrl } : {}),
      }));
    },
  },

  find_item: {
    description:
      'Find items matching a substring. Case-insensitive; checks title, description, and tags. ' +
      'Returns the top 10 matches with id, title, price, reserved status, and publicUrl. ' +
      'Use this before mark_reserved / update_item / delete_item when the user names an item ' +
      "by description ('mark the coffee maker sold') instead of id.",
    schema: z.object({
      ...SaleRefField,
      query: z.string().min(1).describe('Substring to look for.'),
    }),
    handler: async (backend, args) => {
      const needle = String(args.query).toLowerCase();
      const items = await backend.listItems(str(args.sale));
      const scored = items
        .map((i) => {
          const title = i.title.toLowerCase();
          const desc = (i.description ?? '').toLowerCase();
          const tags = i.tags.join(' ').toLowerCase();
          let score = 0;
          if (title.includes(needle)) score += 10;
          if (tags.includes(needle)) score += 3;
          if (desc.includes(needle)) score += 1;
          return { item: i, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(({ item: i }) => ({
          id: i.id,
          title: i.title,
          price: i.price,
          reserved: !!i.reserved,
          ...(i.publicUrl ? { publicUrl: i.publicUrl } : {}),
        }));
      return { query: args.query, matches: scored };
    },
  },

  add_item: {
    description:
      'Add a new item to the sale. Generates a slug from the title; ' +
      "price is in the sale's currency. " +
      'Returns the created item including `publicUrl` (when the sale is published) — ' +
      'include that URL in your reply so the user gets a shareable link they can send. ' +
      'For photos, use the right attach tool for the situation:\n' +
      '- `attach_image_from_path` — Claude Code with a local file path (preferred for real photos).\n' +
      '- `attach_image_from_url` — you have a public image URL (e.g. from `draft_item_from_url`).\n' +
      '- `attach_image_bytes` — last resort for tiny images only; client truncation makes this unreliable for >1 KB.\n' +
      'If none of those work (Claude.ai user with a chat-attached photo), tell them to drop the image into ' +
      "the web editor directly (see `editorUrl`). Don't put a source page URL in `image` — that field expects a direct image link.",
    schema: z.object({
      ...SaleRefField,
      title: z.string().min(1),
      price: z.number().nonnegative(),
      tags: z.array(z.string()).optional(),
      description: z.string().optional(),
      image: z.string().optional(),
    }),
    handler: async (backend, args) =>
      backend.addItem(
        {
          title: String(args.title),
          price: Number(args.price),
          tags: args.tags as string[] | undefined,
          description: args.description as string | undefined,
          image: args.image as string | undefined,
        },
        str(args.sale),
      ),
  },

  update_item: {
    description:
      'Patch fields on an existing item. Returns the updated item with its `publicUrl` ' +
      '(when the sale is published) — surface that link so the user can share the edit.',
    schema: z.object({
      ...SaleRefField,
      id: z.string(),
      title: z.string().optional(),
      price: z.number().nonnegative().optional(),
      tags: z.array(z.string()).optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      added: z.string().optional(),
    }),
    handler: async (backend, args) => {
      const { id, sale, ...patch } = args as {
        id: string;
        sale?: string;
      } & Record<string, unknown>;
      return backend.updateItem(id, patch, str(sale));
    },
  },

  delete_item: {
    description: 'Remove an item from the sale.',
    schema: z.object({ id: z.string(), ...SaleRefField }),
    handler: async (backend, args) => {
      await backend.deleteItem(String(args.id), str(args.sale));
      return { deleted: true, id: args.id };
    },
  },

  mark_reserved: {
    description:
      'Mark an item reserved. Date defaults to today, price defaults to the listed price. ' +
      'Returns the item with its `publicUrl` so the user can confirm the reserved state at the live link.',
    schema: z.object({
      ...SaleRefField,
      id: z.string(),
      on: z.string().optional(),
      price: z.number().nonnegative().optional(),
      note: z.string().optional(),
    }),
    handler: async (backend, args) =>
      backend.markReserved(
        String(args.id),
        {
          on: args.on as string | undefined,
          price: args.price as number | undefined,
          note: args.note as string | undefined,
        },
        str(args.sale),
      ),
  },

  unreserve: {
    description: 'Clear the reserved status on an item (back to available).',
    schema: z.object({ id: z.string(), ...SaleRefField }),
    handler: async (backend, args) => backend.unreserve(String(args.id), str(args.sale)),
  },

  draft_item_from_url: {
    description:
      'Turn a product page URL into a draft item. Fetches the page, extracts ' +
      'title / description / price / hero image from Open Graph + Twitter Card + ' +
      'schema.org Product metadata. Returns the draft so you can show it to the user, ' +
      'adjust (price for used condition, trimmed description), then call `add_item` + ' +
      '`attach_image_from_url` to commit it. Note: price is the retail price from the page; ' +
      'offer the user a discount for used condition rather than listing at full price.',
    schema: z.object({
      url: z.string().describe('Product page URL (Amazon listing, manufacturer page, etc).'),
    }),
    handler: async (_backend, args) => {
      const draft = await draftItemFromUrl(String(args.url));
      return draft;
    },
  },

  attach_image_from_url: {
    description:
      'Attach an image to an item by URL. Server fetches the bytes, validates format + size, ' +
      'and stores it. Use this when you have a public image URL (product hero shot, CDN link, etc). ' +
      'For images attached directly in chat, use `attach_image_bytes` instead. ' +
      'Accepts JPEG, PNG, and WebP. Returns the updated item with its `images` array (newest last).',
    schema: z.object({
      ...SaleRefField,
      id: z.string().describe('Item id or slug to attach the image to.'),
      url: z.string().describe('Direct URL to an image file (jpeg/png/webp).'),
    }),
    handler: async (backend, args) =>
      backend.attachImageFromUrl(String(args.id), String(args.url), str(args.sale)),
  },

  attach_image_from_path: {
    description:
      'Attach an image by LOCAL filesystem path. The MCP process reads the file ' +
      'server-side — no base64 travels through tool args. Best for real photos (>50 KB).\n\n' +
      '**Works when:**\n' +
      '- You are running as **Claude Code** (shares filesystem with the MCP). ' +
      'Pass a path like `~/Downloads/foo.jpg` or an absolute path and it Just Works.\n' +
      '- Any other setup where the MCP child process can see the path on disk.\n\n' +
      '**Does NOT work** with Claude.ai sandbox paths (`/mnt/user-data/uploads/...`, ' +
      '`/mnt/skills/...`) — those live in the client sandbox, not on the MCP host. ' +
      'The tool fails loudly with an error pointing at the two alternatives below.\n\n' +
      'If a Claude.ai user asks to attach a photo they just uploaded to chat, ' +
      'there are exactly two paths that work today: (1) have them switch to ' +
      'Claude Code, or (2) tell them to drop the image into the web editor directly ' +
      '(the `editorUrl` on the item opens the photo grid).',
    schema: z.object({
      ...SaleRefField,
      id: z.string().describe('Item id or slug to attach the image to.'),
      path: z
        .string()
        .describe(
          'Absolute or ~-expanded path to a JPEG/PNG/WebP file on the host running ' +
            'this MCP. Reject sandbox paths like /mnt/user-data/uploads/* — those ' +
            "don't exist on the MCP host.",
        ),
    }),
    handler: async (backend, args) =>
      backend.attachImageFromPath(String(args.id), String(args.path), str(args.sale)),
  },

  attach_image_bytes: {
    description:
      'Attach an image by inlining base64-encoded bytes in the tool call.\n\n' +
      '**Use `attach_image_from_path` instead when possible.** Claude Desktop and ' +
      'Claude.ai web silently truncate large tool arguments. In practice only tiny ' +
      'images (<1 KB decoded) survive this tool; any real photo gets cut off and ' +
      'the server returns `decoded_too_small`. For real photos, either (a) use ' +
      '`attach_image_from_path` from Claude Code, or (b) tell the user to drop the ' +
      "image in the web editor (see item's `editorUrl`).\n\n" +
      '`data` is the actual base64-encoded bytes, NOT a file path. Accepts JPEG, ' +
      'PNG, WebP. 5 MB decoded cap (if your client lets that much through).',
    schema: z.object({
      ...SaleRefField,
      id: z.string().describe('Item id or slug to attach the image to.'),
      data: z
        .string()
        .describe(
          'Base64-encoded image file CONTENTS. Either a dataURL ' +
            "('data:image/png;base64,iVBORw0KG...') or a bare base64 string. " +
            'Do NOT pass a file path, URL, or placeholder.',
        ),
      mime: z
        .string()
        .optional()
        .describe(
          'Required only when `data` is a bare base64 string (no dataURL prefix). ' +
            "One of: 'image/jpeg', 'image/png', 'image/webp'.",
        ),
    }),
    handler: async (backend, args) =>
      backend.attachImageBytes(
        String(args.id),
        String(args.data),
        { mime: str(args.mime) },
        str(args.sale),
      ),
  },

  delete_image: {
    description:
      'Remove one photo from an item. Takes the full image URL (get it via `get_item` or ' +
      "`list_items`). Deletes the backing blob too. If it's the only image, the item's " +
      '`images` goes empty; the item itself stays (use `delete_item` to remove the whole item).',
    schema: z.object({
      ...SaleRefField,
      id: z.string().describe('Item id or slug.'),
      url: z.string().describe('The exact image URL to remove (from item.images[]).'),
    }),
    handler: async (backend, args) =>
      backend.deleteImage(String(args.id), String(args.url), str(args.sale)),
  },

  set_cover: {
    description:
      "Promote one of an item's existing images to the cover position (first in `images`). " +
      'Non-destructive: the full `images` array is preserved, just reordered. The URL must ' +
      'already be attached to the item — look it up via `get_item`. Do NOT use `update_item` ' +
      'with `images: [...]` to change covers; that replaces the whole array and deletes the ' +
      'others. This tool is the correct primitive.',
    schema: z.object({
      ...SaleRefField,
      id: z.string().describe('Item id or slug.'),
      url: z.string().describe('The image URL to promote to cover (must be in item.images[]).'),
    }),
    handler: async (backend, args) =>
      backend.setCover(String(args.id), String(args.url), str(args.sale)),
  },

  publish: {
    description:
      '[hosted only] Make the sale visible at its public URL. ' +
      'Returns `{ publishedAt, publicUrl }` — always include the publicUrl in your reply. ' +
      'Self-hosted sales are always "published" — use commit_and_push there.',
    schema: z.object({ ...SaleRefField }),
    handler: async (backend, args) => backend.publish(str(args.sale)),
  },

  unpublish: {
    description: '[hosted only] Hide the sale from its public URL.',
    schema: z.object({ ...SaleRefField }),
    handler: async (backend, args) => {
      await backend.unpublish(str(args.sale));
      return { unpublished: true };
    },
  },

  commit_and_push: {
    description:
      '[local only] git add -A, commit, and push to origin. Hosted sales save automatically.',
    schema: z.object({ message: z.string().optional() }),
    handler: async (backend, args) => backend.commitAndPush(args.message as string | undefined),
  },
};

/** Convert a zod schema to a minimal JSON Schema for MCP tool listing. */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def: { typeName: string } })._def;
  if (def.typeName === 'ZodObject') {
    const obj = schema as z.ZodObject<z.ZodRawShape>;
    const shape = obj.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJsonSchema(v);
      if (!(v as z.ZodTypeAny).isOptional()) required.push(k);
    }
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    };
  }
  if (def.typeName === 'ZodOptional') {
    return zodToJsonSchema((schema as z.ZodOptional<z.ZodTypeAny>)._def.innerType);
  }
  if (def.typeName === 'ZodString') return { type: 'string' };
  if (def.typeName === 'ZodNumber') return { type: 'number' };
  if (def.typeName === 'ZodBoolean') return { type: 'boolean' };
  if (def.typeName === 'ZodArray') {
    const arr = schema as z.ZodArray<z.ZodTypeAny>;
    return { type: 'array', items: zodToJsonSchema(arr._def.type) };
  }
  if (def.typeName === 'ZodEnum') {
    return { type: 'string', enum: (schema as z.ZodEnum<[string, ...string[]]>)._def.values };
  }
  return {};
}
