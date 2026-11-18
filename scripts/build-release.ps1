<#
.SYNOPSIS
    Builds the Insight Hub release: both binaries and both Windows installers.

.DESCRIPTION
    Runs the full sequence documented in docs/building-executables.md:

        client (vite)  ->  server exe (pkg)  ->  collector exe (pkg)  ->  stage
                       ->  Inno Setup x2  ->  InsightHub-Server-Setup.exe
                                              InsightHub-Collector-Setup.exe

    The staging copy is the reason this script exists. The installer compiles from
    installer\windows\staging\, NOT from release\ — rebuild a binary, forget to
    re-stage it, and the setup silently ships the previous build. This always
    re-stages what it just built.

    Both binaries are Brotli-compressed by pkg (roughly halving them), and the
    installer applies solid ultra64 LZMA2 on top.

.PARAMETER Version
    Version stamped into the installer (default 1.0.0).

.PARAMETER SkipInstall
    Skip `npm ci` in the three packages. Much faster when dependencies are current.

.PARAMETER SkipInstaller
    Build the binaries only; do not compile the installer. Useful while iterating,
    since the compression pass is the slowest part of the build.

.EXAMPLE
    .\scripts\build-release.ps1 -Version 1.2.0
.EXAMPLE
    .\scripts\build-release.ps1 -SkipInstall
#>
[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$')]
    [string] $Version = '1.0.0',
    [switch] $SkipInstall,
    [switch] $SkipInstaller
)

$ErrorActionPreference = 'Stop'
$started = Get-Date

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$InstallerDir = Join-Path $RepoRoot 'installer\windows'
$Staging      = Join-Path $InstallerDir 'staging'
$ReleaseWin   = Join-Path $RepoRoot 'release\win'

function Write-Step { param([string] $Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "  $Message" -ForegroundColor Green }

# Runs a native tool and fails only on a non-zero exit code.
#
# Two Windows PowerShell quirks are handled here:
#  - the exit code does not trip $ErrorActionPreference, so it is checked explicitly;
#  - anything a native tool writes to stderr becomes an ErrorRecord, which under
#    'Stop' aborts the build. npm, vite and pkg all write progress and warnings to
#    stderr on a perfectly successful run, so the preference is relaxed around the
#    call and the exit code is treated as the only verdict.
function Invoke-Checked {
    param([string] $Exe, [string[]] $Arguments, [string] $What)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments
    } finally {
        $ErrorActionPreference = $previous
    }

    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

function Invoke-Npm {
    param([string] $Package, [string[]] $Arguments)
    Invoke-Checked -Exe 'npm.cmd' -Arguments (@('--prefix', (Join-Path $RepoRoot $Package)) + $Arguments) `
                   -What "npm $($Arguments -join ' ') ($Package)"
}

# ── Prerequisites ────────────────────────────────────────────────────────────
Write-Step 'Checking prerequisites'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not on PATH.' }
Write-Ok "node $(node -v)"

$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
if (-not $SkipInstaller) {
    if (-not (Test-Path $Iscc)) {
        $onPath = Get-Command iscc -ErrorAction SilentlyContinue
        if ($onPath) {
            $Iscc = $onPath.Source
        } else {
            throw "Inno Setup 6 not found at '$Iscc'. Install it, or pass -SkipInstaller."
        }
    }
    Write-Ok "Inno Setup: $Iscc"

    # WinSW is not in the repo and cannot be built — fail now rather than after
    # ten minutes of compiling.
    $winsw = Join-Path $Staging 'service\WinSW.exe'
    if (-not (Test-Path $winsw)) {
        throw "WinSW.exe missing at '$winsw'. Download WinSW-x64.exe from " +
              'https://github.com/winsw/winsw/releases and save it there.'
    }
    Write-Ok 'WinSW.exe staged'
}

# ── Dependencies ─────────────────────────────────────────────────────────────
if ($SkipInstall) {
    Write-Step 'Skipping dependency install (-SkipInstall)'
} else {
    foreach ($pkg in 'client', 'server', 'collector') {
        Write-Step "Installing dependencies: $pkg"
        Invoke-Npm -Package $pkg -Arguments @('ci')
    }
}

# ── Build ────────────────────────────────────────────────────────────────────
# The client must be built before the server: `package:win` copies client/dist
# into server/public and embeds it in the executable.
Write-Step 'Building web client'
Invoke-Npm -Package 'client' -Arguments @('run', 'build')
Write-Ok 'client/dist'

Write-Step 'Building server executable'
Invoke-Npm -Package 'server' -Arguments @('run', 'package:win')
Write-Ok 'release/win/insight-hub-server.exe'

Write-Step 'Building collector executable'
Invoke-Npm -Package 'collector' -Arguments @('run', 'package:win')
Write-Ok 'release/win/insight-hub-collector.exe'

# ── Stage ────────────────────────────────────────────────────────────────────
Write-Step 'Staging binaries for the installer'
$stagePlan = @('insight-hub-server.exe', 'insight-hub-collector.exe')
$stagingBin = Join-Path $Staging 'bin'
if (-not (Test-Path $stagingBin)) { New-Item -ItemType Directory -Force $stagingBin | Out-Null }

foreach ($item in $stagePlan) {
    $source = Join-Path $ReleaseWin $item
    if (-not (Test-Path $source)) { throw "Expected build output missing: $source" }
    Copy-Item $source $stagingBin -Force
    Write-Ok ('{0} -> staging\bin ({1:N1} MB)' -f $item, ((Get-Item $source).Length / 1MB))
}

# ── Installer ────────────────────────────────────────────────────────────────
if ($SkipInstaller) {
    Write-Step 'Skipping installer (-SkipInstaller)'
} else {
    # One .iss, compiled once per edition. Two separate products: install either
    # alone, or both on one machine in any order.
    $iss = Join-Path $InstallerDir 'insight-hub.iss'
    foreach ($edition in 'server', 'collector') {
        Write-Step "Compiling $edition installer (version $Version)"
        Write-Host '  Solid ultra64 compression — this takes a few minutes.' -ForegroundColor DarkGray
        Invoke-Checked -Exe $Iscc -Arguments @($iss, "/DAppVersion=$Version", "/DEdition=$edition") `
                       -What "Inno Setup compile ($edition)"
        Write-Ok "InsightHub-$((Get-Culture).TextInfo.ToTitleCase($edition))-Setup.exe"
    }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Step 'Artifacts'
Get-ChildItem $ReleaseWin -Filter *.exe -ErrorAction SilentlyContinue |
    Sort-Object Name |
    ForEach-Object { '  {0,-40} {1,8:N1} MB   {2}' -f $_.Name, ($_.Length / 1MB), $_.LastWriteTime }

Write-Host ("`nDone in {0:N0}s." -f ((Get-Date) - $started).TotalSeconds) -ForegroundColor Green
Write-Host 'Reminder: sign the binaries and the installer before release (packaging-design.md §11).' -ForegroundColor Yellow
