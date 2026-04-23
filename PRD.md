# yrdsl.app Product Requirements Document

**Status:** Draft v2
**Owner:** Matt Reider (mreider@gmail.com) / Kuvop LLC
**Last updated:** 2026-04-20
**Target v1 launch:** TBD (see §16)

---

## 1. Summary

yrdsl.app is a way to run beautiful, low-friction personal yard sales. **Think
of it as an online flyer on a utility pole**, with search, tags, and one link
to share. The site is a billboard: all buyer/seller coordination happens
outside the platform (email, SMS, WhatsApp, in person). We don't mediate
payments, don't run a chat inbox, don't take a cut. We just make your stuff
look great and easy to browse.

**Two distribution modes off the same renderer** (see §4.4 for detail):

- **Hosted** at `yrdsl.app` / `app.yrdsl.app`. Multi-sale accounts, email
  confirmation, invite-only beta, Claude-over-MCP, metered billing. Operated
  by Kuvop LLC. This is the commercial path.
- **Self-hosted** via the [`yrdsl-self-hosted`](https://github.com/KuvopLLC/yrdsl-self-hosted)
  template. A single yard sale as a static site on GitHub Pages. Edit
  `site.json` + `items.json`, push, GitHub Actions deploys. No backend, no
  auth, no billing. Claude edits the repo locally via Claude Code.

Both modes produce byte-for-byte identical JSON for the viewer, so data
portability between them is trivial.

The web app SPA lives at `app.yrdsl.app` on Cloudflare Pages. The landing
page at `yrdsl.app` is a static GitHub Pages site. The public sale viewer
(hosted) at `yrdsl.app/{user}/{slug}` ships in M2 as a Cloudflare Worker
route. The repository is Apache 2.0 on GitHub under the Kuvop OSS family
(<https://oss.kuvop.com>).

---

## Implementation status

Quick reference for what's live vs. deferred vs. cut. Detailed feature
specs remain in §6; milestone notes in §16. Update this table on every
PR that flips a row.

**Legend:**
✅ live = shipped, exercised by tests.
🟡 partial = working but intentionally incomplete.
🔴 deferred = planned, no code or schema yet.
❌ cut = removed; will require rebuilding if re-added.

| Area | Status | Where | Notes |
|---|---|---|---|
| Signup + login + password reset + tokens | ✅ | §6.1-6.3 | Invite-gated until `REQUIRE_INVITE=false`. Resend using `onboarding@resend.dev` pending domain verification. |
| Sale + item CRUD | ✅ | §6.4 | Includes slug generation. Slug rename → old URL 404s (no redirect table). |
| Editor (web SPA) | ✅ | §6.8 | Photo upload is multi-file with progress; ↑/↓ reorder; live preview; export-as-ZIP; self-serve delete. |
| Multi-image items | ✅ | §6.8 | Card shows count pill; modal is a carousel (arrows, dots, keyboard, swipe). |
| Published viewer (hosted) | ✅ | §6.14 | viewer-worker on `yrdsl.app/*` overlays GH Pages; OG + Twitter cards pre-rendered; sitemap + robots.txt. |
| Self-hosted template | ✅ | §4.4, M2.5 | `KuvopLLC/yrdsl-self-hosted`. Auto-refreshes vendored code on monorepo pushes. |
| MCP (`@yrdsl/mcp`) | ✅ | §6.9 | One binary, hosted + local backends. Tools: list/create/get/update sales; list/find/recent/get/add/update/delete/reserve/unreserve items; publish/unpublish; attach_image_from_url; draft_item_from_url; commit_and_push. Returns `publicUrl` everywhere. |
| Export as ZIP | ✅ | §6.10 | Matches self-hosted template layout. Session-only (no bearer-token callers). |
| Hardening | ✅ | §14, M6 | CSRF double-submit, CSP, HSTS, HIBP, Turnstile (test keys), rate limits, bundle-size budget. |
| Observability | ✅ | §15 | `console.log` → Cloudflare Workers Logs. No third-party error tracker. |
| Image moderation (NSFW/CSAM) | 🔴 | §6.8 | Policy decision pending. PhotoDNA partnership + TOS call needed first. |
| Themes | 🟡 | §6.5 | All 4 imported. Claude Designer pass not done (M4). |
| i18n | 🔴 | §6.6-6.7 | `packages/i18n` doesn't exist. M4. |
| Billing / metering | 🔴 | §6.11-6.13, M5 | **No code, no schema.** `meter_events` + `subscriptions` tables were dropped to avoid empty-scaffolding confusion. Rebuilding needs: Stripe SDK + customer portal, meter collectors in api-worker + cleanup-worker, monthly aggregation cron, `subscriptions` + `meter_events` tables re-added, usage forecast card (design-heavy), payment-failure grace state. §6.11 spec preserved for reference. |
| Archive (sale state) | ❌ | was §6.10 | Cut. `unpublish` covers "hide it." `delete` covers "really gone." Two states are enough. |
| Sale slug redirects (30-day) | ❌ | was §6.4 | Cut. Old slugs 404 on rename. Add back when someone actually complains. |
| "Curator's order" sort | ❌ | was §6.8 | Cut. Redundant with newest-first. `sortOrder` is a same-day tie-breaker only now. |
| `about` / `endsAt` / `useRelay` schema fields | ❌ | was §6.4, §6.5 | Cut from canonical SaleSite. Re-add when the rendering exists to justify them. |
| Item `slug` field | 🟡 | §6.4 | Still generated + stored (export uses it). Dead in the hosted viewer — deep-link is `#{itemId}`. Low-value cleanup target. |
| Custom domains on sales | 🔴 v2 | §17 | |
| Buyer accounts / platform messaging | 🔴 v2 | §17 | |
| Mobile-native app | 🚫 out | §17 | Claude mobile covers the use case. |

---

## 2. Vision and marketing wedges

Four explicit wedges against existing marketplace platforms (eBay, Facebook
Marketplace, Craigslist, Mercari):

1. **No percentage cut.** Flat metered subscription. Seller keeps 100% of every sale.
2. **No monthly minimum. No lock-in.** Pure metered: you pay for storage you're keeping
   and requests you're receiving, nothing else. When a sale is over, **Export & delete**
   downloads a ZIP of the full sale and removes it from our servers. Your bill drops
   to $0. No dormant subscription fee, ever. (An optional **archive** state keeps the
   sale accessible to you at a small storage cost. It's a convenience, not the
   zero-cost path.)
3. **Fairness tied to real COGS.** Price scales with storage and request volume. Not
   number of items, not sale value. Because that's what Cloudflare actually charges
   us. Shown transparently as a forecast card in settings.
4. **Buyers contact you directly.** We're a billboard, not a marketplace inbox. You
   list your email, SMS, or WhatsApp (your choice, any combination) and your neighbors
   reach out on their own. No platform messages, no "are you still interested?" spam,
   no algorithmic feed. If you want a little privacy, we offer an optional
   email-obscured relay. But it's opt-in; the default is direct contact.

Additional positioning:
- **Own your data.** JSON files on your disk, readable without the app.
- **Claude-native.** Create and manage sales from your phone by talking to Claude.
- **Open source.** Fork it, self-host it, contribute translations. Apache 2.0.

---

## 3. User personas

- **Solo seller (primary).** Home declutter, estate sale, moving sale. Wants a
  beautiful gallery page to share in a text, a neighborhood FB group, or an email.
  Not a power user. Drafts in the browser on a laptop, adds items on the fly from
  their phone by talking to Claude.
- **Power user / hobbyist reseller.** Runs multiple sales over time. Does nearly
  everything through Claude conversations. Cares about archiving, themes, maybe
  custom domains later.
- **Contributor.** Developer who cares about OSS, submits translation PRs or theme
  tweaks.

---

## 4. Product architecture

### 4.1 Surfaces

| Surface | Role | Editable? |
|---|---|---|
| `yrdsl.app` web app | Signup, account, billing, yard sale editor, published viewer. The one codebase for humans. | Yes (auth-gated routes) |
| Claude (mobile / Desktop / web) via MCP | Hands-free editor via tool calls. Same account, same API tokens. | Yes |
| `yrdsl.app/{user}/{slug}` | Published yard sale viewer (subset of the web app) | No (public) |
| `yrdsl.app` root landing | Marketing + "Start free" CTA | No |

Everything you can do in the browser, you can do by talking to Claude. And vice
versa. There is no desktop app, no install, no sync engine.

### 4.2 Component map

```
┌─────────────────────────┐     ┌─────────────────────────┐
│  Web app (yrdsl.app)    │     │  Claude (mobile/desktop)│
│  - Browser, IndexedDB   │     │  - Custom MCP connector │
│    draft queue          │     │    (bearer token)       │
└───────────┬─────────────┘     └────────────┬────────────┘
            │  REST API (session cookie)      │  MCP over HTTPS (bearer token)
            └───────────────┬─────────────────┘
                            │
                ┌───────────▼───────────────────┐
                │  Cloudflare Worker API        │
                │  - Auth, accounts, billing    │
                │  - Yard sale CRUD             │
                │  - Token mgmt                 │
                │  - MCP server endpoint        │
                │  - Meter collector            │
                └───┬──────────┬─────────┬──────┘
                    │          │         │
               ┌────▼───┐  ┌───▼───┐  ┌──▼─────┐
               │  D1    │  │  R2   │  │  KV    │
               │  (SQL) │  │(blobs)│  │(cache, │
               │        │  │       │  │ rate)  │
               └────────┘  └───────┘  └────────┘

                ┌──────────────────────────────┐
                │  Published sale viewer       │
                │  (Worker-rendered static)    │
                │  yrdsl.app/{user}/{slug}     │
                └──────────────────────────────┘

                ┌──────────────────────────────┐
                │  Landing page                │
                │  (GH Pages, static)          │
                │  yrdsl.app root              │
                └──────────────────────────────┘
```

### 4.3 Draft + sync model

Cloud is the source of truth. No local filesystem workspace.

- **Online editing:** every change saved to server on blur / debounce. Published
  sale updates via cache-busted reload.
- **Offline / flaky connection:** edits queue in IndexedDB with a status indicator
  ("3 unsaved changes. Will sync when you're back online"). Queue flushes
  automatically on reconnect.
- **Concurrent edits (web tab + Claude):** per-item last-write-wins using server
  `updated_at`. The other tab sees an in-app toast ("Claude just updated this
  item. Refresh to see changes") so the user doesn't overwrite silently.
- **Own-your-data:** `Export & delete` (§6.10) produces a ZIP of the full sale
  for offline keeping. The exported ZIP is a valid `yrdsl-self-hosted` template,
  so users can drop hosted data into a fork and keep their sale running on
  GitHub Pages without us.

### 4.4 Distribution modes

yrdsl.app ships in two flavors that share the renderer and the JSON schema:

| | **Hosted** (yrdsl.app) | **Self-hosted** (template) |
|---|---|---|
| Audience | Beta → public users | Developers / OSS community |
| Sales per install | Many users × many sales | One user, one sale |
| Backend | api-worker + D1 + R2 + KV + Resend + Stripe | **None** (static GitHub Pages) |
| Auth | Email + password + sessions + API tokens | **None** (the repo is auth) |
| Editor | React SPA at `app.yrdsl.app` | Local JSON files, edited with Claude Code or any text editor |
| Claude integration | MCP connector over HTTPS with bearer token | **Claude Skill** (`SKILL.md`) consumed by Claude Code's built-in Read/Edit/Bash |
| Photos | R2 with signed URLs | `public/photos/` in the repo |
| Buyer reaches seller | mailto/SMS/WhatsApp links + optional Resend relay (§6.5) | mailto/SMS/WhatsApp links only |
| Reserve flow | API call updates D1, seller gets email | Seller edits `items.json` and pushes |
| Deploy | CF Pages + CF Workers (CI on push to yrdsl.app repo) | `git push` → GH Actions → GitHub Pages |
| Shape | Served by `GET /sales/{user}/{slug}` (M2) | Hand-authored `site.json` + `items.json` |

**Shared code:** the renderer (`packages/viewer`) and schemas
(`packages/core`) are consumed by both. The self-hosted template vendors a
copy of those packages; the monorepo's `apps/web` imports them directly.
Identical JSON shape → identical renders.

**Claude integration parity:** the two modes expose different tool
mechanics but the same mental model. In hosted mode Claude calls MCP tools
(`add_item`, `mark_reserved`, etc.) that translate to REST/D1 writes. In
self-hosted mode Claude uses its own file-editing tools against a repo
clone; the `SKILL.md` at the template root documents the file layout so
Claude knows which file to touch for which operation.

**Related repos:**
- Main monorepo (this repo): <https://github.com/KuvopLLC/yrdsl>
- Self-hosted template: <https://github.com/KuvopLLC/yrdsl-self-hosted>
- Live self-hosted example: <https://github.com/mreider/yrdsl-example>
  (deployed to <https://mreider.github.io/yrdsl-example/>)

---

## 5. Repository structure (monorepo)

```
yard-sale/
├── apps/
│   ├── landing/               # yrdsl.app root marketing page (GH Pages)
│   ├── web/                   # app.yrdsl.app SPA (React + Vite, CF Pages)
│   └── landing/               # yrdsl.app root marketing (static, GH Pages)
├── packages/
│   ├── core/                  # Shared zod schemas (auth, invite, sale, user, token)
│   ├── viewer/                # React renderer for a yard sale; consumed by apps/web + self-hosted template
│   ├── themes/                # 4 themes: conservative, retro, hip, artsy
│   ├── i18n/                  # Locale files, contributor entrypoint (planned)
│   └── sdk/                   # TS client for REST + MCP (planned)
├── services/
│   ├── api-worker/            # Cloudflare Worker: REST API, auth, billing
│   ├── cleanup-worker/        # Scheduled cleanup jobs (sessions, expired invites, etc.)
│   ├── mcp-worker/            # Cloudflare Worker: MCP server (planned)
│   └── meter-worker/          # Usage aggregation, Stripe meter reporting (planned)
├── migrations/                # D1 schema migrations
├── .github/
│   └── workflows/             # CI, deploy-workers, deploy-landing, deploy-web
├── ops/                       # Cloudflare-resources notes and other runbooks
├── PRD.md
├── LICENSE                    # Apache 2.0
├── README.md
└── package.json

# Separate repos (not part of this monorepo):
KuvopLLC/yrdsl-self-hosted/     # Template for the self-hosted mode
mreider/yrdsl-example/         # Live demo of a self-hosted site
```

Tooling: pnpm workspaces + turborepo. TypeScript everywhere. Wrangler for workers.

---

## 6. Feature specifications

### 6.1 Signup with field validation (req #1)

- Fields: email, password, display name, optional username (auto-suggested from
  email local-part), optional invite code (see "Invite-only beta" below).
- Client-side + server-side validation (same rules, shared package).
  - Email: RFC 5322 regex + MX record check on server.
  - Password: minimum 10 chars, not a substring of the email prefix, not in HIBP k-anonymity check. No composition rules (NIST SP 800-63B); HIBP is the real signal.
  - Username: `[a-z0-9][a-z0-9-]{1,29}`, not in reserved list (admin, api, app, www,
    help, about, pricing, login, signup, etc.), case-insensitive unique.
  - Display name: 1–80 chars, trimmed, no control chars.
- Server responds with field-level error shape: `{ errors: { email: "...", ... } }`.
- Account created in `pending_confirmation` state. Confirmation email dispatched
  (see §6.2).

**Invite-only beta gating** (added 2026-04-20):

- The `REQUIRE_INVITE` worker var (default `"true"` during beta) makes
  signup require a valid unused single-use invite code. Codes are 12-char
  ambiguous-stripped alphanumeric (no I/L/O/0/1).
- One bootstrap exception: if the signup email matches `BOOTSTRAP_ADMIN_EMAIL`
  (case-insensitive, currently `mreider@gmail.com`), the invite check is
  skipped and the user is seeded with `is_admin = 1`. This is how the first
  admin gets in.
- Admins (only path: bootstrap or DB flip) can mint / revoke / list codes
  at `app.yrdsl.app/admin`. Codes have an expiry (default 30d) and a free-form
  note. Invitee URL is `https://app.yrdsl.app/signup?invite=CODE` which
  pre-fills the code field.
- Schema: `invites` table; `users.is_admin` column. See `migrations/0001_init.sql`.
- To go public: set `REQUIRE_INVITE = "false"` in `services/api-worker/wrangler.toml`
  and redeploy.

### 6.2 Email confirmation via Resend (req #2)

- Confirmation token: 32-byte random, base64url-encoded. 24h expiry. Single-use.
- Stored as SHA-256 hash + expiry in D1.
- Email: plain-text + HTML, branded, clear CTA. Delivered via
  [Resend](https://resend.com). 3k emails/month free covers beta. Beta uses
  Resend's shared `onboarding@resend.dev` sender (no domain verification
  needed); production flips `EMAIL_FROM` to `yrdsl.app <noreply@send.yrdsl.app>`
  once the `send.yrdsl.app` subdomain is verified (DNS records added to
  Cloudflare automatically via the same script that bootstrapped the zone).
- Clicking link hits `GET /confirm?token=...` → marks `email_confirmed_at`, redirects
  to login with success flash.
- Resend flow: rate-limited to 3 per hour per account.
- Unconfirmed accounts cannot publish yard sales (can sign in, see a banner prompting
  confirmation, but publish API returns 403).

### 6.3 Profile management (req #3, 4, 5)

All profile UI lives behind the avatar click in the web app. That is the single
source of truth for account management. Claude can read/update profile fields via
MCP tools for users who prefer chat.

**Profile fields editable:**
- Display name
- Avatar (see §6.3.1)
- Password (requires current password; zxcvbn same rules; all active sessions
  invalidated on change; email notification)
- Default language
- Default theme for new sales

**Avatars (req #4):**
- Accepted formats: PNG, JPEG, WebP.
- Max upload: 4 MB. Min dimensions: 128×128. Max dimensions: 4096×4096.
- Server-side: decode, EXIF-strip, re-encode to 512×512 WebP (center-cropped square).
  Store in R2. Serve via `/avatar/{user_id}` with 1-day cache.
- Reject anything we can't decode or whose actual content-type doesn't match claimed.
- Error messages are **specific**: "Avatar must be PNG, JPEG, or WebP. You uploaded
  `.heic`. Export as JPEG and try again." Not just "invalid file."
- Default avatar: deterministic geometric pattern generated from user_id hash.

**API tokens (req #5):**
- Create: user provides name ("iPhone Claude"), scope (`read`, `write`, `admin`),
  optional expiry (none / 30d / 90d / 1y).
- Token format: `yrs_live_` + 22-char nanoid. Short enough to paste cleanly into
  Claude mobile's connector field.
- Shown exactly once, on creation, with copy-to-clipboard.
- Stored: SHA-256(token) + prefix (for list display: `yrs_live_abc…xyz`).
- List shows: name, scope, prefix, `last_used_at`, `last_used_ip`, created, expires.
- Revoke: one click, instant invalidation. Cached auth invalidated ≤10s.

### 6.4 Yard sale CRUD (req #6, 7)

**Creation.** Confirmed users only. Fields: title, description, slug (auto from
title, editable), theme, language, cover image. Defaults come from profile defaults.

**Edit.** All fields editable. Slug changes preserve old URL with 301 redirect for
30 days (cached in KV).

**Delete.** Two-step modal: "Are you sure you want to delete *{title}*? This removes
all items and images. Type `{slug}` to confirm." Delete is soft for 30 days (reversible
from trash), hard after.

**Items.** Each yard sale holds items matching today's `items.json` shape, extended:
```jsonc
{
  "id": "couch-01",
  "slug": "mid-century-sectional",
  "title": "Mid-century sectional sofa",
  "price": 450,
  "currency": "USD",
  "tags": ["furniture", "living room"],
  "added": "2026-04-17",
  "images": ["cdn-path-1.jpg", "cdn-path-2.jpg"],
  "description": "…",
  "reserved": null,
  "updated_at": "2026-04-17T14:02:00Z"
}
```

**Contact methods on the sale (new).** Per-sale settings, stored as columns on the
`sales` row. All optional; at least one must be set before publishing:

- `contact_email`. Plain string. Rendered as a `mailto:` link on the public page.
- `contact_sms`. Phone number. Rendered as `sms:`.
- `contact_whatsapp`. Phone number. Rendered as `https://wa.me/{digits}`.
- `contact_use_relay` (bool). If true AND `contact_email` is set, the public page
  shows a Resend-backed form instead of the plain `mailto:`. The form posts to
  an "email relay" endpoint (folded into `api-worker` during M2) which
  obscures the seller's address. Opt-in privacy path.
- `contact_notes`. Short free-text instruction shown next to contact buttons
  ("Text between 9-5 please", "Cash on pickup"). Max 200 chars.

The public sale page renders a compact "How to reach @{username}" panel with
whichever methods are set. No platform chat. No reservation queue. The seller
marks items reserved themselves (in the editor or by telling Claude).

### 6.5 Themes. 4 styles (req #8)

Internal IDs in parentheses; consumer-facing display names match the landing page
so marketing copy and product stay in lockstep.

- **A. Clean** (`conservative`, default). Neutral grays, system sans, restrained.
- **B. Magazine** (`artsy`). Editorial, serif display, generous whitespace,
  image-forward.
- **C. Bold** (`hip`). Bold color, sans display, high-contrast, dense grid.
- **D. Retro** (`retro`). 70s garage-sale poster aesthetic. Warm palette, slab
  serif, grain texture.

**Implementation:** CSS design tokens (CSS custom properties) per theme + a small
set of theme-specific layout modules. Themes swap at runtime by toggling a
`data-theme` attribute; no page reload.

**Design source:** generated via **Claude Designer** (new Anthropic feature). Each
theme gets a design doc + token file. *Note: the PRD author will confirm Claude
Designer's current interface before producing the tokens. Theme specs are
intentionally abstract until that's done.* Deliverable per theme: light + dark
variants, component library coverage (card, chip, modal, form, button, banner,
nav).

### 6.6 i18n. User language preferences (req #9)

- Default detection order: explicit user profile setting > geo-IP lookup
  (Cloudflare `cf.country` header → language map) > `Accept-Language` > `en`.
- Geo-IP covers **chrome only** (nav, labels, empty states). User-authored content
  (titles, descriptions) is never auto-translated.
- Locale JSON files in `packages/i18n/locales/{lang}.json`. Key-based with ICU
  message format for plurals.
- Published sale pages render in the sale's language, not the viewer's language
  the seller picked it deliberately.

### 6.7 Translation PRs (req #10)

- Contributor copies `packages/i18n/locales/en.json` to `{lang}.json` and translates
  values. Keys stay English.
- CI check validates: JSON parses, all keys from `en.json` present, no empty strings,
  ICU messages parse.
- A `crowdin.yml`-style config file lists supported languages and display names for
  the picker.
- On merge to `main`, release workflow ships the new locale with the next build.
- Contributing guide in `CONTRIBUTING.md` documents the workflow in 10 lines.

### 6.8 Web editor (req #13)

The web editor at `yrdsl.app/app` is where authenticated users create and manage
their yard sales. Same codebase as the public viewer with auth-gated routes.

**Key flows (all work offline via IndexedDB draft queue):**
- New yard sale (picks theme, language from profile defaults)
- Add / edit / delete items with inline editing
- Drag-and-drop image import directly into an item card (or multi-file drop to
  bulk-create items)
- Live preview pane. Same renderer as the public viewer, so WYSIWYG
- Theme switcher previews all four themes side-by-side
- Archive / Export & delete / Delete actions with destructive-confirm modals

**Image pipeline (client-side before upload):**
- Drop → read file → decode in a Web Worker → validate format (PNG/JPEG/WebP)
  and dimensions (min 512×512, max 8192×8192)
- Resize to 2048px on longest edge (preserve aspect), re-encode as WebP quality 85
- Strip EXIF in the encoder path (never kept)
- Upload to R2 via signed PUT URL returned from `POST /uploads/sign`
- Server re-validates bytes match claimed mime; stores final object key on the item

**Offline draft queue:**
- All mutations go through a single `queueWrite(op)` function that persists to
  IndexedDB then dispatches to the API.
- On failure (network, 5xx), op stays queued; UI shows an unsynced badge on the
  item and an aggregate "3 unsaved changes" indicator in the nav.
- On reconnect or manual retry, queue flushes in order. Conflicts resolved per
  §4.3.

**Auth.** Standard session cookie after signup/login. API tokens (§6.3) are for
Claude MCP and scripts, not for the web editor itself.

### 6.9 Claude mobile access via remote MCP (req #13, extended)

**Endpoint.** `https://mcp.yrdsl.app`. Standalone Cloudflare Worker implementing
the MCP-over-HTTPS spec.

**Auth.** Bearer token in `Authorization` header. Token created in the web app's
settings → API tokens (§6.3). User pastes URL + token into Claude's "Add custom
connector" (mobile or desktop). Connector stays attached to the user's Claude
account.

**Distribution for v1:** **not** listed in Anthropic's public connector directory.
Custom URL + paste-in token only. Keeps launch friction on our side to zero and
avoids directory review. Revisit for v2.

**Tool surface:**
| Tool | Scope | Purpose |
|---|---|---|
| `list_sales` | read | Returns all sales (incl. Archived) |
| `get_sale` | read | Full sale + items |
| `create_sale` | write | New draft sale |
| `update_sale` | write | Metadata edits |
| `archive_sale` | write | Set archived (stays stored, small ongoing meter) |
| `export_sale` | write | Returns a time-limited signed URL to a ZIP of the full sale |
| `delete_sale` | admin | Hard delete (use after `export_sale` for the $0 path) |
| `list_items` | read | Items in a sale |
| `add_item` | write | Create item, image accepts base64 or URL |
| `update_item` | write | Any field |
| `mark_reserved` | write | Set reserved metadata |
| `remove_item` | write | Delete item |
| `upload_image` | write | Direct base64 blob → R2 |
| `get_usage` | read | Current month meter + forecast |

**Photo flow from phone.** User attaches camera photo to Claude chat. Claude sees
it (vision), optionally describes/enhances, calls `add_item(base64_image, title,
price, ...)`. MCP server decodes, validates, uploads to R2, creates item. End-user
never touches a file picker.

**Rate limits.** 60 tool calls / min / token. Per-token + per-account overall quotas.

### 6.10 End-of-sale flows (req #13, new)

> **Cut:** Archive was a third state between "published" and "deleted" that
> served 410 with a "no longer viewable" page. It was removed during
> cleanup — `unpublish` and `delete` cover the same surface with less
> code. If a paid archive tier becomes useful later (billable "keep it
> around" state), re-introduce `archived_at` + a sentinel renderer.

Two end-of-sale verbs today:

**Unpublish**
- `published_at = NULL`. Public URL 404s. Owner dashboard still lists it.
- Reversible: click Publish again.
- Images stay in R2. When billing ships (M5), this accrues storage meter.

**Export & delete** (the real $0 path)
- Packages every item's metadata + all images into a single ZIP download, streamed
  on the fly from R2.
- Confirms download completed in the browser, then hard-deletes the sale and
  all associated blobs from our systems.
- Public URL 404s.
- After Export & delete, this sale contributes **$0** to your bill forever.
- Good for: sales that are done and you want to stop paying for.

**Delete** (no export)
- Soft-delete for 30 days (recoverable), then hard purge.
- For when you don't need a copy and just want it gone now.

A user with zero stored sales pays $0. Period. The "no lock-in" wedge is literal,
but the user has to actively choose Export & delete (or Delete) to get there.

### 6.11 Billing. Pure metered subscription (req #11, #12)

> **Deferred (M5):** No billing code ships today. The `meter_events` and
> `subscriptions` tables have been dropped from the D1 schema to avoid
> empty-scaffolding confusion; the spec below stays in place as the
> design doc for when we build it. Re-adding will need: Stripe SDK +
> customer portal, meter collectors in api-worker + cleanup-worker,
> monthly aggregation cron, the two tables re-created, usage forecast
> card UI, payment-failure grace state. See §16 → M5 for the phased
> build plan.

**This is a volume business.** Rates are deliberately very cheap. A typical casual
yard sale bills out at roughly **10 cents a month**. Revenue comes from many users
paying a little, not a few paying a lot. The pricing model accepts thin per-user
margins in exchange for "cheapest way to run a yard sale online" being a durable
marketing wedge.

**Processor:** Stripe, using Stripe Metered Billing (usage-based pricing).

**Actual Cloudflare COGS** (the denominator we reason from):

| Resource | Cost |
|---|---|
| R2 storage | $0.015 / GB-month |
| R2 Class B reads (image fetch) | $0.36 / 1M |
| Worker requests | $0.30 / 1M (after 10M free) |
| R2 egress | **$0**. No bandwidth bill, ever |

**Metered dimensions and rates** (v1. Revisit at 6 months of live data):

| Dimension | Rate | Markup vs COGS |
|---|---|---|
| Storage | **$0.05 / GB-month** (prorated daily) | ~3× |
| Published page views | **$0.05 / 1,000** | ~36× (but absolute cost tiny) |
| API + MCP requests | **$0.10 / 1,000** | ~3–10× |

**Representative monthly bills**:

| Sale profile | Storage | Views | API calls | **Total** |
|---|---|---|---|---|
| Casual (30 MB, 1.5k views, 100 edits) | $0.002 | $0.075 | $0.01 | **~$0.09** |
| Estate (3 GB, 20k views, 500 edits) | $0.15 | $1.00 | $0.05 | **~$1.20** |
| Viral (5 GB, 100k views, 2k edits) | $0.25 | $5.00 | $0.20 | **~$5.45** |

**$0 floor.** No base fee. A user with 0 bytes stored and 0 requests pays $0. Reached
via **Export & delete** or **Delete** on every sale (§6.10). Archived sales continue
to incur a small storage fee. That's a user choice, not a lock-in.

**Minimum billable invoice.** Stripe won't process sub-cent charges, and it's silly
to invoice someone for $0.04. The worker aggregates metered usage across the month;
if the computed total is under **$0.50**, we **don't bill**. It rolls forward to
the next month. At $0.50+ we invoice. Over 12 months a lot of casual users never
cross the threshold → they effectively use the service free. We're OK with that:
acquisition cost of a user who eventually runs a big sale or stays for years is
higher than the sub-dollar we'd have collected.

**Overage:** N/A. It's metered. Every unit is billed (subject to the floor above),
there is no cap to exceed.

**Billing cycle:** calendar month. Invoice issued day 1, charged day 3. Skip if
under the $0.50 threshold.

### 6.12 Usage forecast card (req #12)

In profile/settings, a prominent card titled **"This month's projection"** that
shows:

- Current storage (GB) with a sparkline of the last 30 days
- Published page views this month (count)
- API + MCP requests this month (count)
- **Projected month-end bill** ($X.XX) with a breakdown tooltip
- A "Why am I being charged this?" link that opens a plain-language explainer with
  the COGS logic ("We pay Cloudflare $Y; we charge you $Z; here's the math")
- Per-sale breakdown table: which sales are driving the bill. Each row has an
  inline **"Export & delete"** action so the user can make a specific sale's cost
  go to zero in one click. The UI makes it trivial to reach $0.

**Design priority:** this card is the single most important piece of UI for the
trust/fairness wedge. It should feel like Monzo or Stripe's spend summaries. Clean,
honest, with enough transparency to earn trust but not overwhelm. This gets an
unusual amount of design attention.

### 6.13 Payment-failure disabled state (req #14, clarified)

- "Disabled when volume exceeds subscription" re-interpreted for pure metered:
  **the only way to be disabled is payment failure.**
- Card declined → email user + 7-day grace period.
- During grace: published sales stay up, red banner in the web app's nav and on
  every editor screen, MCP tools return a `payment_required` error with a clear
  "renew at yrdsl.app/billing" message.
- After grace: all published sales return the same archive-style page ("Sorry. This
  yard sale is temporarily unavailable"). Data is preserved; no hard delete.
- On payment success: immediate reactivation.

### 6.14 Landing page + distribution (req #14, distribution portion)

- `yrdsl.app` root = GitHub Pages site from `apps/landing`. Polished hero +
  phone mock + pricing + theme switcher + OSS callout linking to the
  self-hosted template + live example.
- Hero CTA: **"Sign up"** linking to `https://app.yrdsl.app/signup`.
  Eyebrow says "Invite-only beta" until §6.1 flips public.
- Secondary links: pricing, themes, GitHub, how-it-works, releases, Kuvop OSS.
- Landing page deploys to GitHub Pages on every `main` merge via
  `.github/workflows/deploy-landing.yml`.
- **Account SPA at `app.yrdsl.app`** (Cloudflare Pages, separate from the
  landing). Deploys via `.github/workflows/deploy-web.yml`. CNAME `app.yrdsl.app`
  → `yrdsl-app.pages.dev` lives in the Cloudflare zone.
  Decision change: the original PRD called for a Cloudflare Worker route
  overlaying GH Pages at `yrdsl.app/app/*`. We chose CF Pages on a subdomain
  instead (simpler routing, faster deploys, easier to swap rendering
  strategies in M2). The published sale viewer at `yrdsl.app/{user}/{slug}`
  still uses the Worker-route approach in M2 because it needs to colocate
  with the marketing root.
- **Self-hosted distribution** (see §4.4): the OSS template at
  `KuvopLLC/yrdsl-self-hosted` + live demo at `mreider/yrdsl-example` give
  the OSS audience a single-sale path that doesn't touch our infrastructure.

---

## 7. Technical stack

| Layer | Choice | Rationale |
|---|---|---|
| Monorepo tooling | pnpm + turborepo | Fast, well-supported |
| Language | TypeScript everywhere | One ecosystem |
| API server | Cloudflare Workers + Hono | Matches inexpensive-scaleable requirement |
| DB | Cloudflare D1 (SQLite) | Free tier is generous; no infra |
| Blob storage | Cloudflare R2 | No egress fees. Huge COGS win |
| Cache / rate limiting | Cloudflare KV + Durable Objects | Native to Workers |
| Email | **Resend** (3k free/mo) | **Auth only** (signup confirm + password reset) plus **opt-in per-sale obscured-email relay**. Sending domain `send.yrdsl.app` (once verified; beta uses `onboarding@resend.dev`). Not used for buyer/seller coordination by default. That's direct email/SMS/WhatsApp (§6.4). |
| Payments | Stripe (metered) | Best metered billing support |
| Web UI | React + Vite | Single SPA for landing + editor + viewer |
| Testing | Vitest (unit + integration via miniflare). Manual UI smoke. | Browser-automation suites are explicitly out of scope (see §12). |
| i18n | i18next with ICU plugin | Supports required workflow |
| Auth | Email+password (argon2id), JWT sessions, API tokens | Standard |
| MCP | Anthropic MCP over HTTPS | Per mobile connector support |

---

## 8. Data model (D1 / SQL)

```sql
-- Users
CREATE TABLE users (
  id               TEXT PRIMARY KEY,            -- ULID
  email            TEXT NOT NULL UNIQUE,
  email_confirmed_at INTEGER,
  password_hash    TEXT NOT NULL,               -- argon2id
  username         TEXT NOT NULL UNIQUE,
  avatar_key       TEXT,                        -- R2 object key
  default_language TEXT NOT NULL DEFAULT 'en',
  default_theme    TEXT NOT NULL DEFAULT 'conservative',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- Email confirmation tokens
CREATE TABLE email_confirmations (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

-- API tokens
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,                   -- first 12 chars for UI
  scope        TEXT NOT NULL,                   -- read | write | admin
  expires_at   INTEGER,
  last_used_at INTEGER,
  last_used_ip TEXT,
  created_at   INTEGER NOT NULL
);

-- Yard sales
CREATE TABLE sales (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  theme             TEXT NOT NULL DEFAULT 'conservative',
  language          TEXT NOT NULL DEFAULT 'en',
  cover_key         TEXT,                       -- R2 object key
  -- Contact methods (§6.4). At least one must be set before publishing.
  contact_email     TEXT,
  contact_sms       TEXT,
  contact_whatsapp  TEXT,
  contact_notes     TEXT,                       -- short instruction, max 200 chars
  deleted_at        INTEGER,                    -- soft-delete
  published_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (user_id, slug)
);

-- Items
CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  price_cents  INTEGER,
  currency     TEXT NOT NULL DEFAULT 'USD',
  tags         TEXT,                            -- JSON array
  images       TEXT,                            -- JSON array of R2 keys
  reserved     TEXT,                            -- JSON or NULL
  sort_order   INTEGER NOT NULL DEFAULT 0,
  added_at     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (sale_id, slug)
);

-- M5 tables (meter_events, subscriptions) intentionally NOT in the
-- current schema. They lived here earlier as empty scaffolding. The
-- design is preserved in §6.11; re-add when billing ships.
```

---

## 9. API surface

### 9.1 REST (for web app)

Base URL: `https://api.yrdsl.app/v1`

Auth: `Authorization: Bearer yrs_live_...` for tokens, or session cookie for web.

```
POST   /auth/signup
POST   /auth/login
POST   /auth/logout
POST   /auth/confirm
POST   /auth/resend-confirmation
POST   /auth/forgot-password
POST   /auth/reset-password

GET    /me
PATCH  /me
PUT    /me/avatar
PUT    /me/password

GET    /me/tokens
POST   /me/tokens
DELETE /me/tokens/:id

GET    /me/usage
GET    /me/billing

GET    /sales
POST   /sales
GET    /sales/:id
PATCH  /sales/:id
POST   /sales/:id/archive
POST   /sales/:id/unarchive
POST   /sales/:id/export         # returns signed URL to ZIP; streams from R2
DELETE /sales/:id

GET    /sales/:id/items
POST   /sales/:id/items
PATCH  /sales/:id/items/:item_id
DELETE /sales/:id/items/:item_id

POST   /uploads/sign             # pre-signed R2 PUT URL

# Optional email-obscured relay (only when seller has contact_use_relay=true):
POST   /sales/:id/relay-contact  # Resend-backed form; new endpoint in
                                 # api-worker (M2).
```

### 9.2 MCP tools

Covered in §6.9.

### 9.3 Public viewer

`GET yrdsl.app/{username}/{slug}`. Served by a Worker that:
1. Looks up the sale (D1, KV-cached).
2. If archived/disabled → static 410 page.
3. Otherwise renders the themed HTML + hydrates the React gallery.

---

## 10. DNS and hosting

- **Registrar:** Porkbun, managed via API (keys in GH secrets).
- **DNS:** Cloudflare (nameservers delegated from Porkbun).
- **Zones + records:**
  - `yrdsl.app` A → Cloudflare Pages (landing, with Worker route override for
    user-paths)
  - `api.yrdsl.app` → `api-worker`
  - `mcp.yrdsl.app` → `mcp-worker`
  - `send.yrdsl.app` → Resend (MX/SPF/DKIM records from Resend dashboard,
    added to Cloudflare via the same DNS bootstrap script)
- **Automation:** A small `scripts/dns-setup.ts` uses Porkbun + Cloudflare APIs to
  bootstrap records idempotently. Run once on initial setup; re-runnable to repair.

---

## 11. Release pipeline and attestations (req #14, #15)

No desktop binary means no code-signing pipeline, no Apple Developer ID, no
Windows Authenticode, no notarization, no auto-updater. What remains is
standard web deploy.

### 11.1 Release workflow

`.github/workflows/release.yml` (planned):
1. Triggered by pushing a tag `v*.*.*`.
2. Lint + typecheck + unit + integration tests must pass or release aborts (req #15).
3. Build `apps/web` + `apps/landing` to static bundles.
4. Generate SBOM with `cyclonedx`.
5. **Attest build provenance** via `actions/attest-build-provenance@v2` on the
   web bundle tarball (req #14, preserves the "attestations" requirement even
   without a binary).
6. Trigger `deploy-landing.yml` (GH Pages) and `deploy-web.yml` (CF Pages).
7. Deploy workers (api, mcp, meter) via `wrangler deploy`.
8. Create a GitHub Release with the SBOM + attestation bundle attached.

Today the four CI workflows in place do the day-to-day work without a
tagged-release ceremony: `ci.yml` (lint + typecheck + tests), `deploy-web.yml`,
`deploy-landing.yml`, `deploy-workers.yml`. The release workflow above bolts
on top of them when we cut a versioned release.

### 11.2 CI workflow (on every PR)

- Lint + typecheck (biome + tsc).
- Unit + integration tests via Vitest. The api-worker suite runs against a
  real `unstable_dev` miniflare with D1 schema applied through
  `test/global-setup.ts`.
- Locale file validation (see §6.7).
- Bundle-size regression check on `apps/web` (planned).
- **No browser-automation E2E** (Playwright et al). UI smoke-testing is
  manual against the deployed `app.yrdsl.app`. The vitest integration
  layer covers HTTP contracts; visual regressions get caught by humans
  during normal use.

---

## 12. Testing strategy

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | `packages/core` schema/validation, sync diff logic, pricing calc |
| Integration | Vitest + `unstable_dev` + local D1 | API endpoints, auth + invite flows, token lifecycle, rate-limit |
| Contract | Vitest | MCP tool I/O shapes against SDK types (when MCP lands) |
| Self-hosted JSON validity | `scripts/validate.mjs` in template | Pre-deploy zod check on `site.json` + `items.json` |
| UI smoke | **Manual** (browser) | Signup, confirm, profile, tokens, admin invites |

**No browser-automation suite.** Playwright/Cypress are explicitly out of
scope; the UI surface is small enough that manual smoke + integration
tests against the API contract catch what matters. See §11.2 for the
reasoning.

**Coverage target:** 80% statements on `packages/core` and `services/*`.
UI coverage isn't enforced numerically.

---

## 13. Secrets management

All secrets live in:
1. **Local dev:** `.dev.vars` files, gitignored.
2. **CI/prod:** GitHub Actions secrets, mirrored into Wrangler secrets at deploy.

Required secrets:

| Name | Source | Used by |
|---|---|---|
| `CF_API_TOKEN` | Cloudflare dashboard (provided) | Wrangler deploy, DNS setup |
| `PORKBUN_API_KEY` / `PORKBUN_SECRET` | Porkbun (provided) | DNS bootstrap script |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe | api-worker |
| `RESEND_API_KEY` | Resend | api-worker |
| `SESSION_SIGNING_KEY` | generated | api-worker, mcp-worker |

Secrets are set via `gh secret set` from a local script. No Apple / signing secrets
are required. This is a web product.

---

## 14. Security and privacy

- Passwords: argon2id, per-user salt, memory cost 64 MB, parallelism 4.
- Session cookies: httpOnly, secure, SameSite=Lax, 30-day rolling expiry.
- API tokens: hashed storage, prefix for identification, revocable instantly.
- CSRF: double-submit cookie pattern on web; N/A for bearer-token API.
- Upload validation: server re-decodes and re-encodes every image; rejects anything
  that doesn't round-trip.
- Rate limits: signup 5/hr/IP, login 10/hr/IP, password reset 3/hr/account, MCP
  60 calls/min/token.
- Email PII: displayed only to the owning user. Never appears in public sale HTML.
- Reserve form: existing honeypot + validation preserved from current worker.
- Logs: no PII, no tokens, no passwords. Request IDs only.
- Compliance: add a simple privacy policy + TOS before public launch. Not drafted
  here.

---

## 15. Observability and ops

- **Logs:** Cloudflare Workers Logs (Workers Logpush to R2 for retention).
- **Metrics:** Cloudflare Analytics + a simple `/admin/stats` endpoint pulling meter
  sums.
- **Errors:** Sentry for Workers + web app (OSS-compatible plan or self-hosted
  Glitchtip).
- **Status page:** GH-Pages status site driven by scheduled health checks
  (stretch, not v1).

---

## 16. Milestones

Phased to de-risk the long tail (billing, MCP, i18n).

### M1. Foundations (accounts + infra)
- Monorepo + CI green
- Auth (signup, confirm, login, password, tokens)
- Account pages (avatar, profile, tokens)
- D1 schema + migrations
- DNS (Porkbun + Cloudflare automated)
- Landing page shell at `apps/landing/`
**Exit:** user can sign up, confirm, set avatar, create/revoke tokens. No yard sales
yet.

### M2. Yard sales: web editor + published viewer
- Sales + items CRUD API in api-worker (✅ done)
- `apps/web` editor: sale list + sale detail with inline item add/edit/
  delete, reserve/unreserve, photo upload (✅ done); drag-drop reorder
  and live preview pane are deferred polish.
- Viewer route: shipped at `app.yrdsl.app/{user}/{slug}` (client-side
  render with packages/viewer). The PRD-canonical
  `yrdsl.app/{user}/{slug}` Worker overlay is a separate cut.
- Renderer: `packages/viewer` consumed by both apps/web and the
  self-hosted template. api-worker translates D1 rows to the same
  canonical JSON (✅ done).
- Image pipeline: client-side canvas resize to 1200px + WebP encode,
  server-side RIFF/WEBP magic-byte check, R2 storage, public serving at
  `api.yrdsl.app/image/<key>` (✅ done).
- Archive / Delete flows with confirm modals (✅ done). Export-as-ZIP is
  a later cut.
**Exit (achieved):** a user can sign up, confirm, create a sale, add
items with photos, publish it, and see it live at
app.yrdsl.app/{user}/{slug}.

### M2.5. Self-hosted distribution (✅ done)
- `packages/viewer` extracted as a reusable React renderer
- `KuvopLLC/yrdsl-self-hosted` template repo with vendored viewer +
  SKILL.md + MCP server + GH Action deploy
- `mreider/yrdsl-example` polished live demo with in-repo photos
- Vendor-refresh script (`scripts/refresh-self-hosted-vendor.sh`) with
  GH Actions workflow that opens a PR on every change to
  `packages/viewer/src/**` or `packages/core/src/schemas/sale.ts`.
**Exit (achieved):** OSS users can fork the template and have a live
yard sale on GitHub Pages in five minutes.

### M3. MCP + mobile Claude (✅ done)
- Unified `@yrdsl/mcp` stdio server with two backends (hosted REST via
  bearer token, local file mode for the self-hosted template). Same 12
  tools dispatched through a `Backend` interface — keeps the LLM-facing
  surface identical regardless of mode.
- Bearer-token auth for hosted mode (write-scoped); git-credential auth
  for local-mode `commit_and_push`.
- In-app "Connect Claude" walkthrough at `/connect` mints a write-scoped
  token, bakes it into a copy-paste Claude Desktop config snippet.
- Vendored `dist/` ships with the self-hosted template, refreshed by
  `scripts/refresh-self-hosted-vendor.sh` on every MCP source change.
**Exit (achieved):** mobile-via-Claude flow works against both hosted
and local-mode sites.

### M4. Themes + i18n
- All 4 themes shipped (Claude Designer pass on the existing imports)
- i18n scaffolding + en.json
- Translation PR workflow + CI checks
- First 2 non-English locales seeded
**Exit:** theme picker works, locale picker works, example contributor PR merged.

### M5. Billing (not started)
- **Re-add** `meter_events` and `subscriptions` tables to the D1 schema
  (dropped during cleanup; see §8 note).
- Stripe metered integration (SDK + customer portal).
- Meter collectors in api-worker + cleanup-worker (request counts,
  storage-GB-day snapshots).
- Monthly aggregation cron.
- Usage forecast card on the dashboard (the big design effort; §6.12).
- Payment-failure grace + disabled state (§6.13).
**Exit:** end-to-end paid flow with test mode.

### M6. Hardening, launch (in progress)
**Done:**
- Rate limits on signup, login, password reset, sales/items mutations,
  image upload, public viewer reads, `me/*` mutations.
- CSP + X-Content-Type-Options + Referrer-Policy + HSTS on api-worker;
  `_headers` file on `apps/web` for the SPA.
- CSRF double-submit on session-auth mutating verbs (bearer-token auth
  exempt). `__ys_csrf` cookie minted on login/signup, echoed in
  `X-CSRF-Token` header.
- HIBP k-anonymity password check on signup, password change, and
  password reset. Graceful degradation if the API is down.
- Wrangler v4 + Node 24 across CI/deploy.
- Cleanup cron + observability via `console.log` → Cloudflare Workers
  Logs (no third-party error tracker — logs are sufficient).
- Privacy + TOS pages shipped.
- viewer-worker on `yrdsl.app/*` overlays GH Pages: forwards reserved
  paths, renders `/:user/:slug` with pre-injected OG + Twitter meta tags
  for link previews. Edge-cached 60s.
- `/sitemap.xml` + `/robots.txt` rendered by viewer-worker; sitemap
  pulls every published sale from `/public/sitemap`.
- `Cache-Control` on `/public/sales/{user}/{slug}` (s-maxage=60, swr=60).
- Bundle-size budget enforced in CI (400KB raw / 120KB gz JS, 25KB raw
  / 8KB gz CSS) — `scripts/check-bundle-size.mjs`.
- Self-serve `DELETE /me` (current password + literal `DELETE`
  confirmation; sweeps R2 images + avatar; FK cascade handles the rest).
- D1 backup runbook (`ops/D1-BACKUP.md`): Time Travel as primary
  safety net + weekly manual exports + quarterly verification.
- Export-as-ZIP (PRD §6.10): `GET /sales/:id/export` returns a ZIP
  matching the `yrdsl-self-hosted` template layout (site.json,
  items.json, public/photos/*, README.md). Image URLs rewritten to
  relative paths so the extracted repo renders without further edits.
- Item reorder UI (`POST /sales/:id/items/reorder` atomic batch +
  ↑/↓ buttons in editor).
- Live preview at `/sales/:id/preview` (full-bleed SaleViewer fed by
  the authenticated draft, not the public viewer).
- Cloudflare Turnstile on signup. Graceful no-op when keys unset.
- Initial a11y pass: skip-to-main link, focus-visible outlines on
  buttons/links, htmlFor/id pairs on Login + Signup forms.

**Remaining before flipping `REQUIRE_INVITE=false`:**
- Manual visual sweep across all 4 themes on a few representative sales.
- Safari/iOS file upload smoke test.
- (done) a11y htmlFor/id pairs applied to every form in the SPA.
- Resend domain verification (currently using onboarding@resend.dev).
- Image moderation: policy decision pending. CSAM hash-match via
  Microsoft PhotoDNA (legal requirement) requires partnership paperwork;
  NSFW classifier is a TOS/policy call (block vs. blur vs. ignore).
  Don't scaffold the hook until the policy is set — the current upload
  path already works without one, and the shape of the hook depends on
  which providers/actions are chosen.
- Swap Turnstile keys: currently using Cloudflare's documented
  always-passes test keys (`1x...AA` / `1x...AA`) so the wiring works
  end-to-end without a Turnstile project. Provision a real project
  before public launch and re-set the GitHub secrets.

**Exit:** `yrdsl.app` live, OSS announced.

---

## 17. Out of scope for v1

- Custom domains on user yard sales (paid-tier v2 feature).
- Anthropic connector directory listing (v2).
- Multi-user teams / org accounts.
- Automatic content translation of user-authored fields.
- Buyer accounts (reserve is still email-only, as today).
- Mobile-native app (Claude mobile covers the on-the-go use case).
- Desktop app of any flavor (web + Claude cover every use case).
- Payment methods beyond card (ACH, crypto).
- **Platform-mediated buyer/seller messaging.** We are a billboard, not a
  marketplace inbox. Direct contact (email/SMS/WhatsApp) is the product; the
  opt-in Resend relay is the only exception and exists solely for email
  obscuring, not for threaded chat.

---

## 18. Open items to resolve before implementation

1. **Claude Designer specifics.** Current interface / output format. Need a docs
   lookup before §6.5 theme specs are concrete.
2. **Pricing calibration.** Meter rates in §6.11 are placeholders pending a COGS
   measurement pass during beta.
3. **Privacy policy + TOS draft**. Needed before public launch, not for build.
4. **Sentry vs Glitchtip** for error tracking.

---

## 19. Appendix: mapping back to the 17 requirements

| Req | Section(s) |
|---|---|
| 1. Signup + validation | §6.1 |
| 2. Email confirmation (via Resend) | §6.2 |
| 3. Profile via avatar click | §6.3 |
| 4. Avatar sizing + validation | §6.3 |
| 5. API tokens in settings | §6.3, §6.9 |
| 6. Confirmed users create sales | §6.4 |
| 7. Edit/delete with confirmation | §6.4 |
| 8. 4 styles (Claude Designer) | §6.5 |
| 9. Language, default by location | §6.6 |
| 10. Translation PRs | §6.7 |
| 11. Flat subscription, no % cut | §6.11 |
| 12. Price tracks volume/COGS | §6.11, §6.12 |
| 13. Claude-native / web editor / archive | §4, §6.8, §6.9, §6.10 |
| 14. Volume metering, GH Pages, attestations, DNS | §6.13, §6.14, §10, §11 |
| 15. Tests every build | §11.4, §12 |
| 16. Porkbun keys | §10, §13 |
| 17. Cloudflare hosting | §7, §10 |
