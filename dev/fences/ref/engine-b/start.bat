@echo off
rem DEV_OS Engine - open this file to begin.
rem It checks your computer, shows what is missing, and starts the guided
rem setup after you approve. Works on Windows (double-click it).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node is missing. DEV_OS needs Node 22 or newer.
  echo Install the LTS from https://nodejs.org - then open this file again.
  pause
  exit /b 1
)

node bin\start.mjs %*
pause
