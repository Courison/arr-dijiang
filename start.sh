#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[帝江号] 未找到 Node.js，请先安装 Node 20+：https://nodejs.org/"
  exit 1
fi
echo "[帝江号] 正在启动本地环境..."
exec node server.mjs
