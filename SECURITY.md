# Security

This document covers the yrdsl MCP server (`@yrdsl/mcp`) and the
packages it lives alongside (`@yrdsl/core`, `@yrdsl/viewer`,
`@yrdsl/themes`). Source code for all four is in this repository.
The hosted SaaS at `api.yrdsl.app` and `app.yrdsl.app` lives in a
separate private repo and has its own security boundary.

## Reporting a vulnerability

Email **[matt@mreider.com](mailto:matt@mreider.com)** or open a
private [GitHub Security Advisory](https://github.com/KuvopLLC/yrdsl/security/advisories/new).
Target acknowledgement: 48 hours. Please don't open a public issue
for anything exploitable.

## What the MCP can do

`@yrdsl/mcp` is a stdio Model Context Protocol server. It exposes
tools that let an MCP client (Claude Desktop, Claude Code, or any
other) add/edit/delete items on a digital yard sale, attach photos, mark
items reserved, and publish the sale.

It operates in one of two modes, set via environment variables:

| Mode | Env | What the MCP can reach |
|---|---|---|
| Hosted | `YRDSL_API_TOKEN` (+ optional `YRDSL_SALE_ID`) | Only `api.yrdsl.app` over HTTPS, only the sales owned by the user who minted the token. |
| Self-hosted | `YRDSL_REPO=/path/to/fork` | Only the given local git checkout. Reads/writes `site.json`, `items.json`, and `public/photos/`. Runs `git` in that directory to commit and push. |

The MCP does **not**:

- Execute arbitrary shell commands.
- `eval()` any model-generated code.
- Read files outside `YRDSL_REPO` (self-hosted) or make any network
  request outside `api.yrdsl.app` (hosted).
- Store telemetry. The only remote calls in hosted mode are the
  documented REST endpoints on `api.yrdsl.app`; those are logged by
  the API server for abuse and debugging, never sold, never given to
  a third party.

## Authentication

**Hosted mode.** API tokens are minted by the signed-in owner at
`app.yrdsl.app/tokens`. Tokens are prefixed `yrs_live_…`, scoped per
user, and come in three levels:

- `read` — list + get only.
- `write` — add / edit / delete items, upload photos, publish.
- `admin` — reserved; not required by `@yrdsl/mcp`.

Tokens can be revoked anytime from the same page. They're shown
once at creation and hashed at rest server-side.

**Self-hosted mode.** No auth: the MCP is trusted to write to the
repo path it's pointed at. Git push uses whatever credentials the
local `git` already has (SSH key, HTTPS credential helper).

## Scope of data

**Hosted.** The MCP handles the same data the owner sees in their
editor: sale metadata (title, theme, contact info), item titles /
prices / descriptions / tags / photos, reservation state. Data lives
in Cloudflare D1 (metadata) and R2 (images), both in EU data
centres (configured on our Cloudflare account).

**Self-hosted.** Everything stays on the user's machine until they
push to their own GitHub repo.

Image uploads go over TLS to `api.yrdsl.app/image/bytes` or to R2
directly via `images/bytes`; the server enforces size (≤ 5 MB) and
mime (`image/jpeg`, `image/png`, `image/webp`) caps and refuses bytes
that don't match their declared mime.

## Supply chain

- `@yrdsl/mcp`, `@yrdsl/core`, `@yrdsl/viewer`, `@yrdsl/themes` are
  all published to npm with **[provenance attestations](https://docs.npmjs.com/generating-provenance-statements)**
  via GitHub Actions OIDC. You can verify the build origin from the
  npm registry ("Provenance" tab on the package page).
- The `.mcpb` bundle on GitHub Releases is built and signed by the
  same CI. No hand-built releases.
- Runtime dependencies: `zod`, `fflate`, `@modelcontextprotocol/sdk`.
  No dynamic loading of remote code at runtime.

## Known limitations

- **Claude Desktop tool-argument truncation.** Claude Desktop
  truncates large MCP tool arguments, so `attach_image_bytes` with
  anything bigger than ~1 KB of base64 gets cut off mid-payload and
  rejected by the server. This is a client-side constraint, not a
  yrdsl bug. Claude Code doesn't have this limit and uses
  `attach_image_from_path` instead, which reads the file on the MCP
  process side and never puts bytes in tool args.
- **Third-party image URLs.** `attach_image_from_url` fetches the
  URL from the server; some hosts (e.g. retailer CDNs) block
  Cloudflare Workers outbound IPs, which surfaces as `fetch_failed`.
  No workaround at the MCP level; user can download the image and
  re-upload via Claude Code.

## Contact

General: [matt@mreider.com](mailto:matt@mreider.com)
Security-only: same.
