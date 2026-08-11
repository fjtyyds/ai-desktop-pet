<#
.SYNOPSIS
  Local Release dry-run: simulate tag -> CI build -> latest.yml consistency.

.DESCRIPTION
  This script verifies the v1.0 release pipeline WITHOUT any remote side effect:
  - no git push
  - no remote tag creation
  - no GitHub Release / API calls
  It reads package.json / electron-builder.yml / .github/workflows/ci.yml
  (read-only), optionally builds the installer locally with
  "npm run dist -- --publish never" (same command as CI), then asserts that
  dist/latest.yml references exactly the produced artifacts.

.PARAMETER SkipBuild
  Reuse an existing dist/ instead of running the build.

.PARAMETER SimulatedTag
  Optional tag to simulate, e.g. "v0.2.0". Defaults to v<package.json version>.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/release-dryrun.ps1
  powershell -ExecutionPolicy Bypass -File scripts/release-dryrun.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$SimulatedTag = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Pass([string]$msg) { Write-Host "[PASS] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$latestYml = Join-Path $dist 'latest.yml'
$packageJson = Join-Path $root 'package.json'
$builderYml = Join-Path $root 'electron-builder.yml'
$ciYml = Join-Path $root '.github\workflows\ci.yml'
$failures = 0

function Assert([bool]$condition, [string]$message) {
    if ($condition) { Write-Pass $message } else { Write-Fail $message; $script:failures++ }
}

# ---------------------------------------------------------------------------
# 1. Version / simulated tag
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $packageJson)) { Write-Fail "package.json not found: $packageJson"; exit 1 }
$pkg = Get-Content -Raw -Encoding UTF8 -LiteralPath $packageJson | ConvertFrom-Json

if ($SimulatedTag -match '^v(.+)$') {
    $version = $Matches[1]
} else {
    $version = $pkg.version
    $SimulatedTag = "v$version"
}
Write-Step "Simulated tag: $SimulatedTag (version=$version)"

# ---------------------------------------------------------------------------
# 2. artifactName static validation (mirrors scripts/check.js T-38 rules)
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $builderYml)) { Write-Fail "electron-builder.yml not found: $builderYml"; exit 1 }
$builderText = Get-Content -Raw -Encoding UTF8 -LiteralPath $builderYml
$artifactMatch = [regex]::Match($builderText, '(?m)^\s*artifactName:\s*([^\r\n#]+)')
Assert $artifactMatch.Success 'electron-builder.yml contains artifactName'
if ($artifactMatch.Success) {
    $artifactPattern = $artifactMatch.Groups[1].Value.Trim()
    Assert ($artifactPattern -match '\$\{version\}' -and $artifactPattern -match '\$\{ext\}') 'artifactName contains ${version} and ${ext}'
    Assert ($artifactPattern -match '^[\x21-\x7E]+$') 'artifactName is pure ASCII'
    $expectedExe = $artifactPattern.Replace('${version}', $version).Replace('${ext}', 'exe')
    $expectedBlockmap = "$expectedExe.blockmap"
    Write-Step "Expected artifacts: $expectedExe (+ $expectedBlockmap, blockmap not required in latest.yml)"
}

# ---------------------------------------------------------------------------
# 3. Git state (read-only)
# ---------------------------------------------------------------------------
Push-Location $root
try {
    $status = & git status --porcelain
    if ($LASTEXITCODE -ne 0) { Write-Warn 'git status failed (maybe not a repo); continuing with local file checks' }
    elseif ($status) { Write-Warn 'Working tree has uncommitted changes; dry-run only verifies artifact consistency' }

    $localTags = & git tag --list "v$version"
    if ($LASTEXITCODE -eq 0 -and $localTags) {
        Write-Step "Local tag v$version already exists (not modified, never pushed)"
    } else {
        Write-Step "No local tag v$version; this simulates the first CI run triggered by that tag"
    }
}
finally { Pop-Location }

# ---------------------------------------------------------------------------
# 4. CI workflow consistency (read-only)
# ---------------------------------------------------------------------------
if (Test-Path -LiteralPath $ciYml) {
    $ciText = Get-Content -Raw -Encoding UTF8 -LiteralPath $ciYml
    foreach ($needle in @('npm run dist', '--publish never', 'softprops/action-gh-release@v3', 'latest.yml')) {
        Assert ($ciText.Contains($needle)) "ci.yml contains '$needle'"
    }
} else {
    Write-Warn ".github/workflows/ci.yml not found; skipping CI consistency check"
}

# ---------------------------------------------------------------------------
# 5. Local build (simulates CI dist job; --publish never)
# ---------------------------------------------------------------------------
$latestExists = Test-Path -LiteralPath $latestYml
if ($SkipBuild -and -not $latestExists) {
    Write-Fail '-SkipBuild specified but dist/latest.yml does not exist'
    exit 1
}
if (-not $SkipBuild -and -not $latestExists) {
    Write-Step 'Building installer locally (npm run dist -- --publish never) ...'
    Push-Location $root
    try {
        & npm.cmd run dist -- --publish never
        $buildCode = $LASTEXITCODE
    }
    finally { Pop-Location }
    Assert ($buildCode -eq 0) "npm run dist exit code: $buildCode"
    if ($buildCode -ne 0) { exit 1 }
} else {
    Write-Step 'Reusing existing dist artifacts (latest.yml present or -SkipBuild)'
}

if (-not (Test-Path -LiteralPath $latestYml)) { Write-Fail 'dist/latest.yml still missing after build'; exit 1 }

# ---------------------------------------------------------------------------
# 6. latest.yml <-> artifacts consistency
# ---------------------------------------------------------------------------
$yml = Get-Content -Raw -LiteralPath $latestYml

$ymlVersion = ''
$vm = [regex]::Match($yml, '(?m)^\s*version:\s*["'']?([^\r\n"'']+)')
if ($vm.Success) { $ymlVersion = $vm.Groups[1].Value.Trim() }
Assert ($ymlVersion -eq $version) "latest.yml version '$ymlVersion' matches package.json version '$version'"

$refs = @()
foreach ($m in [regex]::Matches($yml, '(?m)^\s*(?:url|path):\s*["'']?([^\r\n"'']+)')) {
    $value = $m.Groups[1].Value.Trim()
    if ($value) { $refs += $value }
}
$refs = @($refs | Sort-Object -Unique)
Assert ($refs.Count -gt 0) 'latest.yml contains url/path references'

foreach ($ref in $refs) {
    Assert (Test-Path -LiteralPath (Join-Path $dist $ref)) "latest.yml reference exists in dist: $ref"
}
Assert ($refs -contains $expectedExe) "latest.yml references installer $expectedExe"

$topArtifacts = Get-ChildItem -LiteralPath $dist -File |
    Where-Object { $_.Extension -eq '.exe' }
foreach ($file in $topArtifacts) {
    Assert ($refs -contains $file.Name) "dist artifact listed in latest.yml: $($file.Name)"
}
$topBlockmaps = Get-ChildItem -LiteralPath $dist -File |
    Where-Object { $_.Extension -eq '.blockmap' }
foreach ($file in $topBlockmaps) {
    Assert ($file.Name -match '^[\x21-\x7E]+$') "blockmap filename is pure ASCII: $($file.Name)"
}

# ---------------------------------------------------------------------------
# 7. Summary
# ---------------------------------------------------------------------------
Write-Host ''
if ($failures -gt 0) {
    Write-Fail "Release dry-run FAILED ($failures assertion(s))"
    exit 1
}
Write-Pass "Release dry-run PASSED: tag $SimulatedTag -> local build -> latest.yml consistency OK ($($refs.Count) references)"
Write-Step 'No remote operations were performed (no push, no remote tag, no Release creation)'
exit 0
