#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
command -v python3 >/dev/null || { echo '请先安装 Python 3.11 或以上版本'; exit 1; }
command -v npm >/dev/null || { echo '请先安装 Node.js 20.19 或以上版本'; exit 1; }
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
npm --prefix frontend ci
npm --prefix frontend run build
echo '安装完成。双击 start.command 即可启动。'
