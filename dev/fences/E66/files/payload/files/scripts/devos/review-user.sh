#!/usr/bin/env bash
# The review's own operating-system user (PR-90). The publish job holds the tokens and runs no branch code; the one AI
# call it makes reads the branch's files, so it runs as `devos-review`: no sudo, no login shell, no shell tool, and only
# the reviewer's credential in its environment. The runner's home (the job's files, its command files, the checkout of
# main) is closed to it.
#
#   review-user.sh setup              create the user, close the runner's home, install Claude Code for that user, and
#                                     lay out /opt/devos-tools (root's, read-only): main's scripts/devos, the review's
#                                     settings (no Bash, no hooks) and its MCP configuration (context7, fence_check)
#                                     and the empty review workspace /opt/devos-review-work, the runner's until handed over
#   review-user.sh workspace          give the review workspace (the review tree, made by publish-verify.mjs
#                                     review-tree, and the work job's evidence) to the user
#   review-user.sh run <workdir> -- <command…>
#                                     run <command> as the user in <workdir>, with HOME, PATH and only the variables
#                                     named in DEVOS_REVIEW_PASS that are set (the active account's credential)
#   review-user.sh stop               end every process the user still has (after the review)
#
# Environment: DEVOS_SCRIPTS (main's scripts/devos, for setup), DEVOS_REVIEW_PASS (for run).
set -euo pipefail
user=devos-review
home=/opt/devos-review
tools=/opt/devos-tools
work=/opt/devos-review-work
cmd=${1:-}
[ $# -gt 0 ] && shift
node_dir=$(dirname "$(command -v node)")
# A runner behind a proxy (a self-hosted one) keeps reaching npm and the model's API: these settings, never a secret, pass
# through the environment, not the command line.
net=""
for name in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy NODE_EXTRA_CA_CERTS SSL_CERT_FILE; do
  [ -n "${!name:-}" ] && net="${net:+$net,}$name"
done

case "$cmd" in
  setup)
    scripts=${DEVOS_SCRIPTS:?set DEVOS_SCRIPTS to the scripts/devos folder of main}
    if ! id -u "$user" >/dev/null 2>&1; then
      sudo useradd --system --create-home --home-dir "$home" --shell /usr/sbin/nologin "$user"
    fi
    # The runner's home holds the job's workspace, its command files and the checkout of main.
    chmod 700 "$HOME"
    sudo rm -rf "$tools"
    sudo mkdir -p "$tools/scripts"
    sudo cp -R "$scripts" "$tools/scripts/devos"
    # No shell, no hooks, and nothing to read outside the workspace: not its own process's environment (/proc), not its
    # home, not the tools.
    printf '%s\n' '{"permissions":{"deny":["Bash","WebSearch","Read(//proc/**)","Read(//sys/**)","Read(//opt/devos-review/**)","Read(//opt/devos-tools/**)","Read(//etc/**)","Read(//root/**)","Read(//home/**)","Read(//tmp/**)"]},"disableAllHooks":true}' | sudo tee "$tools/settings.json" >/dev/null
    printf '{"mcpServers":{"context7":{"type":"http","url":"https://mcp.context7.com/mcp"},"devos":{"type":"stdio","command":"%s","args":["%s"],"env":{"DEVOS_ROOT":"/opt/devos-review-work"}}}}\n' \
      "$node_dir/node" "$tools/scripts/devos/mcp-devos.mjs" | sudo tee "$tools/mcp.json" >/dev/null
    sudo rm -rf "$work"
    sudo install -d -o "$(id -un)" -m 755 "$work"
    sudo chown -R root:root "$tools"
    sudo chmod -R a+rX,go-w "$tools"
    # The CLI, installed by and for the user, from / (no project's .npmrc): nothing of the runner's runs in its place. Its
    # version is the one pinned in the devos.config.json beside this script's own copy (PR-93): main's, in a trusted job.
    spec=$(node "$(dirname "$0")/pins.mjs" claude)
    cd /
    sudo -u "$user" -H ${net:+--preserve-env="$net"} -- /usr/bin/env HOME="$home" PATH="$node_dir:/usr/bin:/bin" \
      npm install -g --prefix "$home/.npm-global" --no-fund --no-audit --loglevel=error "$spec" >/dev/null
    sudo -u "$user" -H -- /usr/bin/env HOME="$home" PATH="$home/.npm-global/bin:$node_dir:/usr/bin:/bin" claude --version
    ;;
  workspace)
    sudo chown -R "$user:$user" "$work"
    sudo chmod -R u+rwX,go+rX,go-w "$work"
    ;;
  run)
    workdir=${1:?usage: review-user.sh run <workdir> -- <command…>}
    shift
    [ "${1:-}" = "--" ] && shift
    keep="$net"
    for name in ${DEVOS_REVIEW_PASS:-}; do
      case "$name" in ''|*[!A-Z0-9_]*) continue ;; esac
      [ -n "${!name:-}" ] && keep="${keep:+$keep,}$name"
    done
    cd "$workdir"
    exec sudo -u "$user" ${keep:+--preserve-env="$keep"} -- /usr/bin/env HOME="$home" \
      PATH="$home/.npm-global/bin:$node_dir:/usr/bin:/bin" DISABLE_AUTOUPDATER=1 "$@"
    ;;
  stop)
    sudo pkill -KILL -u "$user" 2>/dev/null || true
    ;;
  *)
    echo "usage: review-user.sh setup | workspace | run <workdir> -- <command…> | stop" >&2
    exit 2
    ;;
esac
