# yrdsl preflight (Windows / PowerShell) — verifies your local env is
# ready to run @yrdsl/mcp in Claude Desktop. Read-only.
#
# Usage:  iwr https://yrdsl.app/check.ps1 | iex

$script:Pass = 0; $script:Fail = 0; $script:Warn = 0

function Ok($m)      { Write-Host "  + $m" -ForegroundColor Green; $script:Pass++ }
function Bad($m, $h) { Write-Host "  x $m" -ForegroundColor Red;   Write-Host "      $h"; $script:Fail++ }
function Meh($m, $h) { Write-Host "  ! $m" -ForegroundColor Yellow;Write-Host "      $h"; $script:Warn++ }

Write-Host ""
Write-Host "yrdsl preflight  (Windows)" -ForegroundColor Cyan
Write-Host ""

# ─── Node + npx ─────────────────────────────────────────────────
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = (& node --version) 2>$null
    Ok "node: $nodeVer"
    $major = [int]($nodeVer -replace '^v(\d+).*', '$1')
    if ($major -lt 18) { Meh "node older than 18" "winget upgrade OpenJS.NodeJS" }
} else {
    Bad "node not installed" "winget install OpenJS.NodeJS  (or https://nodejs.org)"
}

$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if ($npxCmd) {
    $npxVer = (& npx --version) 2>$null
    Ok "npx: $($npxCmd.Source) ($npxVer)"
} else {
    if ($nodeCmd) { Bad "npx missing" "Ships with Node — reinstall Node." }
}

# ─── Claude Desktop config ──────────────────────────────────────
$config = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"

$token = ""
$saleId = ""
if (Test-Path $config) {
    Ok "config exists: $config"
    try {
        $data = Get-Content $config -Raw -ErrorAction Stop | ConvertFrom-Json
        Ok "config is valid JSON"
        $yrdsl = $data.mcpServers.yrdsl
        if ($yrdsl) {
            Ok "mcpServers.yrdsl entry present"
            $token  = $yrdsl.env.YRDSL_API_TOKEN
            $saleId = $yrdsl.env.YRDSL_SALE_ID
            if ($token)  { Ok "YRDSL_API_TOKEN set"  } else { Bad "YRDSL_API_TOKEN missing"  "Get it from /connect" }
            if ($saleId) { Ok "YRDSL_SALE_ID set" }   else { Bad "YRDSL_SALE_ID missing" "Get it from /connect" }
        } else {
            Bad "mcpServers.yrdsl missing from config" "Paste the snippet from https://app.yrdsl.app/connect"
        }
    } catch {
        Bad "config is not valid JSON" $_.Exception.Message
    }
} else {
    Bad "config file not found" "Expected at: $config"
}

# ─── Live MCP spawn (optional) ──────────────────────────────────
if ($npxCmd -and $token -and $saleId) {
    Write-Host "  (testing MCP spawn, 10s timeout...)" -ForegroundColor DarkGray
    $env:YRDSL_API_TOKEN = $token
    $env:YRDSL_SALE_ID   = $saleId
    try {
        $job = Start-Job -ScriptBlock {
            param($npx) & $npx -y "@yrdsl/mcp@latest" 2>&1 | Out-String
        } -ArgumentList $npxCmd.Source
        $finished = Wait-Job $job -Timeout 10
        $out = if ($finished) { Receive-Job $job } else { "" }
        Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
        Remove-Job $job -Force -ErrorAction SilentlyContinue | Out-Null
        if ($out -match 'ENOENT|not found|Cannot find|error:') {
            Bad "MCP spawn errored" ($out -split "`n" | Select-Object -First 3 -join " | ")
        } else {
            Ok "MCP binary spawns cleanly"
        }
    } finally {
        $env:YRDSL_API_TOKEN = $null
        $env:YRDSL_SALE_ID   = $null
    }
}

Write-Host ""
Write-Host ("Summary: {0} passed  {1} warnings  {2} failed" -f $script:Pass, $script:Warn, $script:Fail)
Write-Host ""
if ($script:Fail -gt 0) {
    Write-Host "Fix the x lines above, then fully quit and reopen Claude Desktop."
    exit 1
}
Write-Host "Looks good. If Claude Desktop still doesn't see yrdsl, fully quit and reopen."
