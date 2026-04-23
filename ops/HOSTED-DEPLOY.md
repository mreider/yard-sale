# Hosted-mode deploy notes

This file documents how the **canonical Kuvop-hosted** deploy of
yrdsl.app is wired together. It's reference material for Matt (or
anyone running their own hosted fork). End users running the
self-hosted single-sale flavor don't need any of this — see
<https://github.com/KuvopLLC/yrdsl-self-hosted> instead.

## Production topology

| Surface | Where | How |
|---|---|---|
| `yrdsl.app` (root marketing) | GitHub Pages | `.github/workflows/deploy-landing.yml` pushes `apps/landing/` to `gh-pages` branch on main merges. |
| `app.yrdsl.app` (account SPA) | Cloudflare Pages, project `yrdsl-app` | `.github/workflows/deploy-web.yml` builds `apps/web` with `VITE_API_URL=https://api.yrdsl.app` and runs `wrangler pages deploy`. |
| `api.yrdsl.app` (REST API) | Cloudflare Worker, route binding | `.github/workflows/deploy-workers.yml` runs `wrangler deploy` from `services/api-worker/`. |
| Scheduled cleanup | Cloudflare Worker | Same workflow deploys `services/cleanup-worker/`. |
| Sale viewer at `yrdsl.app/{user}/{slug}` | Cloudflare Worker overlaying GH Pages | M2 (not yet built). |

## Cloudflare account

- **Account:** Mreider@gmail.com's Account
- **Account ID:** `006034a9f9712a60aee4665a51d20d28`
- **Zone:** `yrdsl.app`
- **Zone ID:** `99740535837f64af15f95586d1197092`

## Cloudflare resources

- **D1 database:** `yard-sale`, id `a9ff9f3f-dbf4-4088-b0d2-3644b261c7d1`,
  bound as `DB` in the api-worker.
- **KV namespace:** `b7d180afff244c3e8f1a65da58922d9b`, bound as `CACHE`
  for rate-limit buckets and short-lived caches.
- **R2 buckets:** `yard-sale-images` and `yard-sale-avatars`, bound as
  `R2_IMAGES` and `R2_AVATARS`.
- **Pages project:** `yrdsl-app` (custom domain `app.yrdsl.app`, CNAME →
  `yrdsl-app.pages.dev`, proxied).
- **Worker route:** `api.yrdsl.app/*` → api-worker (zone `yrdsl.app`).

## Required GitHub Actions secrets

In the `KuvopLLC/yard-sale` repo under Settings → Secrets:

- `CLOUDFLARE_API_TOKEN` — scoped token used by every wrangler command in CI.
- `CLOUDFLARE_ACCOUNT_ID` — `006034a9f9712a60aee4665a51d20d28`.
- `RESEND_API_KEY` — pushed to the api-worker as a secret on each deploy.
- `SESSION_SIGNING_KEY` — 32-byte random hex; signs session cookies.

Forks: replace all of these with your own.

## Worker vars (in `services/api-worker/wrangler.toml`)

- `APP_URL = "https://app.yrdsl.app"` — used in confirmation/reset email links.
- `EMAIL_FROM = "yrdsl.app <onboarding@resend.dev>"` — flip to
  `noreply@send.yrdsl.app` once that subdomain is verified on Resend.
- `ALLOWED_ORIGINS = "https://yrdsl.app,https://app.yrdsl.app"`
- `REQUIRE_INVITE = "true"` — invite-only beta gate. Flip to `"false"` to
  go public.
- `BOOTSTRAP_ADMIN_EMAIL = "mreider@gmail.com"` — first signup with this
  email gets `is_admin = 1` and bypasses the invite gate. Change to your
  own email if you fork.

## First-time deploy checklist

1. Set the four GH Actions secrets above.
2. Create the D1 database: `wrangler d1 create yard-sale`. Note the id,
   put it in `services/api-worker/wrangler.toml`.
3. Apply migrations: `wrangler d1 migrations apply yard-sale --remote`.
4. Create the KV namespace and R2 buckets, update wrangler.toml.
5. Push to main; the three deploy workflows run. After the first
   `deploy-web.yml` succeeds, the Pages project exists.
6. Add the custom domain `app.yrdsl.app` in the Pages project → DNS
   settings, or via the API:
   ```bash
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/yrdsl-app/domains" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"name":"app.yrdsl.app"}'
   ```
   Then create the CNAME `app → yrdsl-app.pages.dev` (proxied).
7. Sign up at `app.yrdsl.app/signup` with `BOOTSTRAP_ADMIN_EMAIL` to
   become the admin. Mint invites at `/admin`.

## Local dev

For day-to-day editing, see the **Getting started** section in the root
[`README.md`](../README.md). This file is only for deploying to a real
Cloudflare account.
