#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if [ ! -d frontend/node_modules ] || [ ! -f frontend/dist/index.html ]; then
  ./setup.sh
fi
exec npm --prefix frontend run preview -- --host 127.0.0.1 --port 4173 --open
