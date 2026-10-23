#!/usr/bin/env sh
# DEV_OS Engine — open this file to begin.
# It checks your computer, shows what is missing, and starts the guided
# setup after you approve. Works on macOS and Linux.
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is missing. DEV_OS needs Node 22 or newer."
  echo "Install the LTS from https://nodejs.org — then open this file again."
  if [ -t 0 ]; then
    printf 'Press Enter to close. '
    read -r _
  fi
  exit 1
fi

exec node bin/start.mjs "$@"
