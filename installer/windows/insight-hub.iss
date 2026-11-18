; ============================================================================
; Insight Hub — Windows installers (Inno Setup 6.3+)
;
; ONE SOURCE, TWO SETUP PROGRAMS. Compile it twice:
;
;   iscc insight-hub.iss /DEdition=server    -> InsightHub-Server-Setup.exe
;   iscc insight-hub.iss /DEdition=collector -> InsightHub-Collector-Setup.exe
;
; They are separate products with separate AppIds, separate uninstall entries and
; separate services — install either alone, or both on one machine, in any order.
; Everything they share (compression, layout, the config script) lives here once,
; so the two packages cannot drift apart.
;
; Design:
;   * Two questions each: where to install, and — server only — a desktop shortcut.
;     Nothing about databases, collectors, accounts or ports.
;   * Both install into the SAME directory (default C:\Program Files\Email
;     Intelligence) and share config\, logs\ and service\. Uninstalling one leaves
;     the other working: each removes only the files it installed.
;   * Configuration ships as pre-populated .env files that stay editable at
;     <InstallDir>\config\ after installation.
;   * A collector installed beside a server picks up the server's COLLECTOR_SECRET
;     automatically. A collector installed alone gets it from a collector-join.env
;     placed beside the setup program, or is left unconfigured and says so.
;
; Expected next to this script (see README.md):
;   staging\bin\insight-hub-server.exe        (server edition)
;   staging\bin\insight-hub-collector.exe     (collector edition)
;   staging\service\WinSW.exe
;   config\server.env  config\client.env  config\collector.env
;   scripts\finalize-config.ps1  scripts\add-collector.ps1
; ============================================================================

#ifndef Edition
  #define Edition "server"
#endif

#if (Edition != "server") && (Edition != "collector")
  #error Edition must be "server" or "collector"
#endif

#define IsServer (Edition == "server")

#define Company          "RZDigital.net, Inc."
#ifndef AppVersion
  #define AppVersion     "1.0.0"
#endif

#define SvcName          "InsightHub"
#define CollectorSvcName "InsightHubCollector1"
#define ExeName          "insight-hub-server.exe"
#define CollectorExe     "insight-hub-collector.exe"

#if IsServer
  #define AppName        "Insight Hub Server"
  #define AppId          "{7C4E1F2B-93A6-4D51-BE3C-2F7A5D9C81E4}"
  #define OutputName     "InsightHub-Server-Setup"
  #define OtherAppId     "{B1D93E77-4A2C-4F08-9E15-6C8A0D3F52B9}"
#else
  #define AppName        "Insight Hub Collector"
  #define AppId          "{B1D93E77-4A2C-4F08-9E15-6C8A0D3F52B9}"
  #define OutputName     "InsightHub-Collector-Setup"
  #define OtherAppId     "{7C4E1F2B-93A6-4D51-BE3C-2F7A5D9C81E4}"
#endif

[Setup]
AppId={{#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Company}
AppCopyright=Copyright (C) {#Company}
; One product family, one top-level folder — but a directory of its own for each,
; so neither installer ever overwrites the other's files and each uninstaller
; removes only its own tree:
;   C:\Program Files\InsightHub\            server
;   C:\Program Files\InsightHub\Collector\  collector (nested)
;
; Sharing a single directory outright was tried and abandoned: the second
; installer warned that the folder already existed, the two trees interleaved so
; that "whose file is this?" had no visible answer, and each uninstaller had to
; reason about the other's data.
;
; The collector defaults to a Collector\ folder beneath wherever the server is
; actually installed — read from the registry, so a server installed on D:\ keeps
; its collector beside it rather than stranding it under C:\Program Files.
#if IsServer
DefaultDirName={autopf}\InsightHub
#else
DefaultDirName={code:GetCollectorDefaultDir}
#endif
; One Start Menu folder for the family; the uninstall shortcuts are named apart.
DefaultGroupName=Insight Hub
OutputBaseFilename={#OutputName}
OutputDir={#SourcePath}\..\..\release\win
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName={#AppName}
SetupLogging=yes
#if IsServer
UninstallDisplayIcon={app}\bin\{#ExeName}
#else
UninstallDisplayIcon={app}\bin\{#CollectorExe}
#endif

; ── Compression ──────────────────────────────────────────────────────────────
; Each package holds one Node binary, so the dictionary only has to span that.
; Costs a few minutes and ~1 GB of RAM at COMPILE time only; installing is
; unaffected. Halve LZMADictionarySize if the build machine is small.
Compression=lzma2/ultra64
SolidCompression=yes
LZMADictionarySize=131072
LZMANumBlockThreads=4
LZMAUseSeparateProcess=yes
InternalCompressLevel=ultra64

; ── The only questions ───────────────────────────────────────────────────────
DisableWelcomePage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableDirPage=no

#if IsServer
[Tasks]
; Unchecked by default — a server application is usually reached by URL, not from
; the desktop. The collector has no interface, so it offers no shortcut at all.
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
#endif

[Files]
#if IsServer
; ── Server ──────────────────────────────────────────────────────────────────
Source: "{#SourcePath}\staging\bin\{#ExeName}";    DestDir: "{app}\bin";     Flags: ignoreversion
Source: "{#SourcePath}\staging\service\WinSW.exe"; DestDir: "{app}\service"; DestName: "{#SvcName}.exe"; Flags: ignoreversion
; `onlyifdoesntexist` + `uninsneveruninstall` is the whole upgrade story: an
; edited .env is never overwritten by a reinstall, nor deleted by an uninstall.
; The pristine templates install alongside as .env.default for diffing.
Source: "{#SourcePath}\config\server.env"; DestDir: "{app}\config\server"; DestName: ".env"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#SourcePath}\config\client.env"; DestDir: "{app}\config\client"; DestName: ".env"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#SourcePath}\config\server.env"; DestDir: "{app}\config\server"; DestName: ".env.default"; Flags: ignoreversion
Source: "{#SourcePath}\config\client.env"; DestDir: "{app}\config\client"; DestName: ".env.default"; Flags: ignoreversion
#else
; ── Collector ───────────────────────────────────────────────────────────────
Source: "{#SourcePath}\staging\bin\{#CollectorExe}"; DestDir: "{app}\bin";     Flags: ignoreversion
Source: "{#SourcePath}\staging\service\WinSW.exe";   DestDir: "{app}\service"; DestName: "{#CollectorSvcName}.exe"; Flags: ignoreversion
Source: "{#SourcePath}\config\collector.env"; DestDir: "{app}\config\collector1"; DestName: ".env"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#SourcePath}\config\collector.env"; DestDir: "{app}\config\collector1"; DestName: ".env.default"; Flags: ignoreversion
Source: "{#SourcePath}\scripts\add-collector.ps1";    DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#SourcePath}\scripts\remove-collector.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
#endif

; ── Shared ──────────────────────────────────────────────────────────────────
; AfterInstall writes this edition's service definition. It has to happen here,
; during [Files], and NOT in CurStepChanged(ssPostInstall): ssPostInstall fires
; *after* the [Run] entries, so the definition would not exist yet when WinSW is
; asked to install the service. That shipped once — every WinSW call exited -1 and
; the installer still reported success.
Source: "{#SourcePath}\scripts\finalize-config.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion; AfterInstall: WriteServiceDefinition

[Dirs]
; `service-modify` keeps these writable even if the services are later re-pointed
; at a non-SYSTEM account.
Name: "{app}\config"; Permissions: service-modify
Name: "{app}\logs";   Permissions: service-modify
Name: "{app}\data";   Permissions: service-modify
#if IsServer
Name: "{app}\data\uploads"; Permissions: service-modify
Name: "{app}\data\backups"; Permissions: service-modify
Name: "{app}\data\temp";    Permissions: service-modify
#else
; The collector streams what it fetches and persists nothing, so this is scratch
; space only — present for a consistent layout, and used if a future job needs to
; spool a large attachment to disk rather than hold it in memory.
Name: "{app}\data\temp";    Permissions: service-modify
#endif

[Icons]
#if IsServer
Name: "{group}\Open Insight Hub"; Filename: "http://localhost:{code:GetConfiguredPort}"
Name: "{group}\Edit server configuration"; Filename: "{win}\notepad.exe"; Parameters: """{app}\config\server\.env"""
Name: "{autodesktop}\Insight Hub"; Filename: "http://localhost:{code:GetConfiguredPort}"; Tasks: desktopicon
#else
Name: "{group}\Edit collector configuration"; Filename: "{win}\notepad.exe"; Parameters: """{app}\config\collector1\.env"""
#endif
; Named per edition so the two uninstall shortcuts never collide.
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; Configuration is finalised before the service starts.
;
; -JoinFile lets a collector installed WITHOUT a local server pick up SERVER_URL
; and COLLECTOR_SECRET from a file beside the setup program, so mass deployment
; stays promptless. It is ignored when a local server config exists — that
; machine's own secret is authoritative.
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\finalize-config.ps1"" -InstallDir ""{app}"" -Role {#Edition} -JoinFile ""{src}\collector-join.env"""; \
  StatusMsg: "Preparing configuration..."; Flags: runhidden waituntilterminated

#if IsServer
Filename: "{app}\service\{#SvcName}.exe"; Parameters: "install"; \
  StatusMsg: "Registering the Insight Hub service..."; Flags: runhidden waituntilterminated
Filename: "{app}\service\{#SvcName}.exe"; Parameters: "start"; \
  StatusMsg: "Starting Insight Hub..."; Flags: runhidden waituntilterminated
Filename: "http://localhost:{code:GetConfiguredPort}"; Description: "Open Insight Hub in your browser"; \
  Flags: postinstall shellexec nowait skipifsilent
#else
Filename: "{app}\service\{#CollectorSvcName}.exe"; Parameters: "install"; \
  StatusMsg: "Registering the collector service..."; Flags: runhidden waituntilterminated
Filename: "{app}\service\{#CollectorSvcName}.exe"; Parameters: "start"; \
  StatusMsg: "Starting the collector..."; Flags: runhidden waituntilterminated
#endif

[UninstallRun]
; Each edition removes only its own services.
#if IsServer
Filename: "{app}\service\{#SvcName}.exe"; Parameters: "stop";      Flags: runhidden skipifdoesntexist; RunOnceId: "svcstop"
Filename: "{app}\service\{#SvcName}.exe"; Parameters: "uninstall"; Flags: runhidden skipifdoesntexist; RunOnceId: "svcremove"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""InsightHub"""; Flags: runhidden; RunOnceId: "fw"
#else
Filename: "{app}\service\{#CollectorSvcName}.exe"; Parameters: "stop";      Flags: runhidden skipifdoesntexist; RunOnceId: "colstop"
Filename: "{app}\service\{#CollectorSvcName}.exe"; Parameters: "uninstall"; Flags: runhidden skipifdoesntexist; RunOnceId: "colremove"
#endif

; ============================================================================
[Code]

{ Reads PORT from the installed server .env so shortcuts follow an edited
  configuration. Falls back to 8080, which is also what the shipped template says
  — shortcuts are created before the configuration script runs. }
function GetConfiguredPort(Param: string): string;
var
  Lines: TArrayOfString;
  I: Integer;
  Line: string;
begin
  Result := '8080';
  if not LoadStringsFromFile(ExpandConstant('{app}\config\server\.env'), Lines) then Exit;

  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if Copy(Line, 1, 5) = 'PORT=' then
    begin
      Result := Trim(Copy(Line, 6, Length(Line)));
      Exit;
    end;
  end;
end;

{ Reads the other product's installation directory from its Inno registry entry.
  Returns '' when it is not installed. Both registry views are tried: a 32-bit
  helper writing the key would land it under WOW6432Node. }
function FindOtherInstallDir: string;
var
  Key, Value: string;
begin
  Result := '';
  Key := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{#OtherAppId}_is1';

  if not RegQueryStringValue(HKLM64, Key, 'InstallLocation', Value) then
    if not RegQueryStringValue(HKLM32, Key, 'InstallLocation', Value) then
      Exit;

  Value := RemoveBackslashUnlessRoot(Trim(Value));
  if (Value <> '') and DirExists(Value) then Result := Value;
end;

#if !IsServer
{ Puts the collector inside the server's own folder when the server is installed,
  wherever that turned out to be, and under the conventional path otherwise. The
  operator can still change it on the directory page. }
function GetCollectorDefaultDir(Param: string): string;
var
  ServerDir: string;
begin
  ServerDir := FindOtherInstallDir;
  if ServerDir <> '' then
    Result := ServerDir + '\Collector'
  else
    Result := ExpandConstant('{autopf}\InsightHub\Collector');
end;
#endif

{ True when the named service exists in the SCM. }
function ServiceExists(const Name: string): Boolean;
var
  RC: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\sc.exe'), 'query "' + Name + '"', '',
                 SW_HIDE, ewWaitUntilTerminated, RC) and (RC = 0);
end;

{ Stops and deregisters the services this edition owns — and only those. Windows
  will not let [Files] replace a running executable, so this runs before an
  upgrade; it must never touch the other product's services. }
procedure StopOwnServices;
var
  ServiceDir: string;
  RC: Integer;
#if !IsServer
  Pattern: string;
  FindRec: TFindRec;
#endif
begin
  ServiceDir := ExpandConstant('{app}\service\');

#if IsServer
  if FileExists(ServiceDir + '{#SvcName}.exe') then
  begin
    Exec(ServiceDir + '{#SvcName}.exe', 'stop', '', SW_HIDE, ewWaitUntilTerminated, RC);
    Exec(ServiceDir + '{#SvcName}.exe', 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;
#else
  { Every collector instance, including any added later by add-collector.ps1. }
  Pattern := ServiceDir + 'InsightHubCollector*.exe';
  if FindFirst(Pattern, FindRec) then
  begin
    try
      repeat
        Exec(ServiceDir + FindRec.Name, 'stop', '', SW_HIDE, ewWaitUntilTerminated, RC);
        Exec(ServiceDir + FindRec.Name, 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, RC);
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
#endif
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  NeedsRestart := False;

#if IsServer
  if FileExists(ExpandConstant('{app}\bin\{#ExeName}')) then
#else
  if FileExists(ExpandConstant('{app}\bin\{#CollectorExe}')) then
#endif
  begin
    WizardForm.StatusLabel.Caption := 'Stopping existing services...';
    StopOwnServices;
    { Let the SCM release the binaries before [Files] replaces them. }
    Sleep(2000);
  end;
end;

{ Writes this edition's WinSW service definition. Generated rather than shipped
  because it embeds the installation directory the operator chose. Written as
  UTF-8 rather than through SaveStringToFile, which encodes in the machine's ANSI
  codepage and would corrupt a non-ASCII installation path. }
procedure WriteServiceDefinition;
var
  Lines: TArrayOfString;
begin
#if IsServer
  SetArrayLength(Lines, 13);
  Lines[0]  := '<service>';
  Lines[1]  := '  <id>{#SvcName}</id>';
  Lines[2]  := '  <name>Insight Hub</name>';
  Lines[3]  := '  <description>Insight Hub server (REST API and web interface)</description>';
  Lines[4]  := '  <executable>' + ExpandConstant('{app}\bin\{#ExeName}') + '</executable>';
  Lines[5]  := '  <arguments>serve</arguments>';
  Lines[6]  := '  <workingdirectory>' + ExpandConstant('{app}\bin') + '</workingdirectory>';
  Lines[7]  := '  <env name="INSIGHT_HUB_CONFIG_DIR" value="' + ExpandConstant('{app}\config\server') + '"/>';
  { Makes config\client\.env reachable by the browser as window.__INSIGHT_HUB_CONFIG__. }
  Lines[8]  := '  <env name="INSIGHT_HUB_CLIENT_CONFIG" value="' + ExpandConstant('{app}\config\client\.env') + '"/>';
  Lines[9]  := '  <onfailure action="restart" delay="5 sec"/>';
  Lines[10] := '  <log mode="roll"/>';
  Lines[11] := '  <logpath>' + ExpandConstant('{app}\logs') + '</logpath>';
  Lines[12] := '</service>';
  SaveStringsToUTF8File(ExpandConstant('{app}\service\{#SvcName}.xml'), Lines, False);
#else
  SetArrayLength(Lines, 11);
  Lines[0]  := '<service>';
  Lines[1]  := '  <id>{#CollectorSvcName}</id>';
  Lines[2]  := '  <name>Insight Hub Collector 1</name>';
  Lines[3]  := '  <description>Insight Hub collector instance 1 (mailbox ingestion)</description>';
  Lines[4]  := '  <executable>' + ExpandConstant('{app}\bin\{#CollectorExe}') + '</executable>';
  Lines[5]  := '  <workingdirectory>' + ExpandConstant('{app}\bin') + '</workingdirectory>';
  Lines[6]  := '  <env name="INSIGHT_HUB_CONFIG_DIR" value="' + ExpandConstant('{app}\config\collector1') + '"/>';
  Lines[7]  := '  <onfailure action="restart" delay="5 sec"/>';
  Lines[8]  := '  <log mode="roll"/>';
  Lines[9]  := '  <logpath>' + ExpandConstant('{app}\logs') + '</logpath>';
  Lines[10] := '</service>';
  SaveStringsToUTF8File(ExpandConstant('{app}\service\{#CollectorSvcName}.xml'), Lines, False);
#endif
end;

{ The [Run] entries are `runhidden` and their exit codes are discarded, so a failed
  registration used to end in a "completed successfully" page over a dead install.
  Say so instead — the operator can fix it in a minute, but only if they know. }
procedure VerifyService;
#if IsServer
  #define ThisSvc SvcName
#else
  #define ThisSvc CollectorSvcName
#endif
begin
  if ServiceExists('{#ThisSvc}') then Exit;

  MsgBox('Setup could not register the Windows service {#ThisSvc}.' + #13#10 + #13#10 +
         'The files are installed correctly. To finish, open PowerShell as ' +
         'Administrator and run:' + #13#10 + #13#10 +
         '  cd "' + ExpandConstant('{app}') + '\service"' + #13#10 +
         '  .\{#ThisSvc}.exe install' + #13#10 +
         '  .\{#ThisSvc}.exe start' + #13#10 + #13#10 +
         'Details are in the setup log and in ' + ExpandConstant('{app}') + '\logs.',
         mbError, MB_OK);
end;

#if !IsServer
{ A collector with no server on the same machine cannot invent COLLECTOR_SECRET —
  it has to match the server's exactly. finalize-config.ps1 leaves it unresolved
  and records the fact; saying nothing here would ship a service that polls, is
  rejected, and looks fine. }
procedure WarnIfUnconfigured;
var
  Lines: TArrayOfString;
  I: Integer;
begin
  if not LoadStringsFromFile(ExpandConstant('{app}\config\collector1\.env'), Lines) then Exit;

  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos('COLLECTOR_SECRET=CHANGE_ME', Trim(Lines[I])) = 1 then
    begin
      MsgBox('The collector is installed but not yet connected to a server.' + #13#10 + #13#10 +
             'Open this file as Administrator:' + #13#10 +
             '  ' + ExpandConstant('{app}') + '\config\collector1\.env' + #13#10 + #13#10 +
             'Set SERVER_URL to the server''s address, and copy COLLECTOR_SECRET ' +
             'from the server''s config\server\.env — the two must match exactly. ' +
             'Then start the service:' + #13#10 + #13#10 +
             '  net start {#CollectorSvcName}' + #13#10 + #13#10 +
             'To skip this step on other machines, put a collector-join.env file ' +
             'holding those two values next to this setup program.',
             mbInformation, MB_OK);
      Exit;
    end;
end;
#endif

#if IsServer
{ A registered, started service is not the same as a working product. The server
  exits when it cannot reach PostgreSQL, so with a DATABASE_URL that does not fit
  the customer's database the install "succeeds" and the web interface simply
  never answers — which is exactly how the first real installation went. The
  binary already knows how to wait for itself, so ask it. }
procedure VerifyServerResponds;
var
  Port: string;
  RC: Integer;
begin
  if not ServiceExists('{#SvcName}') then Exit;  { already reported }

  Port := GetConfiguredPort('');
  WizardForm.StatusLabel.Caption := 'Waiting for Insight Hub to answer...';

  if Exec(ExpandConstant('{app}\bin\{#ExeName}'),
          'health --port ' + Port + ' --timeout 45', '',
          SW_HIDE, ewWaitUntilTerminated, RC) and (RC = 0) then Exit;

  MsgBox('Insight Hub was installed and its service started, but the ' +
         'server is not answering on port ' + Port + '.' + #13#10 + #13#10 +
         'By far the most common cause is DATABASE_URL: the server exits when it ' +
         'cannot reach PostgreSQL. Open' + #13#10 + #13#10 +
         '  ' + ExpandConstant('{app}') + '\config\server\.env' + #13#10 + #13#10 +
         'as Administrator, correct DATABASE_URL, then restart the service:' + #13#10 + #13#10 +
         '  net stop {#SvcName} & net start {#SvcName}' + #13#10 + #13#10 +
         'The exact error is in ' + ExpandConstant('{app}') + '\logs\{#SvcName}.err.log.',
         mbError, MB_OK);
end;
#endif

procedure CurStepChanged(CurStep: TSetupStep);
begin
  { Runs after the [Run] entries — which is precisely why the service definition
    is NOT written here. Report on what those entries achieved. }
  if CurStep = ssPostInstall then
  begin
    VerifyService;
#if IsServer
    VerifyServerResponds;
#else
    WarnIfUnconfigured;
#endif
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Question: string;
begin
  if CurUninstallStep = usUninstall then
  begin
    StopOwnServices;
    Exit;
  end;

  if CurUninstallStep <> usPostUninstall then Exit;

  { Each edition offers to remove only its own configuration and data, so
    uninstalling one product never deletes the other's. }
#if IsServer
  if not DirExists(ExpandConstant('{app}\config\server')) and
     not DirExists(ExpandConstant('{app}\data')) then Exit;
  Question := 'Also delete the server configuration, uploads, backups and logs?';
#else
  if not DirExists(ExpandConstant('{app}\config')) then Exit;
  Question := 'Also delete the collector configuration and logs?' + #13#10 +
              '(This includes any extra instances added with add-collector.ps1.)';
#endif

  if MsgBox(Question + #13#10 + #13#10 +
            'Choose No to keep it (recommended if you plan to reinstall).' + #13#10 +
            'Your PostgreSQL database is not affected either way.',
            mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES then Exit;

#if IsServer
  DelTree(ExpandConstant('{app}\config\server'), True, True, True);
  DelTree(ExpandConstant('{app}\config\client'), True, True, True);
  DelTree(ExpandConstant('{app}\data'), True, True, True);
  DelTree(ExpandConstant('{app}\logs'), True, True, True);
#else
  // The app dir is the collector's own dedicated tree, so clear the whole of it.
  // Deleting only collector1 stranded the config of every instance added later by
  // add-collector.ps1, whose services StopOwnServices had already removed.
  // (Line comments, not braces: an Inno brace comment ends at the first '}', so a
  //  constant like the app-path placeholder inside one terminates it early.)
  DelTree(ExpandConstant('{app}\config'), True, True, True);
  DelTree(ExpandConstant('{app}\data'), True, True, True);
  DelTree(ExpandConstant('{app}\logs'), True, True, True);
#endif
end;
