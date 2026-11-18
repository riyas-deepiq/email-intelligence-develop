<#
.SYNOPSIS
    Insight Hub — Windows uninstall helper.

.DESCRIPTION
    Called from the Inno uninstaller's [UninstallRun] section. Stops and removes
    this role's service, its containers and its application image, plus any
    firewall rule owned by that role.

    Customer data is NOT removed by default. ProgramData holds the mail store,
    users and audit trail; deleting that silently during an uninstall would be
    unrecoverable, so it takes an explicit -RemoveData.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [ValidateSet('server', 'collector', 'rag')] [string] $Role,
    [Parameter(Mandatory = $true)] [string] $InstallDir,
    [string] $DataRoot = "$env:ProgramData\InsightHub",
    [switch] $RemoveData
)

$ErrorActionPreference = 'Continue'   # an uninstall must not stop at the first failure

if ($Role -eq 'server')        { $ServiceName = 'InsightHubServer' }
elseif ($Role -eq 'collector') { $ServiceName = 'InsightHubCollector' }
else                           { $ServiceName = 'InsightHubRAG' }

$Project     = "insight-hub-$Role"
$serviceExe  = Join-Path $InstallDir "service\$ServiceName.exe"
$composeFile = Join-Path $InstallDir 'docker-compose.yml'
$roleRoot    = Join-Path $DataRoot $Role
$envFile     = Join-Path $roleRoot 'config\.env'

Write-Host "==> Stopping the $Role service"
if (Test-Path $serviceExe) {
    & $serviceExe stop      2>&1 | Out-Null
    & $serviceExe uninstall 2>&1 | Out-Null
}

# Belt and braces: if WinSW never registered, containers may still be running.
if ((Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path $composeFile)) {
    Write-Host '==> Removing containers'
    if (Test-Path $envFile) {
        docker compose -p $Project --env-file $envFile -f $composeFile down 2>&1 | Out-Null
    } else {
        docker compose -p $Project -f $composeFile down 2>&1 | Out-Null
    }

    Write-Host '==> Removing images'
    $ids = docker images --filter "reference=insight-hub/$Role" --format '{{.ID}}' 2>$null
    foreach ($id in $ids) { docker rmi -f $id 2>&1 | Out-Null }

    # Stock images (postgres, redis) are deliberately left alone: they are shared
    # and the other role — or another application on this host — may be using them.
}

if ($Role -eq 'server') {
    Write-Host '==> Removing the firewall rule'
    netsh advfirewall firewall delete rule name="InsightHub" 2>&1 | Out-Null
}
if ($Role -eq 'rag') {
    Write-Host '==> Removing the RAG firewall rule'
    netsh advfirewall firewall delete rule name="InsightHub RAG" 2>&1 | Out-Null
}

if ($RemoveData) {
    Write-Host "==> Removing data and configuration for the $Role role" -ForegroundColor Yellow
    Remove-Item -Recurse -Force -Path $roleRoot -ErrorAction SilentlyContinue
} else {
    Write-Host ''
    Write-Host '  Data and configuration were kept at:' -ForegroundColor Yellow
    Write-Host "    $roleRoot"
    if ($Role -eq 'server') {
        Write-Host '  That folder holds the mail store, users and audit trail. Delete it'
        Write-Host '  manually only if this system is being decommissioned.'
    }
    Write-Host ''
}
