# Migrations

SQL files applied to the Cloudflare D1 database in lexical order.

Apply locally:

```sh
pnpm exec wrangler d1 execute yard-sale --local --file migrations/0001_init.sql
```

Apply to production:

```sh
pnpm exec wrangler d1 execute yard-sale --remote --file migrations/0001_init.sql
```

Migration tracking is provided by `wrangler d1 migrations` (scanned from this folder).
