@echo off
chcp 65001 >nul
rem ===========================================================
rem  One-click launcher: starts the local server and opens the
rem  app in the default browser.
rem      start.cmd [port]
rem  Without an argument the first free port from 8080 is used.
rem  The server lives as long as this window is open (Ctrl+C).
rem ===========================================================
setlocal

rem Second pass over this same file: waits for the server, opens the browser.
if /i "%~1"=="--open" goto :open

pushd "%~dp0" || (
    echo Project folder not found.
    echo.
    pause
    exit /b 1
)

if not exist "server.mjs" (
    echo No server.mjs in "%CD%": put start.cmd back into the project root.
    echo.
    popd
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install it from https://nodejs.org/ and try again.
    echo.
    popd
    pause
    exit /b 1
)

rem Port: from the argument, otherwise the first free one in 8080..8099.
set "PORT=%~1"
if not defined PORT (
    for /l %%p in (8080,1,8099) do (
        if not defined PORT (
            netstat -a -n -p tcp | findstr /r /c:":%%p .*LISTENING" >nul || set "PORT=%%p"
        )
    )
)
if not defined PORT (
    echo No free port in the 8080-8099 range.
    echo.
    popd
    pause
    exit /b 1
)

title SVG constructor - port %PORT%
echo Folder:  %CD%
echo Address: http://localhost:%PORT%/
echo Stop the server: Ctrl+C or close this window.
echo.

rem The browser is opened from a second window once the port answers.
rem It has to be cmd /c: "start file.cmd" would keep that window open.
start "" /min cmd /c ""%~f0" --open %PORT%"
node server.mjs %PORT%

popd
exit /b 0

:open
rem %2 is the port. Wait for a listener, then open the page.
set "PORT=%~2"
for /l %%i in (1,1,30) do (
    netstat -a -n -p tcp | findstr /r /c:":%PORT% .*LISTENING" >nul && (
        start "" "http://localhost:%PORT%/"
        exit /b 0
    )
    timeout /t 1 /nobreak >nul 2>nul || ping -n 2 127.0.0.1 >nul
)
exit /b 1
