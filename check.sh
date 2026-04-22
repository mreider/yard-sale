#!/usr/bin/env bash
# yrdsl preflight (macOS / Linux) — verifies your local env is ready
# to run @yrdsl/mcp in Claude Desktop. Read-only: doesn't modify
# anything, just reports what it finds.
#
# Usage:  curl -fsSL https://yrdsl.app/check.sh | bash
set -u
PASS=0; FAIL=0; WARN=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '  \033[31m✗\033[0m %s\n      %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33m!\033[0m %s\n      %s\n' "$1" "$2"; WARN=$((WARN+1)); }

OS=$(uname -s); ARCH=$(uname -m)
printf '\n\033[1myrdsl preflight\033[0m  (%s %s)\n\n' "$OS" "$ARCH"

# ─── Node + npx ────────────────────────────────────────────────────────────
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version)
  pass "node: $NODE_VER"
  MAJOR=$(printf '%s\n' "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
  if [ "${MAJOR:-0}" -lt 18 ]; then
    warn "node older than 18" "Upgrade: brew upgrade node  (or https://nodejs.org)"
  fi
else
  if [ "$OS" = "Darwin" ]; then
    fail "node not installed" "brew install node  (install Homebrew first if needed: https://brew.sh)"
  else
    fail "node not installed" "apt install nodejs npm  (or https://nodejs.org)"
  fi
fi

NPX_PATH=$(command -v npx 2>/dev/null || true)
if [ -n "$NPX_PATH" ]; then
  pass "npx: $NPX_PATH ($(npx --version))"
  case "$NPX_PATH" in
    /usr/bin/*|/bin/*) ;;
    *)
      warn "npx is outside /usr/bin" \
          "Claude Desktop's launchd environment may not find it. Use the full path in your config: $NPX_PATH"
      ;;
  esac
else
  [ -n "${NODE_VER:-}" ] && fail "npx missing" "It ships with Node — reinstall Node."
fi

# ─── Claude Desktop config ─────────────────────────────────────────────────
case "$OS" in
  Darwin)  CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
  Linux)   CFG="$HOME/.config/Claude/claude_desktop_config.json" ;;
  *)       CFG="" ;;
esac

if [ -n "$CFG" ]; then
  if [ -f "$CFG" ]; then
    pass "config exists: $CFG"
    if command -v jq >/dev/null 2>&1; then
      if jq -e . "$CFG" >/dev/null 2>&1; then
        pass "config is valid JSON"
        if jq -e '.mcpServers.yrdsl' "$CFG" >/dev/null 2>&1; then
          pass "mcpServers.yrdsl entry present"
          CMD=$(jq -r '.mcpServers.yrdsl.command' "$CFG")
          TOKEN=$(jq -r '.mcpServers.yrdsl.env.YRDSL_API_TOKEN // empty' "$CFG")
          SALE=$(jq -r '.mcpServers.yrdsl.env.YRDSL_SALE_ID // empty' "$CFG")
          [ -n "$TOKEN" ] && pass "YRDSL_API_TOKEN set" || fail "YRDSL_API_TOKEN missing" "Get it from /connect"
          [ -n "$SALE" ] && pass "YRDSL_SALE_ID set" || fail "YRDSL_SALE_ID missing" "Get it from /connect"
          if [ "$CMD" = "npx" ] && [ -n "$NPX_PATH" ] && [ "$NPX_PATH" != "/usr/bin/npx" ] && [ "$NPX_PATH" != "/bin/npx" ]; then
            warn "command is 'npx' but your npx is at $NPX_PATH" \
                "Claude Desktop may not resolve it. Change to the full path: $NPX_PATH"
          fi
        else
          fail "mcpServers.yrdsl missing from config" "Paste the snippet from /connect at https://app.yrdsl.app/connect"
        fi
      else
        fail "config is not valid JSON" "Run:  jq . \"$CFG\"   to see the parse error"
      fi
    else
      warn "jq not installed — skipping JSON-structure checks" "brew install jq  (optional, makes this script deeper)"
    fi
  else
    fail "config file not found" "Expected at: $CFG"
  fi
else
  warn "unknown OS for config path" "Check Claude Desktop docs for config location on $OS"
fi

# ─── Live MCP spawn (optional) ─────────────────────────────────────────────
if [ -n "$NPX_PATH" ] && [ -n "${TOKEN:-}" ] && [ -n "${SALE:-}" ]; then
  printf '  \033[2m(testing MCP spawn, 10s timeout…)\033[0m\n'
  OUT=$(YRDSL_API_TOKEN="$TOKEN" YRDSL_SALE_ID="$SALE" timeout 10 "$NPX_PATH" -y @yrdsl/mcp@latest < /dev/null 2>&1 || true)
  # The server reads stdin; closing stdin causes a clean exit. Just care that the binary started.
  if printf '%s' "$OUT" | grep -qE 'ENOENT|not found|error:|Cannot find' 2>/dev/null; then
    fail "MCP spawn errored" "$(printf '%s' "$OUT" | head -3)"
  else
    pass "MCP binary spawns cleanly"
  fi
fi

echo
printf '\033[1mSummary:\033[0m %d passed  \033[33m%d warnings\033[0m  \033[31m%d failed\033[0m\n' "$PASS" "$WARN" "$FAIL"
echo
if [ "$FAIL" -gt 0 ]; then
  echo "Fix the ✗ lines above, then restart Claude Desktop (⌘Q, reopen)."
  exit 1
fi
echo "Looks good. If Claude Desktop still doesn't see yrdsl, fully quit (⌘Q) and reopen."
