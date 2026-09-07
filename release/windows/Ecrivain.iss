; Écrivain — installateur Windows Inno Setup
; Généré pour Écrivain 0.6.0 bêta.
#define MyAppName "Écrivain"
#define MyAppExeName "Ecrivain.exe"
#define MyAppVersion "0.6.0-beta.1"
#define MyAppPublisher "Stéphane Matsos"
#define Root SourcePath + "..\..\"

[Setup]
AppId={{83117439-F41F-4AC3-93F1-2A22C663BE0C}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Ecrivain
DefaultGroupName=Écrivain
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#Root}dist\installer
OutputBaseFilename=Ecrivain-Setup-0.6.0-beta
SetupIconFile={#Root}assets\branding\ecrivain.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile={#Root}LICENSE
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"; Flags: unchecked

[Files]
Source: "{#Root}dist\Ecrivain-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Écrivain"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Écrivain"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer Écrivain"; Flags: nowait postinstall skipifsilent
