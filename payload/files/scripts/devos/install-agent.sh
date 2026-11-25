#!/usr/bin/env bash
# E85 (PR-101): one agent tool's CLI, at the exact version main's devos.config.json pins (PR-93), for the job that runs
# it: the work job's builder, the review job's reviewer and the planner jobs. Claude Code, Codex and Gemini are npm
# packages; Cursor's agent package is checked by its SHA-256 before it is unpacked. Run it from a folder whose
# scripts/devos/pins.mjs reads main's devos.config.json. On GitHub it adds the CLI's folder to GITHUB_PATH.
#   bash scripts/devos/install-agent.sh <cursor|claude|codex|gemini>
set -euo pipefail
tool="${1:-}"
here=$(dirname "$0")
case "$tool" in
  claude|codex|gemini)
    spec=$(node "$here/pins.mjs" "$tool")
    npm install -g "$spec"
    ;;
  cursor)
    spec=$(node "$here/pins.mjs" cursor)
    version=${spec% *}
    pkg="${RUNNER_TEMP:-/tmp}/cursor-agent.tar.gz"
    curl -fsSL --retry 3 --retry-delay 2 -o "$pkg" "https://downloads.cursor.com/lab/$version/linux/x64/agent-cli-package.tar.gz"
    echo "${spec#* }  $pkg" | sha256sum -c -
    dir="$HOME/.local/share/cursor-agent/versions/$version"
    mkdir -p "$dir" "$HOME/.local/bin"
    tar --strip-components=1 -xzf "$pkg" -C "$dir"
    ln -sf "$dir/cursor-agent" "$HOME/.local/bin/agent"
    ln -sf "$dir/cursor-agent" "$HOME/.local/bin/cursor-agent"
    if [ -n "${GITHUB_PATH:-}" ]; then echo "$HOME/.local/bin" >> "$GITHUB_PATH"; fi
    ;;
  *)
    echo "install-agent: no tool '$tool'; one of cursor, claude, codex, gemini" >&2
    exit 2
    ;;
esac
