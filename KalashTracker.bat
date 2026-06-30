@echo off
title Kalash Tracker - Resort Manager
echo.
echo  ================================================
echo    Kalash Tracker - Resort Staff Manager
echo  ================================================
echo.
echo  Starting server... please wait
echo.

cd /d "%~dp0"
start "" /B node backend/server.js > server.log 2>&1

timeout /t 2 /nobreak >nul

start "" "http://localhost:8080"

echo  Server is running at: http://localhost:8080
echo  Browser should open automatically.
echo.
echo  Keep this window open while using the app.
echo  To stop the server, close this window.
echo.
pause
taskkill /F /IM node.exe >nul 2>&1
