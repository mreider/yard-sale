# yrdsl

Open-source code behind [yrdsl.app](https://yrdsl.app), a way to run
beautiful, low-friction yard sales. Apache 2.0, part of the
[Kuvop OSS](https://oss.kuvop.com) family.

## Two ways to use this

**Most people want the self-hosted template, not this monorepo.** Pick
based on what you're trying to do:

| If you want to... | Use |
|---|---|
| Run a single yard sale on free GitHub Pages, no backend, edit JSON yourself | [`KuvopLLC/yrdsl-self-hosted`](https://github.com/KuvopLLC/yrdsl-self-hosted) (template repo, "Use this template" → done) |
| See what a self-hosted sale looks like | <https://mreider.github.io/yrdsl-example/> |
| Sign up on the managed multi-sale version with email + Claude-MCP | <https://yrdsl.app> |
| Read the codebase, contribute, fork the whole stack | This repo |

This repo holds the SaaS source: the hosted API, the account SPA, the
landing page, the shared renderer, the schemas. If you fork this, you're
forking the full Kuvop-hosted stack.

## Repo layout

```
apps/
  landing/      # yrdsl.app marketing site (static, GitHub Pages)
  web/          # app.yrdsl.app account SPA (React + Vite, CF Pages)
packages/
  core/         # zod schemas (auth, invite, sale, user, token)
  viewer/       # React renderer for a yard sale; consumed by apps/web + the self-hosted template
  themes/       # 4 themes: conservative, retro, hip, artsy
services/
  api-worker/   # Cloudflare Worker: REST API, auth, invites, billing
  cleanup-worker/  # Scheduled cleanup jobs
migrations/     # D1 schema
ops/            # Operational notes (HOSTED-DEPLOY.md, etc.)
PRD.md          # The full product spec
```

## Getting started (contributors)

```bash
pnpm install
pnpm -r typecheck
pnpm lint
```

### Run the api-worker locally

```bash
cd services/api-worker
cp .dev.vars.example .dev.vars     # populate session signing key
pnpm exec wrangler d1 migrations apply yard-sale --local
pnpm exec wrangler dev
```

### Run the web SPA

```bash
cd apps/web
pnpm dev
```

Vite proxies `/v1/*` to the local api-worker on `:8787`.

### Tests

```bash
cd services/api-worker
pnpm exec vitest run
```

The integration suite spins up `unstable_dev` against a real miniflare
runtime with D1 schema applied via `test/global-setup.ts`. There's no
browser-automation suite (Playwright / Cypress); UI smoke is manual.
See PRD §12.

## How the renderer is shared

`packages/viewer` is a typed React component (`<SaleViewer site={...}
items={...} />`) that renders any yard sale. It's consumed two ways:

1. **Hosted:** imported directly by `apps/web` (and by the published
   sale viewer Worker, planned in M2).
2. **Self-hosted:** vendored as a copy into the
   [`KuvopLLC/yrdsl-self-hosted`](https://github.com/KuvopLLC/yrdsl-self-hosted)
   template's `src/vendor/`.

Both modes consume identical `SaleSite` + `SaleItem` JSON shapes from
`packages/core/src/schemas/sale.ts`. The hosted api-worker translates
D1 rows into these shapes on serialize, so data exported from hosted
drops cleanly into a self-hosted template and vice versa. See PRD §4.4
for the full distribution-modes story.

## Deploying your own copy

If you fork this and want to run your own hosted version, the deploy
specifics (Cloudflare account/zone IDs, D1 binding IDs, secrets, custom
domains) live in `ops/HOSTED-DEPLOY.md`. That file is written from the
perspective of the canonical Kuvop deploy; substitute your own values.

If you just want a single sale, use the self-hosted template instead;
this monorepo is overkill.

## Contributing

PRs welcome. Please:

- Run `pnpm lint` (biome) before pushing — CI is strict on format.
- Run `pnpm -r typecheck` and the api-worker `vitest run`.
- For schema changes touching `packages/core/src/schemas/sale.ts`, also
  refresh the vendored copy in the self-hosted template repo.

## License

Apache 2.0. Operated by [Kuvop LLC](https://oss.kuvop.com).
