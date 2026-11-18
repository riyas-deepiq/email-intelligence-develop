<#
.SYNOPSIS
    Removes a collector instance added by add-collector.ps1.

.DESCRIPTION
    Undoes exactly what add-collector.ps1 created, in the order that avoids
    leaving a half-removed instance behind:

      1. stops the Windows service
      2. deregisters it
      3. deletes the WinSW wrapper and its .xml
      4. deletes config\collector<N>\   (unless -KeepConfig)

    Instance 1 is refused: it belongs to the installer, so removing it here would
    leave the product installed with nothing to run. Uninstall the collector
    product from Apps & Features instead — that removes every instance, including
    ones added later by add-collector.ps1.

    Nothing on the server needs changing. Jobs claimed by a removed instance are
    swept back to pending once its heartbeat goes silent, so in-flight work is
    picked up by another collector rather than lost.

    Run elevated, from the installation's scripts folder.

.PARAMETER Instance
    Instance number to remove, 2 or higher.

.PARAMETER InstallDir
    Installation directory. Defaults to the parent of this script's folder.

.PARAMETER KeepConfig
    Leave config\collector<N>\ in place — useful when removing an instance
    temporarily, since re-adding it later will overwrite the file anyway.

.EXAMPLE
    .\remove-collector.ps1 -Instance 2
.EXAMPLE
    .\remove-collector.ps1 -Instance 3 -KeepConfig
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(2, 99)][int] $Instance,
    [string] $InstallDir,
    [switch] $KeepConfig
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }

$ServiceName = "InsightHubCollector$Instance"
$ServiceDir  = Join-Path $InstallDir 'service'
$ServiceExe  = Join-Path $ServiceDir "$ServiceName.exe"
$ServiceXml  = Join-Path $ServiceDir "$ServiceName.xml"
$ConfigDir   = Join-Path $InstallDir "config\collector$Instance"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated PowerShell — it deregisters a Windows service.'
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service -and -not (Test-Path $ConfigDir)) {
    Write-Host "Nothing to remove: $ServiceName is not installed and $ConfigDir does not exist."
    exit 0
}

# ── Service ──────────────────────────────────────────────────────────────────
if ($service) {
    if ($service.Status -ne 'Stopped') {
        Write-Host "Stopping $ServiceName..."
        # A collector finishes the mailbox it is holding before exiting, so give
        # it a moment rather than killing it mid-batch.
        try {
            Stop-Service -Name $ServiceName -Force -ErrorAction Stop
            $service.WaitForStatus('Stopped', '00:00:30')
        } catch {
            Write-Warning "Could not stop $ServiceName cleanly: $($_.Exception.Message)"
        }
    }

    if (Test-Path $ServiceExe) {
        & $ServiceExe uninstall | Out-Null
    } else {
        # Wrapper already gone — fall back to the SCM directly.
        & "$env:SystemRoot\System32\sc.exe" delete $ServiceName | Out-Null
    }
    Write-Host "Service $ServiceName removed."
} else {
    Write-Host "Service $ServiceName was not registered."
}

# ── Files ────────────────────────────────────────────────────────────────────
foreach ($path in @($ServiceExe, $ServiceXml)) {
    if (Test-Path $path) { Remove-Item $path -Force; Write-Host "Deleted $path" }
}

if ($KeepConfig) {
    Write-Host "Kept $ConfigDir (-KeepConfig)."
} elseif (Test-Path $ConfigDir) {
    Remove-Item $ConfigDir -Recurse -Force
    Write-Host "Deleted $ConfigDir"
}

# ── Confirm ──────────────────────────────────────────────────────────────────
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Warning ("$ServiceName still appears in the service list. Windows keeps a deleted " +
                   'service until every handle to it closes - close services.msc and Task ' +
                   'Manager, or reboot.')
} else {
    Write-Host "Collector instance $Instance removed." -ForegroundColor Green
}

Write-Host "Remaining collector services:"
Get-Service -Name 'InsightHubCollector*' -ErrorAction SilentlyContinue |
    Select-Object Name, Status | Format-Table -AutoSize
