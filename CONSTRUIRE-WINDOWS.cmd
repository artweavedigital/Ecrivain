@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Construction d'Ecrivain pour Windows

echo.
echo ============================================================
echo   ECRIVAIN 0.6.0 BETA - CONSTRUCTION WINDOWS
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  echo Installez Node.js 24 LTS puis relancez ce fichier.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] npm est introuvable.
  pause
  exit /b 1
)

echo [1/4] Installation / verification des dependances...
call npm.cmd install
if errorlevel 1 goto :fail

echo.
echo [2/4] Verification du code...
call npm.cmd run check
if errorlevel 1 goto :fail

echo.
echo [3/4] Creation de l'application Windows 64 bits...
if exist "dist\Ecrivain-win32-x64" rmdir /s /q "dist\Ecrivain-win32-x64"
call npm.cmd run package:win
if errorlevel 1 goto :fail

if not exist "dist" mkdir "dist"
if exist "dist\Ecrivain-0.6.0-beta-portable.zip" del /q "dist\Ecrivain-0.6.0-beta-portable.zip"
echo Creation de l'archive portable...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'dist\Ecrivain-win32-x64\*' -DestinationPath 'dist\Ecrivain-0.6.0-beta-portable.zip' -CompressionLevel Optimal"

echo.
echo [4/4] Recherche d'Inno Setup pour creer l'installateur...
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"

if defined ISCC (
  "%ISCC%" "release\windows\Ecrivain.iss"
  if errorlevel 1 goto :fail
  echo.
  echo Installateur cree dans : dist\installer\
) else (
  echo.
  echo Inno Setup 6 n'est pas installe : l'application portable est quand meme prete.
  echo Pour generer Ecrivain-Setup-0.6.0-beta.exe, installez Inno Setup 6,
  echo puis relancez CONSTRUIRE-WINDOWS.cmd.
)

echo.
echo ============================================================
echo   CONSTRUCTION TERMINEE
echo ============================================================
echo.
echo Application : dist\Ecrivain-win32-x64\Ecrivain.exe
echo Portable    : dist\Ecrivain-0.6.0-beta-portable.zip
if exist "dist\installer\Ecrivain-Setup-0.6.0-beta.exe" echo Installateur : dist\installer\Ecrivain-Setup-0.6.0-beta.exe
echo.
pause
exit /b 0

:fail
echo.
echo [ERREUR] La construction a echoue. Consultez les messages ci-dessus.
pause
exit /b 1
