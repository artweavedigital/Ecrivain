@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Electron n'est pas installe dans ce dossier.
  echo Lancez d'abord INSTALLER-DEPENDANCES.cmd
  pause
  exit /b 1
)
call npm.cmd start
if errorlevel 1 pause
endlocal
