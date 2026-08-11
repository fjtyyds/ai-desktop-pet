# sync-latest.ps1
# Build the app (unless -SkipBuild) and sync release artifacts to E:\codex\AI桌宠最新版.
# Keep this file pure ASCII: Windows PowerShell 5.1 parses no-BOM .ps1 as ANSI/GBK.

param(
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
# Build target path from codepoints to keep this file pure ASCII
# (Windows PowerShell 5.1 parses no-BOM .ps1 as ANSI/GBK).
# AI + 桌(684C) 宠(5BA0) 最(6700) 新(65B0) 版(7248)
$target = 'E:\codex\AI' + [string][char]0x684C + [string][char]0x5BA0 + [string][char]0x6700 + [string][char]0x65B0 + [string][char]0x7248

if (-not (Test-Path -LiteralPath $target)) {
  New-Item -ItemType Directory -Path $target | Out-Null
}

if (-not $SkipBuild) {
  Write-Host '[sync] npm run dist -- --publish never ...'
  Push-Location $root
  try {
    & npm.cmd run dist -- --publish never
    if ($LASTEXITCODE -ne 0) {
      throw "npm run dist failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $dist)) {
  throw "dist directory not found: $dist"
}

$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Encoding UTF8 | ConvertFrom-Json).version
$commit = (& git -C $root rev-parse --short HEAD).Trim()
$date = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

# remove stale artifacts in target (keep README.md / latest.json)
Get-ChildItem -LiteralPath $target -File | Where-Object {
  $_.Name -match '\.(exe|blockmap|msix|msixupload)$' -or $_.Name -eq 'latest.yml'
} | Remove-Item -Force

$files = @()
$patterns = @('*.exe', '*.blockmap', 'latest.yml', '*.msix', '*.msixupload')
foreach ($p in $patterns) {
  foreach ($src in Get-ChildItem -LiteralPath $dist -File -Filter $p) {
    Copy-Item -LiteralPath $src.FullName -Destination (Join-Path $target $src.Name) -Force
    $hash = (Get-FileHash -LiteralPath $src.FullName -Algorithm SHA256).Hash
    $files += [PSCustomObject]@{ name = $src.Name; size = $src.Length; sha256 = $hash }
  }
}

$manifest = [ordered]@{
  version  = $version
  commit   = $commit
  built_at = $date
  target   = $target
  files    = @($files)
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
  (Join-Path $target 'latest.json'),
  $manifest,
  (New-Object System.Text.UTF8Encoding($false))
)

$template = Join-Path $root 'docs\templates\latest-version-readme.md'
if (Test-Path -LiteralPath $template) {
  $readme = Get-Content -LiteralPath $template -Encoding UTF8 -Raw
  $fileRows = ($files | ForEach-Object {
    '| {0} | {1:N2} MB | {2} |' -f $_.name, ($_.size / 1MB), $_.sha256
  }) -join "`r`n"
  $readme = $readme.Replace('{{VERSION}}', $version).Replace('{{COMMIT}}', $commit).Replace('{{DATE}}', $date).Replace('{{FILE_ROWS}}', $fileRows)
  [System.IO.File]::WriteAllText(
    (Join-Path $target 'README.md'),
    $readme,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

Write-Host "[sync] OK -> $target (version $version, commit $commit)"
$files | ForEach-Object { Write-Host ('  {0}  {1:N2} MB' -f $_.name, ($_.size / 1MB)) }
