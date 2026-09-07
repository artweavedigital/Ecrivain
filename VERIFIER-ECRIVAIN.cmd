@echo off
setlocal
cd /d "%~dp0"
echo Verification d'Ecrivain 0.6.0 beta...
echo.

for %%F in (main.js preload.js app.js global-synopsis.js editor.js notes.js timeline.js stats.js mindmap.js safety.js search.js ai.js plugins.js settings.js packager-extension.js) do (
    if not exist "%%F" (
        echo [ERREUR] Fichier absent : %%F
        pause
        exit /b 1
    )
    node --check "%%F" >nul 2>&1
    if errorlevel 1 (
        echo [ERREUR] Syntaxe invalide : %%F
        node --check "%%F"
        pause
        exit /b 1
    ) else (
        echo [OK] %%F
    )
)

for %%F in (index.html app.css package.json FORMAT-PROJET.md LICENSE NOTICE README.md BETA-TEST.md) do (
    if not exist "%%F" (
        echo [ERREUR] Fichier absent : %%F
        pause
        exit /b 1
    )
)

if not exist "vendor\vis-timeline.min.js" (
    echo [ERREUR] vendor\vis-timeline.min.js absent
    pause
    exit /b 1
)
if not exist "vendor\vis-timeline.min.css" (
    echo [ERREUR] vendor\vis-timeline.min.css absent
    pause
    exit /b 1
)

echo.
echo [OK] Base applicative coherente.
echo Lancez ensuite Ecrivain avec LANCER-ECRIVAIN.cmd.
pause
endlocal
