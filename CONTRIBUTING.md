# Contributing

Notes for anyone hacking on the open-source packages here
(`@yrdsl/core`, `@yrdsl/viewer`, `@yrdsl/themes`, `@yrdsl/mcp`). The
private hosted SaaS lives in a separate repo and consumes these
packages from npm.

## Repo layout

```
packages/
  core/         # zod schemas + types (SaleSite, SaleItem, etc.)
  viewer/       # React component that draws a sale page
  themes/       # conservative, artsy, hip, retro (plain CSS)
  mcp/          # Model Context Protocol server (stdio CLI + library)
  i18n/         # (placeholder) i18n bits
  sdk/          # (placeholder) future SDK
.github/workflows/
  ci.yml              # typecheck + lint + test on every push
  publish-packages.yml # manual-dispatch publish of @yrdsl/{core,viewer,themes}
  publish-mcp.yml     # auto-publish @yrdsl/mcp on package changes
  vendor-refresh.yml  # push vendored viewer/schemas to yrdsl-self-hosted
```

## Set up

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

## Making changes

- Edit in `packages/<name>/src/`.
- Run `pnpm --filter @yrdsl/<name> typecheck` before pushing.
- Schema changes under `packages/core/src/schemas/sale.ts` also need
  the vendored copy in the self-hosted template repo refreshed —
  the `vendor-refresh` workflow handles that automatically on push
  to `main`.

## Publishing

- `@yrdsl/mcp`: auto-publishes when its `package.json` version bumps.
- `@yrdsl/core`, `@yrdsl/viewer`, `@yrdsl/themes`: bump the
  `package.json` version, then manually dispatch
  `publish-packages.yml` from the Actions tab.

## PR hygiene

- Run `pnpm lint` (biome) before pushing. CI is strict on format.
- Run `pnpm -r typecheck` and `pnpm -r test`.
- The hosted SaaS consumes these packages at pinned versions from
  npm, so **a breaking change is a breaking change.** Bump the major
  version and call out the migration in the commit.
