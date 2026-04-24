# yrdsl

[![CI](https://github.com/KuvopLLC/yrdsl/actions/workflows/ci.yml/badge.svg)](https://github.com/KuvopLLC/yrdsl/actions/workflows/ci.yml)
[![Publish packages](https://github.com/KuvopLLC/yrdsl/actions/workflows/publish-packages.yml/badge.svg)](https://github.com/KuvopLLC/yrdsl/actions/workflows/publish-packages.yml)
[![Publish MCP](https://github.com/KuvopLLC/yrdsl/actions/workflows/publish-mcp.yml/badge.svg)](https://github.com/KuvopLLC/yrdsl/actions/workflows/publish-mcp.yml)

Yrdsl ("Digital Yard Sale") creates a hosted web page that lists items with photos, prices, short
descriptions, and contact buttons for email, SMS, and WhatsApp. Buyers
message you directly. No cart, no checkout, no payments.

This repo is the open-source side of [yrdsl.app](https://yrdsl.app):
shared schemas, the React viewer, themes, the MCP server, and the docs
that explain how to publish a sale. Everything here is MIT-licensed.

There are two ways to publish a sale and this repo teaches both.

## Publish a sale via JSON files

This is the self-hosted path. A sale is three things on disk:

- `site.json` — sale title, contact methods, theme, currency.
- `items.json` — an array of items with title, price, tags, photos.
- `public/photos/*` — the actual photo files referenced from items.

[`KuvopLLC/yrdsl-self-hosted`](https://github.com/KuvopLLC/yrdsl-self-hosted)
is a GitHub template repo that wires these three into a working site
built with Vite and deployed to GitHub Pages. Click **Use this
template**, edit the JSON, push. A GitHub Action builds and publishes
at `https://<your-username>.github.io/<your-repo>/`.

The JSON shapes are defined by zod schemas in
[`packages/core`](./packages/core) and published as
[`@yrdsl/core`](https://www.npmjs.com/package/@yrdsl/core). The
self-hosted template validates against them before every deploy and
accepts the same ZIPs that the hosted editor exports, so you can move
a sale between modes losslessly.

## Publish a sale via Claude (MCP)

The same operations work through a chat with
[Claude](https://claude.ai/download) via the Model Context Protocol
server published as
[`@yrdsl/mcp`](https://www.npmjs.com/package/@yrdsl/mcp).

Claude can add items, write descriptions, set prices, attach photos,
mark things reserved, and publish the sale — all from a conversation.
Examples:

- *"Add a Moccamaster coffee maker, $80."*
- *"Draft an item from this Amazon link and add it at 40% off retail."*
- *"Mark the coffee maker sold for $70."*

The MCP points at either mode:

- **Hosted:** an API token against `api.yrdsl.app`. The hosted app has
  a *Connect Claude* tab that walks you through getting a key and
  installing the MCP in Claude Desktop or Claude Code.
- **Self-hosted:** a path to your self-hosted fork. The MCP reads and
  writes the JSON files and the photos folder directly; setup lives
  in the template repo's README.

Source: [`packages/mcp`](./packages/mcp).

## Packages in this repo

- [`@yrdsl/core`](./packages/core) — zod schemas + types for
  `SaleSite`, `SaleItem`, `SaleContact`.
- [`@yrdsl/viewer`](./packages/viewer) — React component that renders
  a sale page. Used by both hosted and self-hosted.
- [`@yrdsl/themes`](./packages/themes) — the four visual themes
  (`conservative`, `artsy`, `hip`, `retro`) as plain CSS.
- [`@yrdsl/mcp`](./packages/mcp) — the MCP server (stdio CLI + library).

## Contact

[matt@mreider.com](mailto:matt@mreider.com). Bug reports, feature
requests, and "I tried X and it was weird" are all welcome.

## Contributing

Dev setup, running locally, tests: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. Operated by [Kuvop LLC](https://oss.kuvop.com).
