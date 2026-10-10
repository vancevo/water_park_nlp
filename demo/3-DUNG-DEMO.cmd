@echo off
chcp 65001 >nul
title Dam Sen Smart Guide - Dung demo
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Chua cai Node.js. Hay tai Node.js 24 LTS tai https://nodejs.org roi chay lai file nay.
  echo.
  pause
  exit /b 1
)
node scripts\demo\demo.mjs stop
echo.
pause
