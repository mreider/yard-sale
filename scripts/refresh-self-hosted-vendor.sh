#!/usr/bin/env bash
# Push the current packages/viewer source + sale schema into the self-hosted
# template repo as a vendor refresh. Solo project, no review needed —
# pushes straight to the template's main branch.
#
# Usage:
#   scripts/refresh-self-hosted-vendor.sh                # clones template to a tempdir
#   TEMPLATE_DIR=~/yrdsl-self-hosted scripts/refresh... # operates on a pre-existing clone
#
# Requires:
#   - gh CLI authenticated with push access to KuvopLLC/yrdsl-self-hosted
#   - git, sed

set -euo pipefail

REPO="${REPO:-KuvopLLC/yrdsl-self-hosted}"
MONOREPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${TEMPLATE_DIR:-}" ]]; then
  TEMPLATE="$TEMPLATE_DIR"
  echo "→ Using existing template clone at $TEMPLATE"
  (cd "$TEMPLATE" && git fetch origin main -q && git checkout main -q && git pull -q)
else
  TEMPLATE="$(mktemp -d)/yrdsl-self-hosted"
  echo "→ Cloning $REPO to $TEMPLATE"
  # Use HTTPS clone with the GH_TOKEN baked in so the subsequent
  # `git push` works in CI (raw git doesn't read gh CLI's auth).
  # `oauth2:` works for both fine-grained PATs and classic tokens.
  if [[ -n "${GH_TOKEN:-}" ]]; then
    git clone -q "https://oauth2:${GH_TOKEN}@github.com/${REPO}.git" "$TEMPLATE"
  else
    gh repo clone "$REPO" "$TEMPLATE" -- -q
  fi
fi

cd "$TEMPLATE"
git checkout main -q

VENDOR_VIEWER="src/vendor/viewer"
VENDOR_CORE="src/vendor/core"

echo "→ Refreshing $VENDOR_VIEWER from packages/viewer/src"
rm -rf "$VENDOR_VIEWER"
mkdir -p "$VENDOR_VIEWER"
cp "$MONOREPO_ROOT"/packages/viewer/src/*.ts* "$VENDOR_VIEWER/"
cp "$MONOREPO_ROOT"/packages/viewer/src/*.css "$VENDOR_VIEWER/"

echo "→ Refreshing $VENDOR_CORE from packages/core/src/schemas/sale.ts"
mkdir -p "$VENDOR_CORE"
cp "$MONOREPO_ROOT"/packages/core/src/schemas/sale.ts "$VENDOR_CORE/sale.ts"

echo "→ Rewriting @yrdsl/core imports to relative paths"
# macOS + GNU sed compatibility: write to tmp then move.
for f in "$VENDOR_VIEWER"/*.ts*; do
  sed "s|'@yrdsl/core'|'../core/sale.js'|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# Refresh the vendored MCP build (compiled JS, not TS source — the
# template should not require a build step on `git clone`).
echo "→ Refreshing mcp/dist from packages/mcp"
(cd "$MONOREPO_ROOT/packages/mcp" && pnpm build -s) >/dev/null 2>&1 || \
  echo "  (build skipped — packages/mcp may not be built)"
if [[ -d "$MONOREPO_ROOT/packages/mcp/dist" ]]; then
  rm -rf mcp/dist
  mkdir -p mcp/dist/backends
  cp "$MONOREPO_ROOT"/packages/mcp/dist/*.js mcp/dist/
  cp "$MONOREPO_ROOT"/packages/mcp/dist/backends/*.js mcp/dist/backends/
  chmod +x mcp/dist/index.js 2>/dev/null || true
fi

if git diff --quiet; then
  echo "✓ Vendor copy is already up to date. Nothing to do."
  exit 0
fi

MONOREPO_SHA="$(cd "$MONOREPO_ROOT" && git rev-parse HEAD)"
git add -A
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Matt}" \
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-mreider@gmail.com}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Matt}" \
GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-mreider@gmail.com}" \
  git commit -q -m "vendor refresh from yard-sale@$(echo "$MONOREPO_SHA" | cut -c1-7)

Source: https://github.com/KuvopLLC/yrdsl/tree/$MONOREPO_SHA/packages/viewer
Schema: https://github.com/KuvopLLC/yrdsl/tree/$MONOREPO_SHA/packages/core/src/schemas/sale.ts"

git push origin main -q

echo "✓ Pushed to $REPO@main"
