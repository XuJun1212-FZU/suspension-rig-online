@echo off
chcp 65001 >nul
cd /d "%~dp0"
node --version
if errorlevel 1 (
  echo 需要 Node.js 24 或以上版本。
  pause
  exit /b 1
)
node scripts/build.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts/dev.mjs
pause
