#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ] || [ ! -f frontend/dist/index.html ]; then
  ./setup.sh
fi
exec .venv/bin/python launcher.py
