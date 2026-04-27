# Private Repo Work for M6 (Privacy, Profiles, Regional Discovery)

This document summarizes the API and database work needed to complete the privacy/visibility, profile privacy, and regional discovery features. The public repo (yrdsl) is complete; this outlines the private repo (api-worker, viewer-worker, D1).

## D1 Migration

File: `migrations/0002_privacy_region.sql` (or next sequential number)

```sql
-- sales table
ALTER TABLE sales ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE sales ADD COLUMN private_token TEXT UNIQUE;
ALTER TABLE sales ADD COLUMN region_country TEXT;
ALTER TABLE sales ADD COLUMN region_city TEXT;
CREATE INDEX idx_sales_private_token ON sales(private_token)
  WHERE private_token IS NOT NULL;
CREATE INDEX idx_sales_discovery ON sales(visibility, region_country, region_city)
  WHERE visibility = 'public';

-- users table
ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN default_region_country TEXT;
ALTER TABLE users ADD COLUMN default_region_city TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
```

## API Changes (api-worker)

### 1. Private Token Generation

On `POST /sales/{id}/publish` when `visibility = 'private'`:

```ts
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genToken(len = 10) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => chars[b % chars.length]).join('');
}
```

Retry on collision (astronomically rare but handle it).

### 2. Visibility Changes (PATCH /sales/{id})

- `public → private`: generate new token, set `private_token`
- `private → public`: set `private_token = NULL`

### 3. New Endpoints

**`GET /public/search`** (no auth, gated by `ENABLE_DISCOVERY` env var)

Query params: `q` (username prefix), `country` (ISO), `city` (substring), `limit` (default 20, max 50), `offset`

Logic:
- If `q`: search `users.username LIKE q%` where `profile_public = 1`, join sales where `visibility = 'public'`
- If `country`: filter `sales.region_country = country` (+ optional `region_city LIKE %city%`)
- Only return sales from users with `profile_public = 1`
- Never return `private_token` or internal IDs

Response shape per result:
```json
{
  "type": "sale",
  "username": "matt",
  "siteName": "Matt's Moving Sale",
  "publicUrl": "https://yrdsl.app/matt/moving-sale",
  "country": "US",
  "city": "Austin",
  "itemCount": 12,
  "updatedAt": "2026-04-27"
}
```

**`GET /public/users/{username}`** (no auth, gated by `ENABLE_DISCOVERY`)

Returns profile + list of public sales if `profile_public = 1`. 404 otherwise.

**`PATCH /me`** updates

Accept `profilePublic`, `defaultRegion`, `displayName` — map to DB columns.

## Viewer-Worker Routing

### 1. **`GET /s/{token}`** (always enabled)

Look up sale by `private_token`. If found and published: render viewer (same as public sales). If not found: 404.

### 2. **`GET /{username}/`** (gated by `ENABLE_DISCOVERY`)

If `profile_public = 0`: 404. Otherwise: render profile page listing public sales.

### 3. **`GET /{username}/{slug}`** (always enabled)

Only serve if `visibility = 'public'`. If sale exists but is private: 404 (not redirect — don't leak existence).

## Verification Checklist

- [ ] D1 migration applied
- [ ] Private token generation works, retries on collision
- [ ] `GET /public/search` returns correct shape, respects ENABLE_DISCOVERY gate
- [ ] `GET /public/users/{username}` returns 404 for private profiles
- [ ] `GET /s/{token}` serves private sales by token
- [ ] `GET /{username}/` respects profile_public gate
- [ ] `GET /{username}/{slug}` returns 404 for private sales (no redirect)
- [ ] `PATCH /me` accepts and persists profilePublic, defaultRegion, displayName
- [ ] All with ENABLE_DISCOVERY=false: search endpoints return 503, profile/user listing routes return 404

## Public Repo Context

The public repo (yrdsl/yrdsl-self-hosted) now includes:

- **schemas**: visibility, privateToken, region on SaleSite; profilePublic, displayName, defaultRegion on UserPublic
- **MCP tools**: create_sale + update_site accept visibility + region params; API returns `/s/{token}` publicUrl for private sales
- **Landing page**: Search UI with username search + region browse, feature-flagged by ENABLE_DISCOVERY constant, full i18n (en, de, es, fr, ja, pt, zh)
- **D1 migration file**: migrations/0002_privacy_region.sql (ready to apply)

The public repo is complete and pushed. This document captures what remains for the private repo.
