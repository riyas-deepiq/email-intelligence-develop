<#
.SYNOPSIS
    Prepares the packaged .env files after an installation. Run by the installer.

.DESCRIPTION
    The installer asks only for a folder and a shortcut preference, so this script
    does the small amount of per-machine work that cannot be shipped in a file:

      1. Replaces __INSTALLDIR__ with the folder the operator chose.
      2. Generates JWT_SECRET, OIDC_ENCRYPTION_KEY and COLLECTOR_SECRET wherever
         the template still says CHANGE_ME, so no two installations share a
         secret. A value pinned in the template is left untouched.
      3. Joins the server and the collector together. They install into separate
         directories, so each finds the other through its registry entry rather
         than by looking in its own folder. Whichever is installed second — or
         reinstalled later — reconciles the pair:
            server    -> writes its COLLECTOR_SECRET into the collector's config
                         and restarts the collector service, since a collector
                         running with a stale secret is rejected 401 forever
            collector -> adopts the server's COLLECTOR_SECRET and PORT
      4. Opens the server's port for inbound TCP, reading the port from the .env
         so an edited template and the firewall rule cannot disagree. A collector
         listens on loopback only and gets no rule.

    Idempotent: re-running only fills in placeholders that are still unresolved,
    and never rewrites an administrator's edits.

.PARAMETER InstallDir
    The installation directory of the product being installed ({app}).

.PARAMETER Role
    Which product this is: server or collector. Passed by the installer rather
    than guessed, so the script behaves the same whichever files happen to exist.

.PARAMETER JoinFile
    Optional. A file holding SERVER_URL and/or COLLECTOR_SECRET, applied to every
    collector instance. Lets a collector join a server on ANOTHER machine with no
    prompts: drop collector-join.env beside the setup program. Not consulted when
    the server is installed locally — that server's own secret is authoritative.

.PARAMETER SkipFirewall
    Leave Windows Firewall alone.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $InstallDir,
    [ValidateSet('server', 'collector')][string] $Role = 'server',
    [string] $JoinFile,
    [switch] $SkipFirewall
)

$ErrorActionPreference = 'Stop'

# Inno records each product's location under its AppId; that is how the two
# installations find each other now that they no longer share a directory.
$ServerAppId    = '{7C4E1F2B-93A6-4D51-BE3C-2F7A5D9C81E4}_is1'
$CollectorAppId = '{B1D93E77-4A2C-4F08-9E15-6C8A0D3F52B9}_is1'

$LogFile = Join-Path $InstallDir 'logs\install-config.log'

function Write-Log {
    param([string] $Message)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    try {
        $dir = Split-Path -Parent $LogFile
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {
        # Logging must never fail an installation.
    }
}

# .env files must be UTF-8 with NO byte-order mark. Out-File and Set-Content add
# one in Windows PowerShell, and dotenv would fold it into the first key name
# ("NODE_ENV" preceded by U+FEFF), silently losing that setting.
function Write-EnvFile {
    param([string] $Path, [string[]] $Lines)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, ($Lines -join "`r`n") + "`r`n", $utf8NoBom)
}

# 48 random bytes as base64url — 64 URL-safe characters, no padding.
function New-Secret {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($bytes) -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

# 64 lowercase hex characters — the AES-256-GCM key format the server validates.
function New-HexKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
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
    $result = @()
    $found = $false
    foreach ($line in $Lines) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
            $result += "$Key=$Value"; $found = $true
        } else {
            $result += $line
        }
    }
    if (-not $found) { $result += "$Key=$Value" }
    return $result
}

function Resolve-Placeholders {
    param([string[]] $Lines, [string] $BaseDir = $InstallDir)
    return $Lines | ForEach-Object { $_ -replace '__INSTALLDIR__', $BaseDir.TrimEnd('\') }
}

# Locates the other product's installation from its Inno registry entry. Returns
# $null when it is not installed — the normal case on a dedicated machine.
function Get-OtherInstallDir {
    param([string] $AppId)
    foreach ($hive in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$AppId",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
    )) {
        try {
            $entry = Get-ItemProperty -Path $hive -ErrorAction Stop
            if ($entry.InstallLocation -and (Test-Path $entry.InstallLocation)) {
                return $entry.InstallLocation.TrimEnd('\')
            }
        } catch {
            # Not present in this registry view; try the next.
        }
    }
    return $null
}

# Writes one collector instance's .env and restarts its service if the secret
# changed. A collector left running with a stale secret is rejected 401 on every
# poll and reports nothing wrong except through its own health endpoint.
function Update-CollectorInstance {
    param(
        [System.IO.DirectoryInfo] $Dir,
        [string] $Secret,
        [string] $ServerUrl,
        [string] $BaseDir
    )
    $envPath = Join-Path $Dir.FullName '.env'
    if (-not (Test-Path $envPath)) { return }

    $loopback = '^https?://(127\.0\.0\.1|localhost)(:\d+)?/?$'
    $lines    = Resolve-Placeholders -Lines (Get-Content $envPath) -BaseDir $BaseDir
    $before   = Get-EnvValue -Lines $lines -Key 'COLLECTOR_SECRET'
    $current  = Get-EnvValue -Lines $lines -Key 'SERVER_URL'

    # This collector belongs to a server on another machine: leave its credentials
    # entirely alone. Installing a server here does not make us its owner, and
    # overwriting the secret while keeping the remote URL would point it at a
    # different server holding a credential that server has never seen — a
    # collector that silently stops collecting.
    if (-not [string]::IsNullOrWhiteSpace($ServerUrl) -and
        $ServerUrl -match $loopback -and
        -not [string]::IsNullOrWhiteSpace($current) -and
        $current -notmatch $loopback) {
        Write-EnvFile -Path $envPath -Lines $lines
        Write-Log "$($Dir.Name): left as-is - it is configured against $current, not this machine."
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($Secret)) {
        $lines = Set-EnvValue -Lines $lines -Key 'COLLECTOR_SECRET' -Value $Secret
    }
    if (-not [string]::IsNullOrWhiteSpace($ServerUrl)) {
        $lines = Set-EnvValue -Lines $lines -Key 'SERVER_URL' -Value $ServerUrl
    }

    Write-EnvFile -Path $envPath -Lines $lines

    $after = Get-EnvValue -Lines $lines -Key 'COLLECTOR_SECRET'
    if ([string]::IsNullOrWhiteSpace($after) -or $after -eq 'CHANGE_ME') {
        Write-Log "$($Dir.Name): written, but COLLECTOR_SECRET is UNSET - set SERVER_URL and COLLECTOR_SECRET from the server, then start the service."
        return
    }

    Write-Log "Collector configuration written: $($Dir.Name)"
    if ($before -eq $after) { return }

    $svcName = 'InsightHub' + ($Dir.Name -replace '^collector', 'Collector')
    $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    if (-not $svc -or $svc.Status -ne 'Running') { return }
    try {
        Restart-Service -Name $svcName -Force -ErrorAction Stop
        Write-Log "$svcName restarted to pick up the new secret."
    } catch {
        Write-Log "$svcName could not be restarted automatically - run: net stop $svcName then net start $svcName"
    }
}

function Get-CollectorDirs {
    param([string] $BaseDir)
    return Get-ChildItem (Join-Path $BaseDir 'config') -Directory -Filter 'collector*' -ErrorAction SilentlyContinue
}

Write-Log "Preparing configuration in $InstallDir (role: $Role)"

if ($Role -eq 'server') {

    # ── This product: the server ─────────────────────────────────────────────
    $ServerEnv = Join-Path $InstallDir 'config\server\.env'
    $ClientEnv = Join-Path $InstallDir 'config\client\.env'
    if (-not (Test-Path $ServerEnv)) { throw "Server configuration not found at $ServerEnv" }

    $serverLines = Resolve-Placeholders (Get-Content $ServerEnv)

    $generated = @()
    foreach ($item in @(
        @{ Key = 'JWT_SECRET';          Maker = { New-Secret } },
        @{ Key = 'OIDC_ENCRYPTION_KEY'; Maker = { New-HexKey } },
        @{ Key = 'COLLECTOR_SECRET';    Maker = { New-Secret } }
    )) {
        $current = Get-EnvValue -Lines $serverLines -Key $item.Key
        if ([string]::IsNullOrWhiteSpace($current) -or $current -eq 'CHANGE_ME') {
            $serverLines = Set-EnvValue -Lines $serverLines -Key $item.Key -Value (& $item.Maker)
            $generated += $item.Key
        }
    }

    Write-EnvFile -Path $ServerEnv -Lines $serverLines
    if ($generated.Count -gt 0) {
        Write-Log ('Generated per-machine secrets: {0}' -f ($generated -join ', '))
    } else {
        Write-Log 'All secrets were pinned in the template; none generated.'
    }

    # Served to the browser as window.__INSIGHT_HUB_CONFIG__ - no secrets belong here.
    if (Test-Path $ClientEnv) {
        Write-EnvFile -Path $ClientEnv -Lines (Resolve-Placeholders (Get-Content $ClientEnv))
        Write-Log 'Client configuration written.'
    }

    $secret = Get-EnvValue -Lines $serverLines -Key 'COLLECTOR_SECRET'
    $port   = Get-EnvValue -Lines $serverLines -Key 'PORT'

    # ── The other product: a collector installed separately ──────────────────
    $collectorDir = Get-OtherInstallDir -AppId $CollectorAppId
    if ($collectorDir) {
        Write-Log "Collector installation found at $collectorDir - joining it to this server."
        foreach ($dir in (Get-CollectorDirs -BaseDir $collectorDir)) {
            Update-CollectorInstance -Dir $dir -Secret $secret -ServerUrl "http://127.0.0.1:$port" -BaseDir $collectorDir
        }
    } else {
        Write-Log 'No collector installation on this machine.'
    }

    # ── Firewall ─────────────────────────────────────────────────────────────
    # Only the server accepts inbound connections.
    if (-not $SkipFirewall) {
        if ($port -match '^\d+$') {
            # Delete first: netsh happily creates duplicates under one name, so
            # repeated installs would otherwise pile up stale rules.
            & netsh advfirewall firewall delete rule name="InsightHub" | Out-Null
            & netsh advfirewall firewall add rule name="InsightHub" dir=in action=allow protocol=TCP localport=$port | Out-Null
            Write-Log "Firewall rule set for inbound TCP $port."
        } else {
            Write-Log 'PORT not readable from the configuration - firewall rule skipped.'
        }
    }

} else {

    # ── This product: a collector ────────────────────────────────────────────
    # Preference order for the secret: a server installed on this machine, then a
    # join file beside the setup program, then whatever was packaged. It is never
    # generated - it has to match the server's exactly, and a fabricated value
    # produces a collector that polls, is rejected, and looks healthy.
    $secret    = $null
    $serverUrl = $null

    $serverDir = Get-OtherInstallDir -AppId $ServerAppId
    if ($serverDir) {
        $serverEnv = Join-Path $serverDir 'config\server\.env'
        if (Test-Path $serverEnv) {
            $serverLines = Get-Content $serverEnv
            $secret      = Get-EnvValue -Lines $serverLines -Key 'COLLECTOR_SECRET'
            $port        = Get-EnvValue -Lines $serverLines -Key 'PORT'
            if ($port -match '^\d+$') { $serverUrl = "http://127.0.0.1:$port" }
            Write-Log "Server installation found at $serverDir - adopting its secret and port."
        }
    }

    if (-not $secret -and $JoinFile -and (Test-Path $JoinFile)) {
        $joinLines = Get-Content $JoinFile
        $secret    = Get-EnvValue -Lines $joinLines -Key 'COLLECTOR_SECRET'
        $joinUrl   = Get-EnvValue -Lines $joinLines -Key 'SERVER_URL'
        if ($joinUrl) { $serverUrl = $joinUrl }
        Write-Log "Join file applied: $JoinFile"
    }

    if (-not $secret) {
        Write-Log 'No local server and no usable join file - this collector must be configured by hand.'
    }

    foreach ($dir in (Get-CollectorDirs -BaseDir $InstallDir)) {
        Update-CollectorInstance -Dir $dir -Secret $secret -ServerUrl $serverUrl -BaseDir $InstallDir
    }
}

Write-Log 'Configuration complete.'
exit 0
