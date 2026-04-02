@echo off
setlocal

set NODE_EXE=C:\Program Files\nodejs\node.exe
set SCRIPT_DIR=%~dp0
set PORT=%PORT:8081%
set UPSTREAM_URL=%UPSTREAM_URL:http://localhost:8080%

echo Starting Video Sync Local Server...
echo Port: %PORT%
echo Upstream: %UPSTREAM_URL%
echo.

:restart
"%NODE_EXE%" "%SCRIPT_DIR%server-local.js"
if errorlevel 1 (
    echo Process exited with error, restarting in 5 seconds...
    timeout /t 5 /nobreak >nul
    goto restart
) else (
    echo Process exited, restarting in 5 seconds...
    timeout /t 5 /nobreak >nul
    goto restart
)
