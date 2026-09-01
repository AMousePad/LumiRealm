# Deploy lumirealm to a Lumiverse instance: build in-place, then copy the
# minimal runtime files into the Lumiverse data dir's extensions folder.
# Lumiverse scans extensions at startup, so restart it after deploying.
#
# Usage:
#   ./scripts/deploy.ps1 -Dest "D:\lumi\data\extensions\lumirealm\repo"
#   $env:LUMIVERSE_DIR = "D:\lumi"; ./scripts/deploy.ps1     # dest derived
#
# What lands at $Dest:
#   dist/backend.js               -- Bun-bundled Spindle worker entrypoint
#   dist/regex-runner.js          -- killable subprocess entry for inline prompt regex
#   dist/frontend.js              -- browser bundle
#   spindle.json                  -- manifest (identifier=lumirealm)
#
# NOT copied: src/, tests/, tsconfig.json, package.json. Lua/JSON support
# files are bundled INTO backend.js as text imports (the host's static
# safety check blocks runtime `node:fs` reads).

param(
  # Identifier is `lumirealm` (Lumiverse requires /^[a-z][a-z0-9_]*$/ --
  # no dashes). The folder name doesn't have to match the identifier but
  # convention + UX consistency says it should.
  [string]$Dest = ''
)

$ErrorActionPreference = 'Stop'

$Src = Resolve-Path (Join-Path $PSScriptRoot '..')

if ($Dest -eq '') {
  $destFile = Join-Path $Src '.deploy-dest'
  if ($env:LUMIVERSE_DIR) {
    $Dest = Join-Path $env:LUMIVERSE_DIR 'data\extensions\lumirealm\repo'
  } elseif (Test-Path $destFile) {
    $Dest = (Get-Content $destFile -Raw).Trim()
  } else {
    throw "Pass -Dest <path-to>\data\extensions\lumirealm\repo, set LUMIVERSE_DIR to your Lumiverse checkout, or put the destination path in a .deploy-dest file at the repo root."
  }
}

Push-Location $Src
bun run build
if ($LASTEXITCODE -ne 0) { throw "bun run build failed" }
Pop-Location

# --- Patch: fengari sandbox-incompatible primitives -------------------
# fengari (vendored both as the npm package fengari-web AND as the
# shipped fengari-bundle.js text content, both end up in dist/backend.js)
# uses two pre-sandbox-era JS patterns that Lumi commit a474ef5 freezes
# at extension boot: `(0, eval)("this")` for global-object detection,
# and `Function(...)` constructor calls for utility-function init +
# dynamic XHR-based library loading. Both throw under the sandbox at
# module init, killing the extension before it can register any handlers
# ("Failed to load extension: eval is disabled / Function constructor
# is disabled in extension context").
#
# Replacements are functionally identical for the fengari init paths:
# `(0, eval)("this")` -> `globalThis` (W3C standard, same return value)
# `Function("t","k","delete t[k]")` -> equivalent arrow function
# `Function("return ()=>void 0;")` -> equivalent factory
# `Function("fengari", u)` (XHR library loader at fengari-web's
#   __tostring metamethod) -> immediate throw, caught by fengari's own
#   try/catch around the call. We don't use HTTP-loaded Lua libraries
#   in lumirealm so this path is never taken in normal operation.
#
# Patches handle BOTH the spaced (npm-package) and minified (shipped
# bundle.js text) forms via flexible whitespace + identifier matching.
# Idempotent (post-replacement strings don't match again).
$bundle = Join-Path $Src 'dist\backend.js'
$bundleText = Get-Content $bundle -Raw
$patches = @(
  @{ name = 'fengari (0, eval)("this") global-object polyfill';
     from = '\(0,\s*eval\)\("this"\)';
     to   = 'globalThis' },
  @{ name = 'fengari Function("t","k","delete t[k]") delete-prop helper';
     from = 'Function\(\s*"t"\s*,\s*"k"\s*,\s*"delete\s+t\[k\]"\s*\)';
     to   = '((t,k)=>{delete t[k]})' },
  @{ name = 'fengari Function("return ()=>void 0;") noop factory';
     from = 'Function\(\s*"return\s*\(\)=>void\s+0;?"\s*\)';
     to   = '(()=>()=>void 0)' },
  @{ name = 'fengari Function("fengari", X) XHR library loader';
     from = 'Function\(\s*"fengari"\s*,\s*\w+\s*\)';
     to   = '(()=>{throw new Error("Function-constructor-disabled-in-extension-context")})()' }
)
$totalPatched = 0
foreach ($p in $patches) {
  $hits = ([regex]::Matches($bundleText, $p.from)).Count
  if ($hits -gt 0) {
    $bundleText = [regex]::Replace($bundleText, $p.from, $p.to)
    Write-Host "Patched $hits x $($p.name)"
    $totalPatched += $hits
  }
}
if ($totalPatched -gt 0) {
  [System.IO.File]::WriteAllText($bundle, $bundleText, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Wrote $totalPatched total patch(es) to dist\backend.js"
}

# --- Static safety check -------------------------------------------
# Mirrors Lumiverse's detectDangerousBackendCapabilities regex set
# verbatim (manager.service.ts DANGEROUS_BACKEND_CHECKS), catching all
# three module-import surfaces (from, require, dynamic import) so a
# syntax switch can't escape the check. A hit blocks extension load at
# Lumi-restart time, so running this at deploy time catches the
# regression earlier.
#
# Also checks for a direct eval(...) call, beyond Lumi's set: Lumi's
# sandbox blocks eval at runtime (worker-runtime-sandbox.ts
# initializeSandbox) but doesn't statically check for it. Catching it
# here saves a Lumi restart cycle when a dependency adds an eval
# polyfill the patch above missed.
#
# REFRESH PROCEDURE: when Prolix updates DANGEROUS_BACKEND_CHECKS,
# copy the regexes verbatim into the array below -- but write the
# upstream quote-trio character class as [\x22\x27\x60] (double-
# quote, apostrophe, grave-accent by ASCII escape). Embedding those
# characters literally desyncs the Windows PowerShell 5.1 parser,
# while the ASCII escapes match the same characters in .NET regex
# with no quote conflict in source.
$Q = '[\x22\x27\x60]'   # mirrors upstream char-class: " or apostrophe or grave-accent
$checks = @(
  @{ label = 'filesystem module access';
     regex = "(?:from\s*$Q(?:node:)?fs(?:\/promises)?$Q|require\s*\(\s*$Q(?:node:)?fs(?:\/promises)?$Q\s*\)|import\s*\(\s*$Q(?:node:)?fs(?:\/promises)?$Q\s*\))" },
  @{ label = 'subprocess module access';
     regex = "(?:from\s*$Q(?:node:)?child_process$Q|require\s*\(\s*$Q(?:node:)?child_process$Q\s*\)|import\s*\(\s*$Q(?:node:)?child_process$Q\s*\))" },
  @{ label = 'direct socket module access';
     regex = "(?:from\s*$Q(?:node:)?(?:net|tls|dgram|http|https)$Q|require\s*\(\s*$Q(?:node:)?(?:net|tls|dgram|http|https)$Q\s*\)|import\s*\(\s*$Q(?:node:)?(?:net|tls|dgram|http|https)$Q\s*\))" },
  @{ label = 'worker or cluster module access';
     regex = "(?:from\s*$Q(?:node:)?(?:worker_threads|cluster)$Q|require\s*\(\s*$Q(?:node:)?(?:worker_threads|cluster)$Q\s*\)|import\s*\(\s*$Q(?:node:)?(?:worker_threads|cluster)$Q\s*\))" },
  @{ label = 'direct SQLite module access';
     regex = "(?:from\s*$Q(?:bun:sqlite|node:sqlite)$Q|require\s*\(\s*$Q(?:bun:sqlite|node:sqlite)$Q\s*\)|import\s*\(\s*$Q(?:bun:sqlite|node:sqlite)$Q\s*\))" },
  @{ label = 'dangerous Bun system API usage';
     regex = '\bBun\.(?:file|write|spawn|spawnSync|serve|connect|listen)\b' },
  @{ label = 'dangerous process API usage';
     regex = '\bprocess\.(?:env|exit|kill|chdir|dlopen)\b' },
  @{ label = 'direct eval() call (sandbox blocks at runtime)';
     regex = '(?<![A-Za-z0-9_$.])eval\s*\(' },
  @{ label = 'Function constructor call (sandbox blocks at runtime)';
     regex = '(?<![A-Za-z0-9_$.])Function\s*\(' },
  @{ label = 'AsyncFunction identifier (dynamic-exec via .constructor)';
     regex = '\bAsyncFunction\b' },
  @{ label = 'GeneratorFunction identifier (dynamic-exec via .constructor)';
     regex = '\bGeneratorFunction\b' },
  @{ label = 'bracket constructor access (dynamic-exec)';
     regex = "\[\s*$Q\s*constructor\s*$Q\s*\]" },
  @{ label = '.constructor.constructor chain (dynamic-exec)';
     regex = '\.\s*constructor\s*\.\s*constructor\b' },
  @{ label = '.constructor string-compile call (dynamic-exec)';
     regex = "\.\s*constructor\s*\(\s*$Q[\s\S]{0,400}?$Q\s*\)" }
)
$runnerBundle = Join-Path $Src 'dist\regex-runner.js'
$scanTargets = @(
  @{ name = 'dist\backend.js';       text = $bundleText }
)
if (Test-Path $runnerBundle) {
  $scanTargets += @{ name = 'dist\regex-runner.js'; text = (Get-Content $runnerBundle -Raw) }
}
$failed = $false
foreach ($t in $scanTargets) {
  foreach ($c in $checks) {
    $m = [regex]::Matches($t.text, $c.regex)
    if ($m.Count -gt 0) {
      $first = $m[0]
      $startIdx = [Math]::Max(0, $first.Index - 60)
      $endIdx = [Math]::Min($t.text.Length, $first.Index + $first.Length + 60)
      $preview = ($t.text.Substring($startIdx, $endIdx - $startIdx)) -replace "`r?`n", ' '
      if ($env:LUMIREALM_SKIP_SAFETY_CHECK -eq '1') {
        Write-Host "static safety check SKIPPED (LUMIREALM_SKIP_SAFETY_CHECK=1): $($t.name) $($c.label)"
        continue
      }
      Write-Host "STATIC SAFETY CHECK FAIL: $($t.name) $($c.label) -- hits=$($m.Count) first context: ...$preview..."
      $failed = $true
    }
  }
}
if ($failed) {
  throw "Lumi's detectDangerousBackendCapabilities (commit 5195652) would block this bundle. Fix the source before deploying."
}
Write-Host "Static safety check passed ($($checks.Count) patterns clean across $($scanTargets.Count) bundle(s))"

# Clean the destination dist/ to avoid stale files. spindle.json etc stays
# intact (Lumiverse may write settings there).
$destDist = Join-Path $Dest 'dist'
if (Test-Path $destDist) { Remove-Item -Recurse -Force $destDist }
New-Item -ItemType Directory -Force -Path $destDist | Out-Null

Copy-Item -Force (Join-Path $Src 'dist\backend.js')  (Join-Path $destDist 'backend.js')
if (Test-Path $runnerBundle) { Copy-Item -Force $runnerBundle (Join-Path $destDist 'regex-runner.js') }
Copy-Item -Force (Join-Path $Src 'dist\frontend.js') (Join-Path $destDist 'frontend.js')

Copy-Item -Force (Join-Path $Src 'spindle.json') (Join-Path $Dest 'spindle.json')

Write-Host "Wrote to $Dest."
Write-Host "Backend:  $((Get-Item (Join-Path $destDist 'backend.js')).Length) bytes"
if (Test-Path (Join-Path $destDist 'regex-runner.js')) { Write-Host "Runner:   $((Get-Item (Join-Path $destDist 'regex-runner.js')).Length) bytes" }
Write-Host "Frontend: $((Get-Item (Join-Path $destDist 'frontend.js')).Length) bytes"
Write-Host ""
Write-Host "Next: restart Lumiverse so the extension is re-enabled against the fresh dist/."
