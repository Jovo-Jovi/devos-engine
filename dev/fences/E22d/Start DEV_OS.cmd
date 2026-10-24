@echo off
title DEV_OS
where node >nul 2>nul
if errorlevel 1 (
  echo DEV_OS needs Node.js 22 or newer. Install it from https://nodejs.org, then open this file again.
  pause
  exit /b 1
)
node "%~dp0bin\devos.mjs" ui
if errorlevel 1 pause
