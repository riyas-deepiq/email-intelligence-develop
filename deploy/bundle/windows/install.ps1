<#
.SYNOPSIS
    Insight Hub — Windows container installer (runs inside the setup .exe).

.DESCRIPTION
    The Windows counterpart of deploy/bundle/install.sh. Same payload, same
    per-role split, same generated-secrets model; only the platform mechanics
    differ:

      Linux                          Windows
      ─────────────────────────────  ──────────────────────────────────────────
      systemd Type=oneshot           WinSW service wrapping a foreground `up`
      /etc + /var/lib                ProgramData\InsightHub\<role>
      chmod 0600                     ACL: SYSTEM + Administrators only
      ss -ltn                        Get-NetTCPConnection
      openssl rand                   RandomNumberGenerator

    Three roles, one script:
      server     PostgreSQL + Redis + API and web interface (publishes a port)
      collector  the ingestion worker only (no inbound port)
      rag        Qdrant + Redis + Ollama + RAG API (publishes a port)

    Safe to re-run: loading images, writing the service and starting the stack
    are idempotent, and an existing .env is never overwritten — which is what
    makes re-running the setup an upgrade.

    Written for Windows PowerShell 5.1 (no ternary, no null-coalescing) because
    that is what ships in the box on Windows Server 2022.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [ValidateSet('server', 'collector', 'rag')] [string] $Role,
    [Parameter(Mandatory = $true)] [string] $InstallDir,
    [int]    $Port = 8080,
    [string] $ServerUrl = '',
    [string] $CollectorSecret = '',
    [string] $PostgresUrl = '',
    [string] $RagSecret = '',
    [int]    $RagPort = 8000,
    [string] $RagBind = '0.0.0.0',
    [string] $DataRoot = "$env:ProgramData\InsightHub",
    [switch] $NoStart
)

$ErrorActionPreference = 'Stop'

$RoleRoot    = Join-Path $DataRoot $Role
$ConfigDir   = Join-Path $RoleRoot 'config'
$LogDir      = Join-Path $RoleRoot 'logs'
$EnvFile     = Join-Path $ConfigDir '.env'
$ComposeFile = Join-Path $InstallDir 'docker-compose.yml'

if ($Role -eq 'server')      { $ServiceName = 'InsightHubServer' }
elseif ($Role -eq 'collector') { $ServiceName = 'InsightHubCollector' }
else                         { $ServiceName = 'InsightHubRAG' }

# Distinct compose project per role. Without this, installing several roles on
# one machine would give their stacks the same project name and a later `up` could
# adopt and then tear down the first one's containers.
$Project = "insight-hub-$Role"

function Write-Step { param([string] $Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Fail { param([string] $Message) Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

<#
  Runs a native executable and returns its exit code.

  Windows PowerShell 5.1 wraps each stderr line from a native command in an
  ErrorRecord when it is redirected. Under $ErrorActionPreference = 'Stop' that
  becomes a terminating NativeCommandError even when the command exited 0 — so
  `docker info` writing a warning would be misread as "Docker is not running".
  Dropping to 'Continue' for the duration and trusting $LASTEXITCODE is the
  reliable way to call native tools from a strict-mode script.
#>
function Invoke-Native {
    param([string] $Exe, [string[]] $Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-EnvValue {
    param([string] $Path, [string] $Key)
    if (-not (Test-Path $Path)) { return '' }
    $match = Select-String -Path $Path -Pattern "^$Key=" -ErrorAction SilentlyContinue
    if (-not $match) { return '' }
    return ($match.Line -split '=', 2)[1]
}

if ($Role -eq 'rag' -and (Test-Path $EnvFile)) {
    $PostgresUrl = Get-EnvValue -Path $EnvFile -Key 'RAG_POSTGRES_URL'
    $ServerUrl = Get-EnvValue -Path $EnvFile -Key 'CORE_SERVER_URL'
    $RagSecret = Get-EnvValue -Path $EnvFile -Key 'RAG_INTERNAL_SECRET'
    $existingPort = Get-EnvValue -Path $EnvFile -Key 'RAG_PORT'
    $existingBind = Get-EnvValue -Path $EnvFile -Key 'RAG_BIND'
    if ($existingPort) { $RagPort = [int]$existingPort }
    if ($existingBind) { $RagBind = $existingBind }
}

# ── 1. Preflight ────────────────────────────────────────────────────────────
Write-Step "Installing the $Role role"
Write-Step 'Checking prerequisites'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail @'
no container runtime found.

  Insight Hub runs as Linux containers, which on Windows requires WSL2:

    1. wsl --install                      (reboot when prompted)
    2. Install Docker Desktop, or Docker Engine inside the WSL2 distribution
    3. Re-run this installer

  Note on licensing: Docker Desktop requires a paid subscription for larger
  organisations. Docker Engine inside WSL2, or Podman, does not.
'@
}

if ((Invoke-Native docker @('info')) -ne 0) {
    Fail 'Docker is installed but not running. Start Docker Desktop (or the daemon in WSL2) and re-run.'
}
if ((Invoke-Native docker @('compose', 'version')) -ne 0) {
    Fail 'the docker compose plugin is missing. Update Docker and re-run.'
}

if (($Role -eq 'server' -or $Role -eq 'rag') -and
    -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    $listenPort = if ($Role -eq 'server') { $Port } else { $RagPort }
    if ($listenPort -lt 1 -or $listenPort -gt 65535) { Fail 'port must be between 1 and 65535.' }
    $inUse = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue
    if ($inUse) { Fail "port $listenPort is already in use. Re-run setup and choose another port." }
}

if ($Role -eq 'rag') {
    $serverEnv = Join-Path $DataRoot 'server\config\.env'
    if (-not $RagSecret -and (Test-Path $serverEnv)) {
        $RagSecret = Get-EnvValue -Path $serverEnv -Key 'RAG_INTERNAL_SECRET'
    }
    if (-not $ServerUrl -and (Test-Path $serverEnv)) {
        $serverPort = Get-EnvValue -Path $serverEnv -Key 'SERVER_PORT'
        if (-not $serverPort) { $serverPort = '8080' }
        $ServerUrl = "http://host.docker.internal:$serverPort"
    }

    if ($ServerUrl -notmatch '^https?://') { Fail 'the Core Server URL must start with http:// or https://.' }
    if ($PostgresUrl -notmatch '^postgresql(?:\+psycopg2)?://') {
        Fail 'the PostgreSQL URL must use postgresql:// or postgresql+psycopg2://.'
    }
    if ($RagSecret.Length -lt 16) {
        Fail 'the RAG secret must be at least 16 characters and match the Core Server RAG_INTERNAL_SECRET configuration.'
    }
    if ($RagBind -notmatch '^[0-9A-Fa-f:.]+$') { Fail 'the RAG bind value must be an IP address.' }
}

# ── 2. Collector: find the server it belongs to ─────────────────────────────
if ($Role -eq 'collector') {
    $serverEnv = Join-Path $DataRoot 'server\config\.env'

    if (-not $CollectorSecret -and (Test-Path $serverEnv)) {
        Write-Step 'Reading COLLECTOR_SECRET from the server installed on this machine'
        $CollectorSecret = Get-EnvValue -Path $serverEnv -Key 'COLLECTOR_SECRET'
        if (-not $ServerUrl) {
            $serverPort = Get-EnvValue -Path $serverEnv -Key 'SERVER_PORT'
            if (-not $serverPort) { $serverPort = '8080' }
            # host.docker.internal reaches the Windows host from inside a container.
            $ServerUrl = "http://host.docker.internal:$serverPort"
        }
    }

    if (-not $ServerUrl) { Fail 'a server URL is required (for example http://insight-hub-server:8080).' }
    if (-not $CollectorSecret) {
        Fail @"
a collector secret is required.

  Copy COLLECTOR_SECRET from the server machine:
    C:\ProgramData\InsightHub\server\config\.env

  If the two do not match, every poll is rejected with 401 and no mail is
  collected — visible only as lastPollError on the collector's health output.
"@
    }
}

# ── 3. Directories ──────────────────────────────────────────────────────────
Write-Step 'Creating directories'
$dirs = @($ConfigDir, $LogDir)
if ($Role -eq 'server') {
    $dirs += (Join-Path $RoleRoot 'postgres')
    $dirs += (Join-Path $RoleRoot 'redis')
}
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

# ── 4. Images ───────────────────────────────────────────────────────────────
Write-Step 'Loading container images (this takes several minutes)'
$images = Get-ChildItem -Path (Join-Path $InstallDir 'images') -Filter *.tar.gz -ErrorAction SilentlyContinue
if (-not $images) { Fail "no images found in $InstallDir\images — the package is incomplete." }

foreach ($image in $images) {
    Write-Host "    $($image.Name)"
    # `docker load -i` reads the gzip directly, which avoids materialising a
    # multi-GB temp file the way a PowerShell decompress-then-load would.
    if ((Invoke-Native docker @('load', '-i', $image.FullName)) -ne 0) {
        Fail "failed to load $($image.Name)"
    }
}

# ── 5. Configuration ────────────────────────────────────────────────────────
$template = Join-Path $InstallDir '.env.template'
Copy-Item $template (Join-Path $ConfigDir '.env.default') -Force

function New-Secret {
    param([int] $Bytes = 32)
    $buffer = New-Object 'System.Byte[]' $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

$manifestVersion = Get-EnvValue -Path (Join-Path $InstallDir 'MANIFEST') -Key 'version'
if (-not $manifestVersion) { $manifestVersion = 'local' }

if (Test-Path $EnvFile) {
    Write-Step "Keeping the existing configuration at $EnvFile (upgrade)"
    $existing = Get-Content $EnvFile
    $updated = foreach ($line in $existing) {
        if ($line -match '^IMAGE_TAG=') { "IMAGE_TAG=$manifestVersion" } else { $line }
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($EnvFile, $updated, $utf8NoBom)
} else {
    Write-Step 'Generating configuration and per-machine secrets'

    $values = @{ 'IMAGE_TAG' = $manifestVersion }
    if ($Role -eq 'server') {
        $values['POSTGRES_PASSWORD']   = (New-Secret 24)
        $values['JWT_SECRET']          = (New-Secret 48)
        $values['OIDC_ENCRYPTION_KEY'] = (New-Secret 32)   # exactly 64 hex chars
        $values['COLLECTOR_SECRET']    = (New-Secret 24)
        $values['RAG_INTERNAL_SECRET'] = (New-Secret 32)
        $values['SEED_ADMIN_PASSWORD'] = (New-Secret 12)
        $values['SERVER_PORT']         = "$Port"
        $values['SERVER_BIND']         = '0.0.0.0'
    } elseif ($Role -eq 'collector') {
        $values['COLLECTOR_SECRET'] = $CollectorSecret
        $values['SERVER_URL']       = $ServerUrl
    } else {
        $values['RAG_POSTGRES_URL']    = $PostgresUrl
        $values['CORE_SERVER_URL']     = $ServerUrl
        $values['RAG_INTERNAL_SECRET'] = $RagSecret
        $values['RAG_PORT']            = "$RagPort"
        $values['RAG_BIND']            = $RagBind
    }

    $lines = Get-Content $template
    $seen = @{}
    $out = foreach ($line in $lines) {
        $replaced = $line
        foreach ($key in $values.Keys) {
            if ($line -match "^$key=") { $replaced = "$key=$($values[$key])"; $seen[$key] = $true }
        }
        $replaced
    }
    # Keys the template does not carry (SERVER_URL on the collector) must still
    # reach the file, or compose interpolates an empty value and the service
    # starts pointed at nothing.
    $out += foreach ($key in $values.Keys) {
        if (-not $seen.ContainsKey($key)) { "$key=$($values[$key])" }
    }

    # UTF8 without BOM: dotenv treats a leading BOM as part of the first key name,
    # which turns NODE_ENV into a variable nothing reads.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($EnvFile, $out, $utf8NoBom)

    # This file holds every secret on the machine. Break inheritance, then grant
    # only SYSTEM and Administrators.
    $acl = Get-Acl $EnvFile
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($identity in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -Path $EnvFile -AclObject $acl
}

# ── 6. Service registration ─────────────────────────────────────────────────
# WinSW supervises a FOREGROUND `docker compose up`. `up -d` would exit
# immediately and Windows would treat the service as crashed; running attached
# means the service's lifetime is the stack's lifetime, and stopping it runs
# `compose down` through <stopexecutable>.
Write-Step 'Registering the Windows service'

$serviceExe = Join-Path $InstallDir "service\$ServiceName.exe"
$serviceXml = Join-Path $InstallDir "service\$ServiceName.xml"

$xml = @"
<service>
  <id>$ServiceName</id>
  <name>Insight Hub ($Role)</name>
  <description>Insight Hub $Role role.</description>
  <executable>docker</executable>
  <arguments>compose -p $Project --env-file "$EnvFile" -f "$ComposeFile" up</arguments>
  <stopexecutable>docker</stopexecutable>
  <stoparguments>compose -p $Project --env-file "$EnvFile" -f "$ComposeFile" down</stoparguments>
  <workingdirectory>$InstallDir</workingdirectory>
  <logpath>$LogDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
</service>
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($serviceXml, $xml, $utf8NoBom)

# Re-registering over an existing service fails; remove it first on upgrade.
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    if ($existingService.Status -ne 'Stopped') { $null = Invoke-Native $serviceExe @('stop') }
    $null = Invoke-Native $serviceExe @('uninstall')
    Start-Sleep -Seconds 2
}
if ((Invoke-Native $serviceExe @('install')) -ne 0) {
    Fail 'failed to register the Windows service.'
}

# ── 7. Firewall (published roles only) ──────────────────────────────────────
if ($Role -eq 'server' -or $Role -eq 'rag') {
    $firewallName = if ($Role -eq 'server') { 'InsightHub' } else { 'InsightHub RAG' }
    $firewallPort = if ($Role -eq 'server') { $Port } else { $RagPort }
    Write-Step "Opening inbound TCP $firewallPort"
    $null = Invoke-Native netsh @('advfirewall', 'firewall', 'delete', 'rule', "name=$firewallName")
    $null = Invoke-Native netsh @('advfirewall', 'firewall', 'add', 'rule',
                                  "name=$firewallName", 'dir=in', 'action=allow',
                                  'protocol=TCP', "localport=$firewallPort")
}
# The collector opens nothing: it polls the server outbound and its only inbound
# route is a loopback health endpoint.

# ── 8. Start ────────────────────────────────────────────────────────────────
if ($NoStart) {
    Write-Step "Installed. Start it with: net start $ServiceName"
    exit 0
}

Write-Step 'Starting services'
if ((Invoke-Native $serviceExe @('start')) -ne 0) {
    Fail "the service failed to start — see the logs in $LogDir"
}

# ── 9. Verify ───────────────────────────────────────────────────────────────
if ($Role -eq 'server') {
    Write-Step 'Waiting for the service to answer'
    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/health" `
                                          -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { $healthy = $true; break }
        } catch {
            # Expected while images start and migrations run; keep waiting.
        }
        Start-Sleep -Seconds 5
    }

    if (-not $healthy) {
        Write-Host 'warning: the service did not become healthy within 5 minutes.' -ForegroundColor Yellow
        Write-Host "  Check: docker compose -p $Project -f `"$ComposeFile`" logs server"
        exit 1
    }

    $adminEmail = Get-EnvValue -Path $EnvFile -Key 'SEED_ADMIN_EMAIL'
    if (-not $adminEmail) { $adminEmail = 'admin@insight-hub.local' }
    $sharedSecret = Get-EnvValue -Path $EnvFile -Key 'COLLECTOR_SECRET'

    Write-Host ''
    Write-Host '  Insight Hub (server) is installed and running.' -ForegroundColor Green
    Write-Host ''
    Write-Host "    URL       http://localhost:$Port"
    Write-Host "    Sign in   $adminEmail"
    Write-Host "    Password  see SEED_ADMIN_PASSWORD in $EnvFile"
    Write-Host ''
    Write-Host '  Change that password on first login, then set SEED_DEFAULT_ADMIN=false.'
    Write-Host ''
    Write-Host '  To add a collector on another machine, run its installer and supply:'
    Write-Host "    Server URL:        http://$env:COMPUTERNAME`:$Port"
    Write-Host "    Collector secret:  $sharedSecret"
    Write-Host ''
    Write-Host "  To add RAG, use RAG_INTERNAL_SECRET from $EnvFile, then set"
    Write-Host '  RAG_API_URL in that file to the RAG node URL.'
    Write-Host ''
} elseif ($Role -eq 'collector') {
    Write-Step 'Checking the collector'
    Start-Sleep -Seconds 5
    $running = docker compose -p $Project -f $ComposeFile ps --status running 2>$null
    if ($running -match 'collector') {
        Write-Host ''
        Write-Host '  Insight Hub (collector) is installed and running.' -ForegroundColor Green
        Write-Host ''
        Write-Host "    Polling   $ServerUrl"
        Write-Host "    Logs      docker compose -p $Project -f `"$ComposeFile`" logs -f collector"
        Write-Host ''
        Write-Host '  A wrong secret shows up as lastPollOk:false with a 401 in lastPollError —'
        Write-Host '  the collector stays up either way, so check the log.'
        Write-Host ''
    } else {
        Write-Host 'warning: the collector container is not running — check the logs.' -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Step 'Checking the RAG service'
    $healthy = $false
    for ($i = 0; $i -lt 360; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$RagPort/health" `
                                          -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { $healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 5
    }

    if (-not $healthy) {
        Write-Host 'warning: the RAG service did not become healthy within 30 minutes.' -ForegroundColor Yellow
        Write-Host "  Check: docker compose -p $Project -f `"$ComposeFile`" logs rag ollama-init"
        exit 1
    }

    Write-Host ''
    Write-Host '  Insight Hub RAG is installed and healthy.' -ForegroundColor Green
    Write-Host ''
    Write-Host "    RAG URL   http://$env:COMPUTERNAME`:$RagPort"
    Write-Host "    Config    $EnvFile"
    Write-Host "    Logs      docker compose -p $Project -f `"$ComposeFile`" logs -f rag"
    Write-Host ''
    Write-Host '  Set RAG_API_URL on the Core Server. Its existing RAG_INTERNAL_SECRET must'
    Write-Host '  match this role; Compose passes that value as RAG_API_SECRET.'
    Write-Host ''
}
