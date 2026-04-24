# yrdsl (Claude Code plugin)

Publish a digital yard sale from a chat with Claude. Works against the
hosted service at [yrdsl.app](https://yrdsl.app) or a self-hosted fork
of the [`yrdsl-self-hosted`](https://github.com/KuvopLLC/yrdsl-self-hosted)
template running on GitHub Pages, Vercel, Netlify, or Cloudflare Pages.

## What it does

Wires [`@yrdsl/mcp`](https://www.npmjs.com/package/@yrdsl/mcp) into
Claude Code. Claude gains tools to:

- Add items, write descriptions, set prices, tag, reserve, unreserve.
- Draft a listing from a product URL (Open Graph / schema.org extraction).
- Attach photos from disk at full quality (Claude Code's filesystem
  access bypasses Claude Desktop's tool-argument truncation).
- Publish / unpublish (hosted mode) or commit + push (self-hosted).

## Install

In Claude Code:

```
/plugin install yrdsl@claude-plugins-official
```

Or while developing:

```sh
claude --plugin-dir /path/to/this/plugin
```

## Configure the MCP mode

The plugin bundles the stdio MCP server; you pick the mode via one
environment variable.

### Hosted (yrdsl.app)

Get an API token at
<https://app.yrdsl.app/tokens> and export it before launching Claude Code:

```sh
export YRDSL_API_TOKEN=yrs_live_…
claude
```

### Self-hosted (your own fork)

Point at the local clone of your template fork:

```sh
export YRDSL_REPO=$(pwd)  # in your fork's directory
claude
```

`git push` from Claude uses whatever credentials your local `git`
already has (SSH key, HTTPS credential helper).

## Ask Claude things like

- *"Add a Moccamaster coffee maker, €80, photo at ~/Downloads/moccamaster.jpg, tag it kitchen."*
- *"Draft a listing from https://example.com/bike — price it at 40% off retail."*
- *"Mark the lamp reserved for $30 as of today."*
- *"Commit and push."* *(self-hosted only)*

## Source

<https://github.com/KuvopLLC/yrdsl/tree/main/plugins/yrdsl>. The MCP
server source is under `packages/mcp/`.

## License

MIT.
