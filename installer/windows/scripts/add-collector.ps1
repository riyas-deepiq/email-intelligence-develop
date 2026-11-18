<#
.SYNOPSIS
    Adds another collector instance to an existing installation.

.DESCRIPTION
    Ingestion throughput scales by running more collectors. Each instance needs
    three things, which this script creates:

      1. its own configuration folder   config\collector<N>\.env
      2. its own health port            3000 + N   (loopback only)
      3. its own Windows service        InsightHubCollector<N>

    SERVER_URL and COLLECTOR_SECRET are copied from instance 1, so the new
    collector authenticates immediately. No server-side change is needed:
    instances coordinate through the server, each claiming a distinct batch of
    jobs under its own instance id, so two collectors never process the same
    mailbox.

    Run elevated, from the installation's scripts folder.

.PARAMETER Instance
    Instance number, 2 or higher. Instance 1 is created by the installer.

.PARAMETER InstallDir
    Installation directory. Defaults to the parent of this script's folder.

.PARAMETER Port
    Override the health port. Defaults to 3000 + Instance.

.PARAMETER Concurrency
    Mailboxes processed at once by this instance. Defaults to instance 1's value.

.EXAMPLE
    .\add-collector.ps1 -Instance 2
.EXAMPLE
    .\add-collector.ps1 -Instance 3 -Concurrency 5
.EXAMPLE
    # Remove one again:
    net stop InsightHubCollector2
    & "$PSScriptRoot\..\service\InsightHubCollector2.exe" uninstall
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(2, 99)][int] $Instance,
    [string] $InstallDir,
    [int] $Port,
    [int] $Concurrency
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }
if (-not $Port) { $Port = 3000 + $Instance }

$ConfigRoot   = Join-Path $InstallDir 'config'
$SourceEnv    = Join-Path $ConfigRoot 'collector1\.env'
$TargetDir    = Join-Path $ConfigRoot "collector$Instance"
$TargetEnv    = Join-Path $TargetDir '.env'
$ServiceDir   = Join-Path $InstallDir 'service'
$CollectorExe = Join-Path $InstallDir 'bin\insight-hub-collector.exe'
$ServiceName  = "InsightHubCollector$Instance"
$ServiceExe   = Join-Path $ServiceDir "$ServiceName.exe"

function Write-EnvFile {
    param([string] $Path, [string[]] $Lines)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, ($Lines -join "`r`n") + "`r`n", $utf8NoBom)
}

function Get-EnvValue {
    param([string[]] $Lines, [string] $Key)
    foreach ($line in $Lines) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

function Set-EnvValue {
    param([string[]] $Lines, [string] $Key, [string] $Value)
    $result = @(); $found = $false
    foreach ($line in $Lines) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=") { $result += "$Key=$Value"; $found = $true }
        else { $result += $line }
    }
    if (-not $found) { $result += "$Key=$Value" }
    return $result
}

# ── Checks ───────────────────────────────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated PowerShell — it registers a Windows service.'
}
if (-not (Test-Path $SourceEnv))    { throw "Collector 1 configuration not found at $SourceEnv" }
if (-not (Test-Path $CollectorExe)) { throw "Collector binary not found at $CollectorExe" }
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    throw "$ServiceName already exists. Remove it first, or choose another -Instance."
}

# A port collision surfaces here rather than as a service that starts and dies.
$inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($inUse) { throw "Port $Port is already in use. Pass -Port to choose another." }

# ── Configuration ────────────────────────────────────────────────────────────
$lines = Get-Content $SourceEnv
$serverUrl = Get-EnvValue -Lines $lines -Key 'SERVER_URL'
$secret    = Get-EnvValue -Lines $lines -Key 'COLLECTOR_SECRET'
if ([string]::IsNullOrWhiteSpace($secret) -or $secret -eq 'CHANGE_ME') {
    throw "Collector 1 has no usable COLLECTOR_SECRET — has the installer run?"
}

$lines = Set-EnvValue -Lines $lines -Key 'PORT'             -Value $Port
$lines = Set-EnvValue -Lines $lines -Key 'SERVER_URL'       -Value $serverUrl
$lines = Set-EnvValue -Lines $lines -Key 'COLLECTOR_SECRET' -Value $secret
if ($Concurrency -gt 0) {
    $lines = Set-EnvValue -Lines $lines -Key 'WORKER_CONCURRENCY' -Value $Concurrency
}

# Always cleared, never copied. This file is a copy of instance 1's, and if that
# one pins an explicit identity then inheriting it would give two running
# collectors the same name — the server would treat them as one, and the
# duplicate/offline entries this setting exists to prevent would come straight
# back. Empty means "derive it", which yields <hostname>:<PORT> and so differs
# per instance automatically.
$lines = Set-EnvValue -Lines $lines -Key 'COLLECTOR_INSTANCE_ID' -Value ''

if (-not (Test-Path $TargetDir)) { New-Item -ItemType Directory -Force $TargetDir | Out-Null }
Write-EnvFile -Path $TargetEnv -Lines $lines
Write-Host "Configuration written: $TargetEnv (port $Port)"

# ── Service ──────────────────────────────────────────────────────────────────
# WinSW derives its identity from the executable name, so each instance needs its
# own copy of the wrapper beside a matching .xml.
Copy-Item (Join-Path $ServiceDir 'InsightHubCollector1.exe') $ServiceExe -Force

$xml = @"
<service>
  <id>$ServiceName</id>
  <name>Insight Hub Collector $Instance</name>
  <description>Insight Hub collector instance $Instance (mailbox ingestion)</description>
  <executable>$CollectorExe</executable>
  <workingdirectory>$(Join-Path $InstallDir 'bin')</workingdirectory>
  <env name="INSIGHT_HUB_CONFIG_DIR" value="$TargetDir"/>
  <onfailure action="restart" delay="5 sec"/>
  <log mode="roll"/>
  <logpath>$(Join-Path $InstallDir 'logs')</logpath>
</service>
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $ServiceDir "$ServiceName.xml"), $xml, $utf8NoBom)

& $ServiceExe install | Out-Null
& $ServiceExe start   | Out-Null
Write-Host "Service $ServiceName installed and started."

# ── Verify ───────────────────────────────────────────────────────────────────
# lastPollOk is the real proof: it is false when the shared secret is wrong.
Start-Sleep -Seconds 5
try {
    $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 10
    Write-Host "Health: status=$($health.status) instance=$($health.instance) lastPollOk=$($health.lastPollOk)"
    if ($health.lastPollOk -eq $false) {
        Write-Warning "The collector cannot reach the server: $($health.lastPollError)"
    }
} catch {
    Write-Warning "Health endpoint not answering yet. Check $(Join-Path $InstallDir 'logs')."
}
