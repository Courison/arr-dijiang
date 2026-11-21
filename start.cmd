@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [帝江号] 未找到 Node.js，请先安装 Node 20+：https://nodejs.org/
  pause
  exit /b 1
)
echo [帝江号] 正在启动本地环境...
node server.mjs
pause
