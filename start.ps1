$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[帝江号] 未找到 Node.js，请先安装 Node 20+：https://nodejs.org/' -ForegroundColor Yellow
  Read-Host '按回车退出'
  exit 1
}

Write-Host '[帝江号] 正在启动本地环境...' -ForegroundColor Green
node server.mjs
