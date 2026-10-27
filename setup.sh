#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
command -v python3 >/dev/null || { echo 'Install Python 3.11 or later first.'; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js 20.19 or later first.'; exit 1; }
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
npm --prefix frontend ci
npm --prefix frontend run build
echo 'Setup complete. Double-click start.command to launch.'
