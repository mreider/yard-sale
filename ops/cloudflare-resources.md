# Cloudflare resources (yrdsl.app)

Source of truth for Cloudflare resource IDs referenced by `wrangler.toml`
files and CI workflows. See also `ops/HOSTED-DEPLOY.md` for the full
first-deploy runbook.

| Resource            | Name/ID                                                |
|---------------------|--------------------------------------------------------|
| Account ID          | `006034a9f9712a60aee4665a51d20d28`                     |
| Zone `yrdsl.app`    | `99740535837f64af15f95586d1197092`                     |
| Zone nameservers    | `bayan.ns.cloudflare.com`, `kehlani.ns.cloudflare.com` |
| D1 database         | `yard-sale` / `a9ff9f3f-dbf4-4088-b0d2-3644b261c7d1`   |
| KV namespace        | `yard-sale-cache` / `b7d180afff244c3e8f1a65da58922d9b` |
| R2 bucket (images)  | `yard-sale-images`                                     |
| R2 bucket (avatars) | `yard-sale-avatars`                                    |
| Pages project       | `yrdsl-app` (custom domain `app.yrdsl.app`)            |

## DNS records (live)

| Name              | Type  | Content                | Purpose                         |
|-------------------|-------|------------------------|---------------------------------|
| `yrdsl.app` root  | CNAME | GitHub Pages           | Landing (`apps/landing`)        |
| `www.yrdsl.app`   | CNAME | GitHub Pages           | Landing alias                   |
| `app.yrdsl.app`   | CNAME | `yrdsl-app.pages.dev`  | SPA (`apps/web`, CF Pages)      |
| `api.yrdsl.app`   | A     | placeholder (proxied)  | api-worker route                |

Worker routes take over wherever they match; the DNS target only needs to
exist so the proxied CNAME/A record lights up.

## Resources not yet in use

- `mcp.yrdsl.app` was reserved for a separate MCP worker. M3 unified
  the MCP into the api-worker (single stdio server with hosted/local
  backends — see `packages/mcp`), so no separate hostname is needed.
- `yard-sale-backups` R2 bucket: optional cold-storage for D1 exports.
  Provisioned the first time `ops/D1-BACKUP.md` § A is run.
