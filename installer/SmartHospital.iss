; Smart Hospital — Windows setup (Inno Setup 6). Built by scripts/build-windows.mjs:
;   ISCC /DAppVersion=0.1.0 /DControlUrl=https://control.example.com /DStageDir=..\dist\windows\stage SmartHospital.iss
;
; Two kinds of install:
;   Server      — one PC per hospital: the app, its own database and the services that start them at boot.
;                 Works offline; checks the licence and uploads data to ControlUrl when online.
;   Workstation — other staff PCs: only a desktop shortcut that opens the hospital's server.

#define AppName "Smart Hospital"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef ControlUrl
  #define ControlUrl ""
#endif
#ifndef StageDir
  #define StageDir "..\dist\windows\stage"
#endif
#ifndef Publisher
  #define Publisher "Smart Hospital"
#endif

[Setup]
AppId={{7C3E2B7A-5B0D-4E59-9F4C-6A1D2F5E8B11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={autopf}\Smart Hospital
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=SmartHospital-Setup-{#AppVersion}
SetupIconFile={#StageDir}\bin\app.ico
UninstallDisplayIcon={app}\bin\app.ico
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
MinVersion=10.0

[Types]
Name: "server"; Description: "Server — this PC keeps the hospital's data (install on one PC only)"
Name: "workstation"; Description: "Workstation — open the hospital's server from this PC"

[Components]
Name: "server"; Description: "Smart Hospital server and database"; Types: server; Flags: fixed
Name: "client"; Description: "Desktop shortcut"; Types: server workstation; Flags: fixed

[Files]
Source: "{#StageDir}\bin\open-app.vbs"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "{#StageDir}\bin\app.ico"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "{#StageDir}\bin\*.cmd"; DestDir: "{app}\bin"; Components: server; Flags: ignoreversion
Source: "{#StageDir}\bin\configure.mjs"; DestDir: "{app}\bin"; Components: server; Flags: ignoreversion
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\mongodb\*"; DestDir: "{app}\mongodb"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\caddy\*"; DestDir: "{app}\caddy"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

[Icons]
Name: "{autodesktop}\Smart Hospital"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\bin\open-app.vbs"" ""{code:AppUrl}"""; IconFilename: "{app}\bin\app.ico"; Comment: "Open Smart Hospital"
Name: "{autoprograms}\Smart Hospital"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\bin\open-app.vbs"" ""{code:AppUrl}"""; IconFilename: "{app}\bin\app.ico"

[Run]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\bin\configure.mjs"" ""--control-url={code:LicenceServer}"" ""--port={code:ServerPort}"" ""--domain={code:Domain}"""; StatusMsg: "Writing settings…"; Components: server; Flags: runhidden waituntilterminated
Filename: "{app}\bin\services.cmd"; Parameters: "install"; StatusMsg: "Starting the database and server…"; Components: server; Flags: runhidden waituntilterminated
Filename: "{sys}\wscript.exe"; Parameters: """{app}\bin\open-app.vbs"" ""{code:AppUrl}"""; Description: "Open Smart Hospital"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\bin\services.cmd"; Parameters: "uninstall"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "SmartHospitalServices"

[Messages]
FinishedLabel=Setup has finished. Use the Smart Hospital icon on the desktop to open the app.

[Code]
var
  ServerPage: TInputQueryWizardPage;
  WorkstationPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectComponents, 'Server settings', 'How staff reach this server',
    'Staff PCs open http://<this PC''s name or IP>:<port>. Leave the domain blank unless your vendor gave you one (for example his.cityhospital.com); it needs a DNS record pointing to this PC and ports 80/443 open.');
  ServerPage.Add('Port:', False);
  ServerPage.Add('Custom domain (optional):', False);
  ServerPage.Add('Licence server (Control Panel) URL:', False);
  ServerPage.Values[0] := '3010';
  ServerPage.Values[2] := '{#ControlUrl}';

  WorkstationPage := CreateInputQueryPage(wpSelectComponents, 'Hospital server', 'Which computer runs Smart Hospital?',
    'Enter the address of the hospital''s server PC, as your administrator gave it to you, for example 192.168.1.10:3010 or his.cityhospital.com.');
  WorkstationPage.Add('Server address:', False);
end;

function IsServer: Boolean;
begin
  Result := WizardSetupType(False) = 'server';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = ServerPage.ID then Result := not IsServer;
  if PageID = WorkstationPage.ID then Result := IsServer;
end;

{ The Control Panel that activates, renews and suspends this installation's licence. }
function LicenceServer(Param: String): String;
begin
  Result := Trim(ServerPage.Values[2]);
  while (Length(Result) > 0) and (Result[Length(Result)] = '/') do
    Delete(Result, Length(Result), 1);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    Port := StrToIntDef(Trim(ServerPage.Values[0]), 0);
    if (Port < 1024) or (Port > 65535) then
    begin
      MsgBox('Enter a port between 1024 and 65535.', mbError, MB_OK);
      Result := False;
    end
    else if (Pos('http://', Lowercase(LicenceServer(''))) <> 1) and (Pos('https://', Lowercase(LicenceServer(''))) <> 1) then
    begin
      MsgBox('Enter the licence server address your vendor gave you, starting with https:// (activation and renewal are managed there).', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (CurPageID = WorkstationPage.ID) and (Trim(WorkstationPage.Values[0]) = '') then
  begin
    MsgBox('Enter the address of the hospital''s server.', mbError, MB_OK);
    Result := False;
  end;
end;

function ServerPort(Param: String): String;
begin
  Result := Trim(ServerPage.Values[0]);
end;

function Domain(Param: String): String;
begin
  Result := Lowercase(Trim(ServerPage.Values[1]));
end;

{ An IP address (digits and dots) or a PC name (no dots), as opposed to a domain name. }
function IsLanAddress(Address: String): Boolean;
var
  I: Integer;
  AllDigits: Boolean;
begin
  AllDigits := True;
  for I := 1 to Length(Address) do
    if not (((Address[I] >= '0') and (Address[I] <= '9')) or (Address[I] = '.')) then AllDigits := False;
  Result := AllDigits or (Pos('.', Address) = 0);
end;

{ The address the desktop shortcut opens. }
function AppUrl(Param: String): String;
var
  Address: String;
begin
  if IsServer then
    Result := 'http://localhost:' + ServerPort('')
  else
  begin
    Address := Trim(WorkstationPage.Values[0]);
    if (Pos('http://', Lowercase(Address)) = 1) or (Pos('https://', Lowercase(Address)) = 1) then
      Result := Address
    else if Pos(':', Address) > 0 then
      Result := 'http://' + Address
    else if IsLanAddress(Address) then
      Result := 'http://' + Address + ':3010'
    else
      Result := 'https://' + Address;
  end;
end;

{ Upgrades: stop the running server and database before their files are replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if IsServer and FileExists(ExpandConstant('{app}\bin\services.cmd')) then
    Exec(ExpandConstant('{app}\bin\services.cmd'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    MsgBox('Smart Hospital was removed. The hospital''s data is kept in ' + ExpandConstant('{commonappdata}') + '\SmartHospital — delete that folder only if you no longer need it.', mbInformation, MB_OK);
end;
