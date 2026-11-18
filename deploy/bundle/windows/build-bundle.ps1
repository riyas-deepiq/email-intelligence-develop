<#
.SYNOPSIS
    Builds the Windows container installers for the selected Insight Hub roles.

.DESCRIPTION
    The Windows counterpart of build-bundle.sh. Produces the same payload —
    container images, a derived compose file, a config template, a manifest and
    checksums — then wraps it in an Inno Setup .exe instead of a self-extracting
    shell script.

    Both builders derive the shipped compose file directly from
    deploy/docker-compose.yml, preserving `${...}` expressions so build-time
    placeholders cannot become customer secrets.

.PARAMETER Version
    Version stamped into the installer and used as the image tag.

.PARAMETER SkipBuild
    Skip `docker compose build`. Useful when the images are already current.

.PARAMETER SkipPull
    Skip pulling the stock images (postgres, redis, qdrant, ollama).

.EXAMPLE
    .\deploy\bundle\build-bundle.ps1 -Version 1.0.0

.NOTES
    Requires: Docker Desktop (or Docker Engine) with compose v2, python3,
    Inno Setup 6 (iscc.exe on PATH), and WinSW.exe staged under installer\windows.

    Expect ~8 GB of output and a long compile. The images are already gzipped,
    so the .iss uses `nocompression` for them — recompressing would add hours for
    almost no size gain.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$')]
    [string] $Version,
    [ValidateSet('server', 'collector', 'rag')] [string[]] $Role = @('server', 'collector', 'rag'),
    [switch] $SkipBuild,
    [switch] $SkipPull
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is deploy\bundle\windows — three levels below the repository root.
$BundleDir = Split-Path -Parent $PSScriptRoot                       # deploy\bundle — shared files
$RepoRoot  = Split-Path -Parent (Split-Path -Parent $BundleDir)
$DeployDir = Join-Path $RepoRoot 'deploy'
$BuildRoot = Join-Path $RepoRoot 'build\payload'

# One installer per container role. The server carries its own datastores, the
# collector reaches the server over SERVER_URL, and RAG reaches both the Core
# Server and its authoritative PostgreSQL database over configured URLs.
$RoleServices = @{
    'server'    = 'postgres,redis,server'
    'collector' = 'collector'
    'rag'       = 'redis,qdrant,ollama,ollama-init,rag'
}
$RoleImages = @{
    'server'    = @("insight-hub/server:$Version", 'postgres:16.14-alpine3.24', 'redis:7.4.10-alpine')
    'collector' = @("insight-hub/collector:$Version")
    'rag'       = @("insight-hub/rag:$Version", 'redis:7.4.10-alpine', 'qdrant/qdrant:v1.19.0-unprivileged', 'ollama/ollama:0.32.6')
}

function Write-Step { param([string] $m) Write-Host "==> $m" -ForegroundColor Cyan }
function Fail { param([string] $m) Write-Host "error: $m" -ForegroundColor Red; exit 1 }

foreach ($tool in @('docker', 'python', 'iscc')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Fail "$tool not found on PATH."
    }
}

$env:POSTGRES_PASSWORD   = 'build-only'
$env:JWT_SECRET          = 'build-only-not-a-runtime-secret'
$env:OIDC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$env:COLLECTOR_SECRET    = 'build-only-not-runtime'
$env:RAG_INTERNAL_SECRET = 'build-only-not-runtime'
$env:SEED_ADMIN_PASSWORD = 'build-only'

$composeSource = Join-Path $DeployDir 'docker-compose.yml'
docker compose -f $composeSource config --quiet
if ($LASTEXITCODE -ne 0) { Fail 'source compose validation failed.' }

# ── Build and pull, once for every role ─────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step "Building application images (tag $Version)"
    $env:IMAGE_TAG = $Version
    docker compose -f $composeSource build @Role
    if ($LASTEXITCODE -ne 0) { Fail 'image build failed.' }
}

if (-not $SkipPull) {
    Write-Step 'Pulling stock images'
    $stockImages = $Role | ForEach-Object { $RoleImages[$_] } |
        Where-Object { $_ -notlike 'insight-hub/*' } | Select-Object -Unique
    foreach ($image in $stockImages) {
        docker pull $image
        if ($LASTEXITCODE -ne 0) { Fail "failed to pull $image" }
    }
}

if (Test-Path $BuildRoot) { Remove-Item -Recurse -Force $BuildRoot }
New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null

# WinSW is downloaded, not built — the native installer stages it in one of two
# places depending on which build script ran last.
$winsw = Join-Path $RepoRoot 'installer\windows\staging\bin\WinSW.exe'
if (-not (Test-Path $winsw)) {
    $winsw = Join-Path $RepoRoot 'installer\windows\staging\service\WinSW.exe'
}
if (-not (Test-Path $winsw)) {
    Fail "WinSW.exe not found. Download it into installer\windows\staging\bin\ (it is downloaded, not built)."
}

$stripper = Join-Path $BundleDir 'strip-build.py'     # shared with the Linux builder
$iss      = Join-Path $PSScriptRoot 'insight-hub-bundle.iss'
$built    = @()

foreach ($r in $Role) {
    Write-Host ''
    Write-Host "════ Building the $r bundle ════" -ForegroundColor Yellow

    $payload = Join-Path $BuildRoot $r
    foreach ($sub in @('images', 'compose', 'config', 'service')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $payload $sub) | Out-Null
    }

    Write-Step 'Saving images'
    foreach ($image in $RoleImages[$r]) {
        $name = $image -replace '[/:]', '_'
        $out  = Join-Path $payload "images\$name.tar.gz"
        Write-Host "    $image"
        # docker save writes a tar; compressing it with .NET avoids depending on
        # an external gzip being present on a Windows build agent.
        $tar = Join-Path $env:TEMP "$name.tar"
        docker save $image -o $tar
        if ($LASTEXITCODE -ne 0) { Fail "failed to save $image" }

        $in = [System.IO.File]::OpenRead($tar)
        $fs = [System.IO.File]::Create($out)
        $gz = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionLevel]::Fastest)
        try { $in.CopyTo($gz) } finally { $gz.Dispose(); $fs.Dispose(); $in.Dispose() }
        Remove-Item $tar -Force
    }

    Write-Step "Deriving the $r compose file"
    # Shared with build-bundle.sh — one implementation, so the two platforms
    # cannot ship different topologies for the same role.
    python $stripper $composeSource (Join-Path $payload 'compose\docker-compose.yml') $Version --role $r --services $RoleServices[$r]
    if ($LASTEXITCODE -ne 0) { Fail "failed to derive the $r compose file." }

    Copy-Item (Join-Path $DeployDir '.env.example') (Join-Path $payload 'config\.env.template') -Force
    Copy-Item $winsw (Join-Path $payload 'service\WinSW.exe') -Force
    $r | Out-File -FilePath (Join-Path $payload 'ROLE') -Encoding ascii

@"
product=InsightHub
role=$r
version=$Version
built=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))
platform=windows
"@ | Out-File -FilePath (Join-Path $payload 'MANIFEST') -Encoding ascii

    Write-Step 'Writing checksums'
    $sums = Get-ChildItem -Path $payload -Recurse -File |
            Where-Object { $_.Name -ne 'SHA256SUMS' } |
            Sort-Object FullName |
            ForEach-Object {
                $hash = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLower()
                $rel  = $_.FullName.Substring($payload.Length + 1) -replace '\', '/'
                "$hash  ./$rel"
            }
    $sums | Out-File -FilePath (Join-Path $payload 'SHA256SUMS') -Encoding ascii

    Write-Step "Compiling the $r installer (this takes a while)"
    iscc "/DAppVersion=$Version" "/DRole=$r" "/DPayloadDir=$payload" $iss
    if ($LASTEXITCODE -ne 0) { Fail "Inno Setup compilation failed for the $r role." }

    if ($r -eq 'server') {
        $name = "InsightHub-Server-Setup-$Version.exe"
    } elseif ($r -eq 'collector') {
        $name = "InsightHub-Collector-Setup-$Version.exe"
    } else {
        $name = "InsightHub-RAG-Setup-$Version.exe"
    }
    $output = Join-Path $RepoRoot "release\win\$name"
    if (-not (Test-Path $output)) { Fail "compilation reported success but $output is missing." }

    $size = [math]::Round((Get-Item $output).Length / 1GB, 2)
    Write-Host "Built: $output ($size GB)" -ForegroundColor Green
    $built += $output
}

Write-Host ''
Write-Host 'Install on the target machines as Administrator (server before RAG):' -ForegroundColor Green
foreach ($path in $built) { Write-Host "  $path" }
Write-Host ''
Write-Host 'The collector installer asks for the server URL and COLLECTOR_SECRET,'
Write-Host 'which the server installer prints when it finishes.'
Write-Host 'The RAG installer also needs a reachable PostgreSQL URL and the RAG shared secret.'
