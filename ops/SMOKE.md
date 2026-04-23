# Prod smoke test setup

Runs after every `Deploy Cloudflare Workers` succeeds. Exercises login → create sale → add item → publish → fetch public → unpublish → delete against live `api.yrdsl.app` using a long-lived test account. Opens a GH issue labeled `smoke-fail` if anything breaks.

## One-time setup

### 1. Pick credentials

```sh
EMAIL=smoke@yrdsl.app          # or smoke@test.yrdsl.app if you own that
USERNAME=smoke
PASSWORD=$(openssl rand -base64 32)  # impossible-to-guess
```

### 2. Seed the user in prod D1

```sh
SMOKE_EMAIL=$EMAIL \
SMOKE_USERNAME=$USERNAME \
SMOKE_PASSWORD=$PASSWORD \
  node scripts/seed-smoke-user.mjs
```

It prints a full `wrangler d1 execute` command. Copy-paste and run it. The account is created with `email_confirmed_at` set so the smoke can skip the confirmation flow.

### 3. Add GitHub secrets

```sh
gh secret set SMOKE_EMAIL    -R KuvopLLC/yrdsl -b "$EMAIL"
gh secret set SMOKE_USERNAME -R KuvopLLC/yrdsl -b "$USERNAME"
gh secret set SMOKE_PASSWORD -R KuvopLLC/yrdsl -b "$PASSWORD"
```

## What runs when

| Workflow | Trigger | What it does |
|---|---|---|
| `smoke-prod.yml` | After `Deploy Cloudflare Workers` succeeds, or manual | Runs `scripts/smoke.mjs` end-to-end. Opens a `smoke-fail` issue on failure. |
| `smoke-reaper.yml` | Every hour at :15 | `DELETE FROM sales WHERE title LIKE 'smoke\_%' AND created_at < now()-1h` on prod D1. Catches orphans from aborted runs. |

## Cleanup model

- Every run prefixes its sale title with `smoke_<GH run id>_`.
- The smoke script deletes the sale in a `finally` block after the run.
- If the cleanup step fails (or the whole job dies mid-flight), the reaper sweeps any `smoke_%` sale older than 1 hour.
- Item rows cascade on `DELETE FROM sales`. R2 image blobs get picked up by `cleanup-worker`'s orphan sweep.

## Rotating the smoke password

If the password leaks or you want to rotate:

```sh
NEW=$(openssl rand -base64 32)
SMOKE_EMAIL=$EMAIL SMOKE_USERNAME=$USERNAME SMOKE_PASSWORD=$NEW \
  node scripts/seed-smoke-user.mjs
# Copy the UPDATE (adapt the INSERT): you want to just update password_hash,
# not re-insert. Something like:
#   UPDATE users SET password_hash = '<hash from script>' WHERE email = '$EMAIL';
gh secret set SMOKE_PASSWORD -R KuvopLLC/yrdsl -b "$NEW"
```

## Debugging a failed run

1. Open the failed run in Actions. The smoke step prints `status=` and `body=` for the failing request.
2. `body` contains `{ error, reqId, message }` (widened error response). Grep Cloudflare Workers Logs for the `reqId` to see the full server-side trace.
3. Close the `smoke-fail` issue once the next run is green (the workflow guards against duplicate issues but won't auto-close).
