# D1 backup + restore runbook

Cloudflare D1 doesn't have automatic offsite backups — by default the
only safety net is **Time Travel**, which keeps the last 30 days of
write history per database. This runbook covers (a) how to take a
manual export to keep alongside the repo, (b) how to roll back via
Time Travel, and (c) the recovery time/point objectives we accept.

## Recovery objectives

| Metric | Target | Mechanism |
|---|---|---|
| **RPO** (max data loss) | 5 minutes | Time Travel, default 30-day window |
| **RTO** (max downtime to restore) | 30 minutes | wrangler bookmark/restore (single command) |
| **Catastrophic restore** (Time Travel window blown) | manual export | `wrangler d1 export`, kept in R2 |

Time Travel covers the cases that actually happen in practice
(accidental DROP, runaway UPDATE, bad migration). The manual export
exists for the once-a-year scenario where Time Travel itself isn't
enough — datacenter loss, account compromise, the 30-day window
expired between when something broke and when we noticed.

## A. Manual export (run weekly + before risky migrations)

```sh
# From the api-worker workspace.
cd services/api-worker

# Export the entire DB to a single SQL file. Includes schema + data.
pnpm exec wrangler d1 export yard-sale --remote --output=/tmp/yrdsl-d1-$(date +%Y%m%d).sql

# Upload to R2 for cold storage. (Bucket lifecycle keeps last 12 weeks.)
aws s3 cp /tmp/yrdsl-d1-$(date +%Y%m%d).sql \
  s3://yard-sale-backups/d1/ \
  --endpoint-url https://006034a9f9712a60aee4665a51d20d28.r2.cloudflarestorage.com
```

The R2 bucket `yard-sale-backups` is **not yet provisioned** — create it
the first time you run this:

```sh
pnpm exec wrangler r2 bucket create yard-sale-backups
pnpm exec wrangler r2 bucket lifecycle add yard-sale-backups \
  --id expire-12w \
  --prefix d1/ \
  --age-days 84 \
  --action delete
```

## B. Time Travel restore

Cloudflare keeps write-ahead log bookmarks for the last 30 days.

```sh
# 1. Find the bookmark just before the bad change. Use the timestamp
#    (UTC) of the last-known-good state — Time Travel snaps to the
#    closest preceding bookmark.
pnpm exec wrangler d1 time-travel info yard-sale \
  --timestamp=2026-04-20T14:30:00Z
# → prints a bookmark id like 0000000000abcd-00000000

# 2. Restore in place. This is destructive: the database becomes
#    whatever it was at that bookmark, current state is gone.
pnpm exec wrangler d1 time-travel restore yard-sale \
  --bookmark=0000000000abcd-00000000
```

For non-destructive inspection (e.g. recover a single row), use
`wrangler d1 export --bookmark=...` to dump that historical state to
SQL, then read what you need without touching prod.

## C. Catastrophic restore (Time Travel window blown)

```sh
# Drop the broken database (or create a fresh one).
pnpm exec wrangler d1 delete yard-sale
pnpm exec wrangler d1 create yard-sale
# Update the database_id in services/*/wrangler.toml to the new UUID.

# Replay the last manual export.
pnpm exec wrangler d1 execute yard-sale --remote --file=/tmp/yrdsl-d1-YYYYMMDD.sql
```

R2 image objects are not in D1 and are therefore unaffected. If R2 is
also lost, images are gone — there's no third copy. (For v1 we accept
this; if a paid tier ever stores customer-of-customer data we'll add
cross-region replication.)

## Verification (run quarterly)

1. `wrangler d1 export yard-sale --remote --output=/tmp/restore-test.sql`
2. `wrangler d1 create yard-sale-restore-test`
3. `wrangler d1 execute yard-sale-restore-test --remote --file=/tmp/restore-test.sql`
4. Spot-check: `SELECT COUNT(*) FROM users;`,
   `SELECT COUNT(*) FROM sales WHERE published_at IS NOT NULL;`,
   `SELECT MAX(updated_at) FROM items;`
5. Compare counts against the live DB. Within 5% is fine; large drifts
   indicate the export missed something (e.g. very recent writes during
   the export window).
6. `wrangler d1 delete yard-sale-restore-test`

If any step fails, file an issue tagged `ops/d1` and don't ship anything
risky until the export pipeline is fixed.
