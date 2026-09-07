@echo off
setlocal
cd /d "%~dp0"
echo Installation des dependances d'Ecrivain...
call npm.cmd install
if errorlevel 1 (
  echo.
  echo L'installation a rencontre une erreur.
  pause
  exit /b 1
)
echo.
echo Installation terminee.
pause
endlocal
