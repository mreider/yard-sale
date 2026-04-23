import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

/**
 * "Connect Claude" — two-step install flow:
 *
 *   1. Mint a write-scoped API token (account-wide).
 *   2. Install, picking one of:
 *      - Claude Desktop: download .mcpb + double-click. Easy but
 *        the client truncates large tool args, so it can't attach
 *        photos from chat.
 *      - Claude Code: one `claude mcp add` command. Shares the user's
 *        filesystem with the MCP, so attach_image_from_path works
 *        end-to-end for real photos.
 *
 * A third path (manual claude_desktop_config.json editing) lives
 * under a disclosure for Linux / corporate-laptop / CLI-prefer users.
 */

// Pinned to the GitHub "latest release" redirect so the asset URL stays
// stable across MCP version bumps.
const MCPB_URL = 'https://github.com/KuvopLLC/yrdsl/releases/latest/download/yrdsl-mcp.mcpb';

type OS = 'mac' | 'win' | 'linux';

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'win';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'mac';
}

export function ConnectPage() {
  const { user, loading } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  if (loading) return <div className="card">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  async function mintToken() {
    setBusy(true);
    setFlash(null);
    try {
      const label = `Claude Desktop · ${new Date().toISOString().slice(0, 10)}`;
      const r = await api.createToken({ name: label, scope: 'write', expiry: 'none' });
      setToken(r.secret);
    } catch (err) {
      setFlash({
        kind: 'err',
        msg: err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'Failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 1800);
  }

  return (
    <>
      <div className="card">
        <h2>Get help from Claude</h2>
        <p className="sub">
          Have <a href="https://claude.ai/download">Claude</a> (Anthropic's AI assistant) add items,
          write descriptions, set prices, mark things sold — all from a chat conversation. Two
          steps: get a key, then install.
        </p>
        {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
      </div>

      <div className="card">
        <h2>Step 1. Get your key</h2>
        <p className="sub">
          Think of this as a password that lets Claude act on your account. We'll show it once —
          copy it somewhere safe. You can make a new one any time from{' '}
          <Link to="/tokens">API tokens</Link>.
        </p>
        {!token && (
          <div className="row">
            <button type="button" className="btn" onClick={mintToken} disabled={busy}>
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </div>
        )}
        {token && (
          <>
            <div className="code-block-wrap">
              <pre className="code-block">{token}</pre>
              <button type="button" className="btn ghost tiny code-block-copy" onClick={copyToken}>
                {tokenCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div
              className="flash err"
              style={{
                marginTop: 12,
                background: 'rgba(180, 83, 9, 0.08)',
                borderColor: '#b45309',
              }}
            >
              <b>Shown once.</b> Copy it now. If you lose it,{' '}
              <button
                type="button"
                onClick={() => {
                  setToken(null);
                  void mintToken();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                make a new one
              </button>{' '}
              — the old one keeps working until you delete it at{' '}
              <Link to="/tokens">API tokens</Link>.
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Step 2. Install</h2>
        <p className="sub">
          There are two ways to use Claude with yrdsl.app. Pick whichever matches how you already
          use Claude.
        </p>

        <div className="section-sub" style={{ marginTop: 18 }}>
          The Claude app (easiest)
        </div>
        <p className="sub" style={{ marginTop: 0 }}>
          Claude Desktop for Mac or Windows. Good for almost everything: writing item descriptions,
          picking prices, marking items sold, publishing your sale.{' '}
          <b>For photos, upload them directly in the editor</b> — the desktop app can't send photos
          through chat reliably.
        </p>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <a className="btn" href={MCPB_URL} download>
            Download the extension
          </a>
          <small style={{ color: 'var(--muted)' }}>a small file you drag into Claude</small>
        </div>
        <ol className="steps-list">
          <li>Double-click the file you just downloaded. Claude Desktop opens.</li>
          <li>
            Claude asks for the key from Step 1. Paste it and click <b>Install</b>.
          </li>
          <li>
            Open a chat and try: <i>"list my sales"</i> or{' '}
            <i>"draft an item from https://… and add it"</i>.
          </li>
        </ol>
        <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
          Don't have it? <a href="https://claude.ai/download">Download Claude</a> first.
        </p>

        <div className="section-sub" style={{ marginTop: 28 }}>
          Claude Code (for the command line)
        </div>
        <p className="sub" style={{ marginTop: 0 }}>
          If you already use Claude Code (Anthropic's tool for developers), this path handles photos
          too. You can ask Claude to attach a file right from your Downloads folder.
        </p>
        <ClaudeCodeInstall token={token} />

        <div className="callout">
          <b>Using Claude in a web browser?</b> We don't yet connect to claude.ai in the browser.
          For now, use the editor directly to add and edit items — it's one click away on any sale.
          We're working on a web version of this integration.
        </div>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
          Prefer to install by editing a config file yourself?
        </summary>
        <div style={{ marginTop: 12 }}>
          <ManualConfig token={token} />
        </div>
      </details>
    </>
  );
}

/**
 * Claude Code install: a single shell command that writes to
 * ~/.claude/settings.json (or per-project .claude/settings.local.json).
 * Simpler than the Desktop .mcpb flow — no downloads, no restarts — but
 * requires a working CLI + node in PATH.
 */
function ClaudeCodeInstall({ token }: { token: string | null }) {
  const tokenStr = token ?? '<paste your token from Step 1>';
  const cmd = `claude mcp add yrdsl -e YRDSL_API_TOKEN=${tokenStr} -- npx -y @yrdsl/mcp@latest`;

  return (
    <>
      {!token && (
        <p className="sub" style={{ marginTop: 8, marginBottom: 4 }}>
          <i>Get a key in Step 1 first — it'll fill in automatically below.</i>
        </p>
      )}
      <CodeBlock code={cmd} />
      <ol className="steps-list">
        <li>Copy the command above and paste it into your terminal.</li>
        <li>
          Start Claude Code and type <code>/mcp</code> in a chat. You should see <b>yrdsl</b> listed
          as connected.
        </li>
        <li>
          Try: <i>"attach ~/Downloads/moccamaster.jpg to my latest item"</i>.
        </li>
      </ol>
      <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
        New to Claude Code?{' '}
        <a href="https://docs.claude.com/en/docs/claude-code/overview">How to install it</a>.
      </p>
    </>
  );
}

/**
 * The old flow, surfaced behind a disclosure. For users on Linux Claude
 * builds, corporate-locked laptops, or anyone who just prefers config
 * files. Requires `npx` on PATH so we keep the preflight script handy.
 */
function ManualConfig({ token }: { token: string | null }) {
  const [os, setOs] = useState<OS>(detectOS);
  const [copied, setCopied] = useState(false);

  const snippet = buildConfig(token, os);

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <p className="sub">
        An alternative to the downloaded extension above. You'll paste a snippet into Claude
        Desktop's config file yourself. You'll need Node.js installed.
      </p>
      <div className="row" style={{ gap: 6, marginBottom: 8, display: 'inline-flex' }}>
        {(['mac', 'win', 'linux'] as OS[]).map((o) => (
          <button
            key={o}
            type="button"
            className={`btn ${o === os ? '' : 'ghost'} tiny`}
            onClick={() => setOs(o)}
            style={{ fontSize: 12 }}
          >
            {{ mac: 'macOS', win: 'Windows', linux: 'Linux' }[o]}
          </button>
        ))}
      </div>
      <p className="sub" style={{ marginTop: 0 }}>
        <code>{configPath(os)}</code>
      </p>
      {!token && (
        <p className="sub">
          <i>Mint a token in Step 1 first — it gets inlined into the snippet below.</i>
        </p>
      )}
      <div className="code-block-wrap">
        <pre className="code-block">{snippet}</pre>
        <button
          type="button"
          className="btn ghost tiny code-block-copy"
          onClick={copy}
          disabled={!token}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <p className="sub" style={{ marginTop: 16, marginBottom: 4 }}>
        After editing, fully quit and reopen Claude Desktop. If it doesn't pick up the server, run
        the preflight check:
      </p>
      <CodeBlock code={preflightCmd(os)} />
      <small style={{ color: 'var(--muted)' }}>
        Reports which pieces are missing (Node.js, npx on PATH, config syntax) without modifying
        anything.
      </small>
    </>
  );
}

/** Copyable code snippet with a clipboard button. Uses the shared
 * `.code-block` / `.code-block-wrap` / `.code-block-copy` CSS so every
 * code snippet in the SPA looks the same. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block-wrap">
      <pre className="code-block">{code}</pre>
      <button
        type="button"
        className="btn ghost tiny code-block-copy"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  );
}

function preflightCmd(os: OS): string {
  if (os === 'win') return 'iwr https://yrdsl.app/check.ps1 | iex';
  return 'curl -fsSL https://yrdsl.app/check.sh | bash';
}

function configPath(os: OS): string {
  switch (os) {
    case 'mac':
      return '~/Library/Application Support/Claude/claude_desktop_config.json';
    case 'win':
      return '%APPDATA%\\Claude\\claude_desktop_config.json';
    case 'linux':
      return '~/.config/Claude/claude_desktop_config.json';
  }
}

/** Claude Desktop on macOS spawns with a minimal PATH so relying on `npx`
 * bare can fail. Use the full Homebrew path on mac; `npx` bare elsewhere. */
function npxCommand(os: OS): string {
  switch (os) {
    case 'mac':
      return '/opt/homebrew/bin/npx';
    case 'win':
      return 'npx';
    case 'linux':
      return '/usr/bin/npx';
  }
}

function buildConfig(token: string | null, os: OS): string {
  return JSON.stringify(
    {
      mcpServers: {
        yrdsl: {
          command: npxCommand(os),
          args: ['-y', '@yrdsl/mcp@latest'],
          env: {
            YRDSL_API_TOKEN: token ?? '<paste your token here>',
          },
        },
      },
    },
    null,
    2,
  );
}
