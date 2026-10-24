#!/bin/sh
# Double-click to open the DEV_OS guided setup (macOS). The first time, right-click it and choose Open.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "DEV_OS needs Node.js 22 or newer. Install it from https://nodejs.org, then open this file again."
  read -r _
  exit 1
fi
exec node bin/devos.mjs ui
