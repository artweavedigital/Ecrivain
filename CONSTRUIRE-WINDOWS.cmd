@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Construction Ecrivain Windows - corrigee

echo.
echo ============================================================
echo  ECRIVAIN 0.6.0 BETA 11.1 - CONSTRUCTION WINDOWS
 echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  goto :fail
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] npm.cmd est introuvable.
  goto :fail
)

if not exist "package.json" (
  echo [ERREUR] Placez ce fichier dans le dossier du projet contenant package.json.
  goto :fail
)

echo [1/4] Installation et verification des dependances...
call npm.cmd install
if errorlevel 1 goto :fail

echo.
echo [2/4] Verification du code...
call npm.cmd run check
if errorlevel 1 goto :fail

echo.
echo [3/4] Construction de l'application et du ZIP portable...
if not exist "node_modules\@electron\packager\bin\electron-packager.mjs" (
  echo [ERREUR] Electron Packager est introuvable.
  goto :fail
)

node "node_modules\@electron\packager\bin\electron-packager.mjs" . Ecrivain --platform=win32 --arch=x64 --out=dist --overwrite --asar --icon=assets/branding/ecrivain.ico --app-version=0.6.0.11 --build-version=0.6.0.11 --ignore="^/dist($|/)" --ignore="^/test($|/)" --ignore="^/.git($|/)" --ignore="^/.github($|/)"
if errorlevel 1 goto :fail
if not exist "dist\Ecrivain-win32-x64\Ecrivain.exe" (
  echo [ERREUR] Ecrivain.exe n'a pas ete cree.
  goto :fail
)

if exist "dist\Ecrivain-0.6.0-beta.11.1-portable.zip" del /q "dist\Ecrivain-0.6.0-beta.11.1-portable.zip"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -LiteralPath 'dist\Ecrivain-win32-x64' -DestinationPath 'dist\Ecrivain-0.6.0-beta.11.1-portable.zip' -CompressionLevel Optimal -ErrorAction Stop"
if errorlevel 1 goto :fail
if not exist "dist\Ecrivain-0.6.0-beta.11.1-portable.zip" (
  echo [ERREUR] L'archive ZIP portable n'a pas ete creee.
  goto :fail
)
echo [OK] Application et ZIP portable crees.

echo.
echo [4/4] Creation de l'installateur si Inno Setup 6 est present...
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
if not defined ISCC for %%I in (ISCC.exe) do if not "%%~$PATH:I"=="" set "ISCC=%%~$PATH:I"

if defined ISCC (
  if not exist "release\windows\Ecrivain.iss" (
    echo [ERREUR] Script Inno Setup release\windows\Ecrivain.iss manquant.
    goto :fail
  )
  "%ISCC%" "release\windows\Ecrivain.iss"
  if errorlevel 1 goto :fail
  if not exist "dist\installer\Ecrivain-Setup-0.6.0-beta.11.1.exe" (
    echo [ERREUR] L'installateur n'a pas ete cree.
    goto :fail
  )
  echo [OK] Installateur cree.
) else (
  echo [INFO] Inno Setup 6 non trouve. Le ZIP portable est disponible.
  echo Installez Inno Setup 6 puis relancez ce script pour l'installateur.
)

echo.
echo ================== CONSTRUCTION TERMINEE ==================
echo Application : dist\Ecrivain-win32-x64\Ecrivain.exe
echo ZIP portable : dist\Ecrivain-0.6.0-beta.11.1-portable.zip
if exist "dist\installer\Ecrivain-Setup-0.6.0-beta.11.1.exe" echo Installateur  : dist\installer\Ecrivain-Setup-0.6.0-beta.11.1.exe
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo [ERREUR] La construction a echoue. Consultez les messages ci-dessus.
pause
exit /b 1
