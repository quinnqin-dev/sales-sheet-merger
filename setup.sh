#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
command -v npm >/dev/null || { echo 'Install Node.js 22 with npm first.'; exit 1; }
npm --prefix frontend ci
npm --prefix frontend run build
echo 'Setup complete. Double-click start.command to open the browser app.'
