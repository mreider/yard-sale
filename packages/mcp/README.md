# @yrdsl/mcp

MCP server for [yrdsl.app](https://yrdsl.app). Lets Claude (or any MCP client) add, edit, and reserve items on a yard sale.

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

## License

Apache-2.0. See the [yrdsl repository](https://github.com/KuvopLLC/yrdsl) for full source.
