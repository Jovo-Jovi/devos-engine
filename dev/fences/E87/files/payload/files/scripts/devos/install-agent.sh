#!/usr/bin/env bash
# E85 (PR-101): one agent tool's CLI, at the exact version main's devos.config.json pins (PR-93), for the job that runs
# it: the work job's builder, the review job's reviewer and the planner jobs. E86 (PR-106): how it is installed is in
# its devos/agents/<id>.json (tools.mjs install): an npm package, or Cursor's agent package, checked by its SHA-256
# before it is unpacked. Run it from a folder whose scripts/devos/pins.mjs reads main's devos.config.json. On GitHub it
# adds the CLI's folder to GITHUB_PATH. E87 (PR-109): a tool installed as `none` runs a command already on the runner (a
# project's own tool: node running its script under devos/agents/<id>/); nothing is installed, and its command is checked.
#   bash scripts/devos/install-agent.sh <tool>
set -euo pipefail
tool="${1:-}"
here=$(dirname "$0")
if ! how=$(node "$here/tools.mjs" install --tool "$tool" 2>&1); then
  echo "install-agent: ${how#tools: }" >&2
  exit 2
fi
read -r kind url entry bins <<< "$how"
case "$kind" in
  npm)
    spec=$(node "$here/pins.mjs" "$tool")
    npm install -g "$spec"
    ;;
  checked-package)
    spec=$(node "$here/pins.mjs" "$tool")
    version=${spec% *}
    pkg="${RUNNER_TEMP:-/tmp}/$entry.tar.gz"
    curl -fsSL --retry 3 --retry-delay 2 -o "$pkg" "${url//\{version\}/$version}"
    echo "${spec#* }  $pkg" | sha256sum -c -
    dir="$HOME/.local/share/$entry/versions/$version"
    mkdir -p "$dir" "$HOME/.local/bin"
    tar --strip-components=1 -xzf "$pkg" -C "$dir"
    for b in $bins; do ln -sf "$dir/$entry" "$HOME/.local/bin/$b"; done
    if [ -n "${GITHUB_PATH:-}" ]; then echo "$HOME/.local/bin" >> "$GITHUB_PATH"; fi
    ;;
  none)
    command -v "$url" >/dev/null || { echo "install-agent: $tool runs $url, which this runner does not have" >&2; exit 2; }
    echo "install-agent: $tool runs $url ($(command -v "$url")); nothing to install"
    ;;
  *)
    echo "install-agent: no install for '$tool'" >&2
    exit 2
    ;;
esac
