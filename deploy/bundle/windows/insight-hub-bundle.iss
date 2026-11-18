; ============================================================================
; Insight Hub — Windows self-contained container installer.
;
; The Windows counterpart of insight-hub-<version>.run: the same payload
; (images, compose file, config template) wrapped in a setup .exe instead of a
; self-extracting shell script.
;
; Compiled by deploy/bundle/build-bundle.ps1, which stages the payload first:
;
;   iscc /DAppVersion=1.0.0 /DPayloadDir=..\..\..\build\payload ^
;        deploy\bundle\windows\insight-hub-bundle.iss
;
; This installer is SEPARATE from installer/windows/insight-hub.iss.
; That one installs the native Node binaries; this one installs the container
; stack. They use different AppIds so neither can upgrade or uninstall the other.
; ============================================================================

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Role
  #define Role "server"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\..\..\build\payload\" + Role
#endif

#define IsServer (Role == "server")
#define IsCollector (Role == "collector")
#define IsRag (Role == "rag")
#define Company  "RZDigital.net, Inc."

; Separate AppIds per role, so each uninstaller removes only its own tree and
; neither installer can upgrade the other — the same split the native packages
; use. Both live under one Start Menu folder.
#if IsServer
  #define AppName    "Insight Hub Server"
  #define AppId      "{D7F3A812-5E64-4C9B-A0D2-3B8E17F4C6A5}"
  #define OutputName "InsightHub-Server-Setup-" + AppVersion
  #define SvcName    "InsightHubServer"
#elif IsCollector
  #define AppName    "Insight Hub Collector"
  #define AppId      "{9A4B2C81-6F35-4E7D-B0C9-1D8E5A3F72B6}"
  #define OutputName "InsightHub-Collector-Setup-" + AppVersion
  #define SvcName    "InsightHubCollector"
#else
  #define AppName    "Insight Hub RAG"
  #define AppId      "{4F77D8A1-93C6-4F21-AB72-51C8E4D9026B}"
  #define OutputName "InsightHub-RAG-Setup-" + AppVersion
  #define SvcName    "InsightHubRAG"
#endif

[Setup]
AppId={{#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Company}
AppCopyright=Copyright (C) {#Company}
; One product family, one Start Menu folder — but a directory each, so neither
; installer overwrites the other's files and each uninstaller removes only its own.
#if IsServer
DefaultDirName={autopf}\InsightHub
#elif IsCollector
DefaultDirName={autopf}\InsightHub\Collector
#else
DefaultDirName={autopf}\InsightHub\RAG
#endif
DefaultGroupName=Insight Hub
OutputBaseFilename={#OutputName}
OutputDir={#SourcePath}\..\..\..\release\win
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName={#AppName}
SetupLogging=yes

; ── Compression ──────────────────────────────────────────────────────────────
; Deliberately NOT lzma2/ultra64 like the native installer. The payload is ~8 GB
; of already-gzipped image tarballs; recompressing them gains almost nothing and
; costs hours of compile time plus gigabytes of RAM. The [Files] entry for
; images\ carries `nocompression` for the same reason; everything else is small
; enough that the default is fine.
Compression=lzma2/fast
SolidCompression=no

; Payloads above 2 GB need this — without it, compilation fails on the image set.
DiskSpanning=no
UsePreviousAppDir=yes

DisableWelcomePage=no
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableDirPage=no

[Files]
; Images: already compressed, and the bulk of the package.
Source: "{#PayloadDir}\images\*"; DestDir: "{app}\images"; \
    Flags: nocompression ignoreversion recursesubdirs

; Topology and configuration template.
Source: "{#PayloadDir}\compose\docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\config\.env.template";       DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\MANIFEST";                   DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\SHA256SUMS";                 DestDir: "{app}"; Flags: ignoreversion

; Installer logic, kept on disk so a repair or a support engineer can re-run it.
Source: "{#SourcePath}\install.ps1";   DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#SourcePath}\uninstall.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

; WinSW wrapper — supervises a foreground `docker compose up`.
Source: "{#PayloadDir}\service\WinSW.exe"; DestDir: "{app}\service"; \
    DestName: "{#SvcName}.exe"; Flags: ignoreversion

[Dirs]
Name: "{app}\service"; Permissions: service-modify
Name: "{commonappdata}\InsightHub";                Permissions: service-modify
Name: "{commonappdata}\InsightHub\{#Role}";        Permissions: service-modify
Name: "{commonappdata}\InsightHub\{#Role}\config"; Permissions: service-modify
Name: "{commonappdata}\InsightHub\{#Role}\logs";   Permissions: service-modify

[Icons]
#if IsServer
Name: "{group}\Open Insight Hub"; Filename: "http://localhost:{code:GetPort}"
Name: "{group}\Edit server configuration"; Filename: "{win}\notepad.exe"; \
    Parameters: """{commonappdata}\InsightHub\server\config\.env"""
Name: "{group}\View server logs"; Filename: "{commonappdata}\InsightHub\server\logs"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
#elif IsCollector
Name: "{group}\Edit collector configuration"; Filename: "{win}\notepad.exe"; \
    Parameters: """{commonappdata}\InsightHub\collector\config\.env"""
Name: "{group}\View collector logs"; Filename: "{commonappdata}\InsightHub\collector\logs"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
#else
Name: "{group}\Edit RAG configuration"; Filename: "{win}\notepad.exe"; \
    Parameters: """{commonappdata}\InsightHub\rag\config\.env"""
Name: "{group}\View RAG logs"; Filename: "{commonappdata}\InsightHub\rag\logs"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
#endif

[Run]
; Everything real happens here. Loading images and bringing the stack up takes
; minutes, so the wizard shows progress and waits.
#if IsServer
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -Role server -InstallDir ""{app}"" -Port {code:GetPort}"; \
    StatusMsg: "Loading images and starting services (several minutes)..."; \
    Flags: waituntilterminated

Filename: "http://localhost:{code:GetPort}"; \
    Description: "Open Insight Hub in your browser"; \
    Flags: postinstall shellexec nowait skipifsilent
#elif IsCollector
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -Role collector -InstallDir ""{app}"" -ServerUrl ""{code:GetServerUrl}"" -CollectorSecret ""{code:GetSecret}"""; \
    StatusMsg: "Loading images and starting the collector..."; \
    Flags: waituntilterminated
#else
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -Role rag -InstallDir ""{app}"" -ServerUrl ""{code:GetServerUrl}"" -PostgresUrl ""{code:GetPostgresUrl}"" -RagSecret ""{code:GetSecret}"" -RagPort {code:GetPort}"; \
    StatusMsg: "Loading AI images and starting RAG (up to 30 minutes)..."; \
    Flags: waituntilterminated
#endif

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Role {#Role} -InstallDir ""{app}"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "eiuninstall"

[Code]
var
  InputPage: TInputQueryWizardPage;

{ Server asks for its port. Collector asks for server URL and shared secret.
  RAG additionally needs the authoritative PostgreSQL URL and its API port. }
procedure InitializeWizard;
begin
#if IsServer
  InputPage := CreateInputQueryPage(wpSelectDir,
    'Web interface port',
    'Which port should Insight Hub listen on?',
    'The web interface and API share one port. Leave 8080 unless it is already in use.');
  InputPage.Add('Port:', False);
  InputPage.Values[0] := '8080';
#elif IsCollector
  InputPage := CreateInputQueryPage(wpSelectDir,
    'Server connection',
    'Which Insight Hub server should this collector serve?',
    'Copy COLLECTOR_SECRET from the server machine: ' +
    'C:\ProgramData\InsightHub\server\config\.env');
  InputPage.Add('Server URL:', False);
  InputPage.Add('Collector secret:', True);
  InputPage.Values[0] := 'http://';
#else
  InputPage := CreateInputQueryPage(wpSelectDir,
    'RAG connections',
    'Connect RAG to the authoritative Insight Hub services',
    'The PostgreSQL URL must be reachable from Docker. The RAG secret must ' +
    'match RAG_INTERNAL_SECRET in the Core Server configuration.');
  InputPage.Add('Core Server URL:', False);
  InputPage.Add('PostgreSQL URL:', True);
  InputPage.Add('RAG shared secret:', True);
  InputPage.Add('RAG API port:', False);
  InputPage.Values[0] := 'http://';
  InputPage.Values[1] := 'postgresql+psycopg2://';
  InputPage.Values[3] := '8000';
#endif
end;

function GetPort(Param: string): string;
begin
  Result := '8080';
#if IsServer
  if InputPage <> nil then Result := Trim(InputPage.Values[0]);
  if Result = '' then Result := '8080';
#elif IsRag
  if InputPage <> nil then Result := Trim(InputPage.Values[3]);
  if Result = '' then Result := '8000';
#endif
end;

function GetServerUrl(Param: string): string;
begin
  Result := '';
#if IsCollector || IsRag
  if InputPage <> nil then Result := Trim(InputPage.Values[0]);
#endif
end;

function GetSecret(Param: string): string;
begin
  Result := '';
#if IsCollector
  if InputPage <> nil then Result := Trim(InputPage.Values[1]);
#elif IsRag
  if InputPage <> nil then Result := Trim(InputPage.Values[2]);
#endif
end;

function GetPostgresUrl(Param: string): string;
begin
  Result := '';
#if IsRag
  if InputPage <> nil then Result := Trim(InputPage.Values[1]);
#endif
end;

function NextButtonClick(CurPageID: Integer): Boolean;
#if IsServer || IsRag
var
  Port: Integer;
#endif
begin
  Result := True;
  if (InputPage = nil) or (CurPageID <> InputPage.ID) then Exit;

#if IsServer
  Port := StrToIntDef(GetPort(''), -1);
  if (Port < 1) or (Port > 65535) then
  begin
    MsgBox('Enter a port between 1 and 65535.', mbError, MB_OK);
    Result := False;
  end;
#elif IsCollector
  if (GetServerUrl('') = '') or (GetServerUrl('') = 'http://') then
  begin
    MsgBox('Enter the server URL, for example http://insight-hub-server:8080', mbError, MB_OK);
    Result := False;
  end
  else if GetSecret('') = '' then
  begin
    MsgBox('Enter the collector secret. Without a matching value every poll is ' +
           'rejected and no mail is collected.', mbError, MB_OK);
    Result := False;
  end;
#else
  Port := StrToIntDef(GetPort(''), -1);
  if (Port < 1) or (Port > 65535) then
  begin
    MsgBox('Enter a RAG API port between 1 and 65535.', mbError, MB_OK);
    Result := False;
  end
  else if (GetServerUrl('') = '') or (GetServerUrl('') = 'http://') then
  begin
    MsgBox('Enter the Core Server URL.', mbError, MB_OK);
    Result := False;
  end
  else if (GetPostgresUrl('') = '') or
          (GetPostgresUrl('') = 'postgresql+psycopg2://') then
  begin
    MsgBox('Enter the PostgreSQL URL used by the Core Server.', mbError, MB_OK);
    Result := False;
  end
  else if GetSecret('') = '' then
  begin
    MsgBox('Enter the RAG shared secret. It must match RAG_INTERNAL_SECRET in ' +
           'the Core Server configuration.', mbError, MB_OK);
    Result := False;
  end;
#endif
end;

{ Docker cannot be installed silently from here — it needs WSL2 and a reboot on
  most machines. Detect it early and let the operator decide, rather than
  failing after unpacking 8 GB. }
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not Exec('cmd.exe', '/C where docker >nul 2>&1', '', SW_HIDE,
              ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    Result := MsgBox(
      'Docker was not found on this machine.' + #13#10#13#10 +
      'Insight Hub runs as Linux containers, which requires WSL2 and a ' +
      'container runtime:' + #13#10#13#10 +
      '  1. Run:  wsl --install    (reboot when prompted)' + #13#10 +
      '  2. Install Docker Desktop, or Docker Engine inside WSL2' + #13#10#13#10 +
      'You can continue and install the files now, but the services will not ' +
      'start until Docker is available.' + #13#10#13#10 +
      'Continue anyway?',
      mbConfirmation, MB_YESNO) = IDYES;
  end;
end;
