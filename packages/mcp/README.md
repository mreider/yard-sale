# @yrdsl/mcp

MCP server for [yrdsl.app](https://yrdsl.app). Lets Claude (or any MCP client) add, edit, and reserve items on a digital yard sale.

Two modes, one binary:

- **Hosted** — talks to `api.yrdsl.app` with a bearer token. Edits land on your live sale.
- **Local self-hosted** — edits `site.json` and `items.json` in a local `yrdsl-self-hosted` fork. You commit and push when ready.

## Install

```sh
npm install -g @yrdsl/mcp
```

Or invoke via `npx`:

```sh
npx @yrdsl/mcp
```

## Claude Desktop setup

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows.

### Hosted

```json
{
  "mcpServers": {
    "yrdsl": {
      "command": "npx",
      "args": ["-y", "@yrdsl/mcp"],
      "env": {
        "YRDSL_API_TOKEN": "yrs_live_..."
      }
    }
  }
}
```

Get `YRDSL_API_TOKEN` from the Connect Claude page in the yrdsl.app SPA. The token is account-wide — tools default to your one sale when you only have one. If you have multiple, pass `sale: <slug>` to tool calls, or call `list_sales` first.

### Local self-hosted

```json
{
  "mcpServers": {
    "yrdsl": {
      "command": "npx",
      "args": ["-y", "@yrdsl/mcp"],
      "env": {
        "YRDSL_MODE": "local",
        "YRDSL_REPO": "/path/to/your/yrdsl-self-hosted-fork"
      }
    }
  }
}
```

## Environment variables

| Name | Required | Description |
|---|---|---|
| `YRDSL_MODE` | optional | `hosted` or `local`. Autodetected from other envs if unset. |
| `YRDSL_API_TOKEN` | hosted mode | Bearer token from /connect. Account-wide. |
| `YRDSL_API_URL` | optional | Overrides `https://api.yrdsl.app` (for self-hosted API deployments). |
| `YRDSL_REPO` | local mode | Absolute path to a `yrdsl-self-hosted` fork. |
| `YRDSL_SITE_URL` | local optional | Override the deployed URL instead of reading `site.json`'s `url`. |

## Tools

Common to both modes:

- `list_sales` — enumerate sales (hosted: all your sales; local: the repo's single sale). Includes `publicUrl` when published + `editorUrl`.
- `get_site`, `update_site` — sale metadata (name, subtitle, theme, contact, currency)
- `list_items`, `get_item` — item reads. Each item carries a `publicUrl` (when the sale is published) so Claude can share a direct link.
- `recent_items` — the N most-recently-added items. Pair with `delete_item` to offer "undo" after a batch.
- `find_item` — substring search across title / tags / description. Use before update/delete/reserve when the user names an item by description.
- `draft_item_from_url` — turn a product page URL into a draft (title, description, price, hero image) via Open Graph + schema.org extraction. Show it to the user, then commit with `add_item` + `attach_image_from_url`.
- `add_item`, `update_item`, `delete_item` — item CRUD
- `attach_image_from_url` — server-side fetch of an image URL, validated + stored. Use when you have a public image URL.
- `attach_image_bytes` — accepts a dataURL or base64 + mime. Use when the user pasted a photo directly into chat (no URL available).
- `delete_image` — remove a specific photo from an item.
- `mark_reserved`, `unreserve` — reservation state

Every sale-scoped tool takes an optional `sale` arg (slug or id). Omit when the account has exactly one sale. In local mode `sale` is ignored.

Hosted only:

- `create_sale` — spin up a new sale
- `publish`, `unpublish` — flip the draft flag

Local only:

- `commit_and_push` — `git add`/`commit`/`push` the sale repo. For `publicUrl` to appear, set `url` in `site.json` (or the `YRDSL_SITE_URL` env var) to your deployed address.

### Example flow

User: *"Add this to my sale, quick-sale price: https://example.com/products/coffee-maker"*

1. `draft_item_from_url({ url })` → returns title, description, retail price, hero image.
2. Show the draft to the user; adjust price for used condition.
3. `add_item({ title, price, description })` → returns the created item with `publicUrl`.
4. `attach_image_from_url({ id, url: <draft.image> })` → downloads + stores the hero.
5. Reply with the `publicUrl` so the user has a shareable link.

## Build a WhatsApp bot

The hosted API (`api.yrdsl.app`) is a plain REST endpoint behind a bearer token. You don't need the MCP server at all — any program that can make HTTP requests can manage a sale. This makes it straightforward to build a chat bot on WhatsApp, Telegram, Slack, or any other platform.

The pattern: wire a chat library (for receiving messages) to an LLM with tool use (for deciding what to do) to the yrdsl REST API (for actually doing it). The user sends a photo and a message; the LLM calls the right API endpoints; the bot replies with a confirmation and a link.

### Architecture

```
WhatsApp ←→ Baileys (Node.js) ←→ Claude (Anthropic API, tool use) ←→ yrdsl REST API
```

- **Chat library** receives messages (text + images) from the user.
- **LLM with tool use** decides which yrdsl operations to call based on the conversation.
- **yrdsl API** executes the operations (add item, attach photo, mark reserved, etc).
- **Bot** sends the LLM's text reply back to the user.

### What you need

- A **yrdsl API token** (`yrs_live_...`) — get one from the Connect page in the yrdsl.app SPA.
- An **Anthropic API key** — for Claude tool-use calls.
- A **chat platform library** — [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp, [grammy](https://grammy.dev) for Telegram, [Bolt](https://slack.dev/bolt-js) for Slack, etc.
- A server to run it on — a VM, a Raspberry Pi, a container. Anything that stays online.

### API basics

All endpoints live under `https://api.yrdsl.app`. Authenticate with `Authorization: Bearer yrs_live_...`.

```bash
# List your sales
curl -H "Authorization: Bearer $TOKEN" https://api.yrdsl.app/sales

# List items in a sale
curl -H "Authorization: Bearer $TOKEN" https://api.yrdsl.app/sales/$SALE_ID/items

# Add an item
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Desk Lamp","price":15,"description":"Vintage brass desk lamp"}' \
  https://api.yrdsl.app/sales/$SALE_ID/items

# Attach a photo (raw bytes)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg \
  https://api.yrdsl.app/sales/$SALE_ID/items/$ITEM_ID/images/bytes

# Mark reserved
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reserved":{"on":"2026-04-24"}}' \
  https://api.yrdsl.app/sales/$SALE_ID/items/$ITEM_ID
```

See the [Tools](#tools) section above for the full list of operations. Every MCP tool maps 1:1 to a REST endpoint.

### Example: WhatsApp bot with Baileys + Claude

Here's the core of a WhatsApp bot that manages a yard sale. It uses [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp and the [Anthropic SDK](https://docs.anthropic.com/en/api) for Claude with tool use.

**1. Define tools for Claude**

Give Claude tool definitions that map to the yrdsl API. Keep them simple — Claude picks the right one based on the conversation.

```js
const tools = [
  {
    name: 'add_item',
    description: 'Add a new item to the yard sale.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        price: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['title', 'price'],
    },
  },
  {
    name: 'attach_image',
    description: 'Attach a photo to an item.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        image_path: { type: 'string' },
      },
      required: ['id', 'image_path'],
    },
  },
  {
    name: 'list_items',
    description: 'List all items in the sale.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'mark_reserved',
    description: 'Mark an item as reserved.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  // ... add more as needed (find_item, delete_item, etc.)
];
```

**2. Execute tools against the API**

```js
async function executeTool(name, input) {
  const saleId = await getSaleId(); // resolve once, cache it

  switch (name) {
    case 'add_item': {
      const res = await fetch(`${API}/sales/${saleId}/items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.title, price: input.price, description: input.description }),
      });
      return await res.json();
    }
    case 'attach_image': {
      const bytes = readFileSync(input.image_path);
      const res = await fetch(`${API}/sales/${saleId}/items/${input.id}/images/bytes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/jpeg' },
        body: bytes,
      });
      return await res.json();
    }
    // ... etc
  }
}
```

**3. Conversation loop with tool use**

Send messages to Claude with your tool definitions. When Claude returns `stop_reason: 'tool_use'`, execute the tools and feed results back. Repeat until Claude returns text.

```js
async function chat(userMessage) {
  messages.push({ role: 'user', content: userMessage });

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: 'You are a WhatsApp bot that manages a yard sale on yrdsl.app...',
    tools,
    messages,
  });

  while (response.stop_reason === 'tool_use') {
    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(block.name, block.input);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
    }
    messages.push({ role: 'user', content: results });
    response = await anthropic.messages.create({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, system: '...', tools, messages });
  }

  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}
```

**4. Wire it to WhatsApp**

```js
sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
  if (type !== 'notify') return;
  for (const msg of msgs) {
    if (!msg.message || msg.key.fromMe) continue;
    const jid = msg.key.remoteJid;

    // Extract text and/or download image
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const imageMsg = msg.message.imageMessage;

    let userContent = text;
    if (imageMsg) {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const path = `/tmp/${Date.now()}.jpg`;
      writeFileSync(path, buffer);
      // Send image + text to Claude as multimodal content
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } },
        { type: 'text', text: text || '(photo, no caption)' },
        { type: 'text', text: `[image saved at ${path}]` },
      ];
    }

    const reply = await chat(userContent);
    await sock.sendMessage(jid, { text: reply });
  }
});
```

### Running in a container

Package the bot as a container so it starts automatically and survives reboots. Here's a minimal Podman/Docker setup:

**Containerfile:**

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY bot.js ./
VOLUME /app/whatsapp-auth
VOLUME /app/images
CMD ["node", "bot.js"]
```

**Run it:**

```bash
# First run — pair with WhatsApp (prints a QR code to scan)
podman run --rm --env-file .env -v ./whatsapp-auth:/app/whatsapp-auth -v ./images:/app/images my-bot

# After pairing, run as a systemd service
podman run -d --name my-bot --env-file .env -v ./whatsapp-auth:/app/whatsapp-auth -v ./images:/app/images --restart=always my-bot
```

The `.env` file holds your two secrets:

```
ANTHROPIC_API_KEY=sk-ant-...
YRDSL_API_TOKEN=yrs_live_...
```

WhatsApp auth state persists in the `whatsapp-auth` volume, so the container can restart without re-pairing.

### Adapting to other platforms

The same pattern works anywhere. Replace Baileys with:

- **Telegram** — [grammy](https://grammy.dev) or [telegraf](https://telegraf.js.org). Photos arrive as `file_id`; download via `getFile`.
- **Slack** — [Bolt](https://slack.dev/bolt-js). Images arrive as file uploads; download via `files.info`.
- **Discord** — [discord.js](https://discord.js.org). Attachments have a direct URL.
- **SMS** — Twilio webhook. Photos arrive as `MediaUrl` parameters.

The LLM + tool-use + REST API core stays the same. Only the message ingestion and reply delivery change.

## License

MIT. See the [yrdsl repository](https://github.com/KuvopLLC/yrdsl) for full source.
