@echo off
setlocal

set NODE_EXE=C:\Program Files\nodejs\node.exe
set SCRIPT_DIR=%~dp0
set PORT=%PORT:8080%

echo Starting Video Sync Global Server...
echo Port: %PORT%
echo.

:restart
"%NODE_EXE%" "%SCRIPT_DIR%server-global.js"
if errorlevel 1 (
    echo Process exited with error, restarting in 5 seconds...
    timeout /t 5 /nobreak >nul
    goto restart
) else (
    echo Process exited, restarting in 5 seconds...
    timeout /t 5 /nobreak >nul
    goto restart
)
