# MCP directory listing — yrdsl

Draft copy + fields for Anthropic's MCP Connectors directory submission
at <https://claude.com/partners/mcp>. The Google Form asks for some
subset of this; fill it in as the form requests. Not a committed public
document — internal reference.

## Identity

- **Name:** yrdsl
- **Tagline (≤70 chars):** Publish a digital yard sale from a chat with Claude.
- **One-sentence description (≤160 chars):** Claude adds items, writes descriptions, sets prices, attaches photos, and publishes your digital yard sale to yrdsl.app or a self-hosted GitHub Pages repo.

## Long description

yrdsl is a Model Context Protocol server for running a digital yard sale.
A sale is a single page with photos, prices, short descriptions, and
contact buttons for email, SMS, and WhatsApp. Buyers message the
seller directly; there's no cart, no checkout, no payments.

The MCP operates in one of two modes:

- **Hosted:** point it at an API token from <https://app.yrdsl.app>
  and Claude manages items against the managed SaaS. Items are live
  at `yrdsl.app/<user>/<slug>` the moment you publish.
- **Self-hosted:** point it at a local clone of the
  [`yrdsl-self-hosted`](https://github.com/KuvopLLC/yrdsl-self-hosted)
  template. Claude edits `site.json` / `items.json` / `public/photos/`
  and can commit and push when you tell it to. The site rebuilds on
  any free static host (GitHub Pages, Vercel, Netlify, Cloudflare
  Pages) on the next push.

Typical tool calls Claude makes: add an item, attach a photo
(works end-to-end from Claude Code, which has filesystem access),
draft an item from a product URL, mark sold, publish.

## Categories / tags

- Productivity
- Commerce / marketplaces
- Content management

## Install

**Claude Code** (recommended; handles photo attachments from disk):

```sh
claude mcp add yrdsl -e YRDSL_API_TOKEN=<your-token> -- npx -y @yrdsl/mcp@latest
```

**Claude Desktop** (works for text ops; photos should be uploaded in
the web editor):

Download the [`.mcpb` bundle](https://github.com/KuvopLLC/yrdsl/releases/latest/download/yrdsl-mcp.mcpb)
from GitHub Releases, double-click to install, paste the API token
when prompted.

Full install instructions, including self-hosted mode and manual
`claude_desktop_config.json`, live at
<https://app.yrdsl.app/connect>.

## Authentication

API token minted at <https://app.yrdsl.app/tokens>. Tokens prefixed
`yrs_live_…`, hashed server-side, revokable anytime. Three scopes
(`read`, `write`, `admin`); `@yrdsl/mcp` needs `write`.

No OAuth flow — the MCP doesn't itself negotiate auth with the
client; it reads `YRDSL_API_TOKEN` from the environment that the MCP
client supplies.

## Source, license, docs

- **Source:** <https://github.com/KuvopLLC/yrdsl> (MIT).
- **MCP package:** <https://www.npmjs.com/package/@yrdsl/mcp> (npm,
  provenance-signed).
- **Docs:**
  - Quickstart: <https://app.yrdsl.app/connect>
  - Self-host walkthrough: <https://yrdsl.app/deploy/>
- **Terms + Privacy:** <https://yrdsl.app/terms> / <https://yrdsl.app/privacy>
- **Security:** <https://github.com/KuvopLLC/yrdsl/blob/main/SECURITY.md>
- **Operator:** Kuvop LLC.

## Contact

- Public: [matt@mreider.com](mailto:matt@mreider.com)
- Issues: <https://github.com/KuvopLLC/yrdsl/issues>
- Security: same email, or a private GitHub Security Advisory.

## Screenshots / demo

- **Claude Code session attaching a photo to a Moccamaster listing:**
  <https://yrdsl.app/assets/claude-chat-v3.png>
- **Hosted editor with an item + cover photo:**
  <https://yrdsl.app/assets/hosted-editor-v2.png>
- **Landing page:** <https://yrdsl.app>
- **Live example sale:** <https://mreider.github.io/yrdsl-example/>
