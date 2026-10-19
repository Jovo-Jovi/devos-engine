#!/usr/bin/env bash
# Upload the prebuilt Vercel output (.vercel/output from `vercel build`) and print its URL (PR-16).
#
# The upload runs from the project directory itself: the prebuilt output refers to files in
# node_modules by path, so it cannot be uploaded from a copy. Only .git is moved aside for the
# upload, so the CLI sends no commit author (a Hobby team blocks commits not authored by its owner,
# and the runner commits as devos-runner, PR-15). --meta keeps the branch and SHA on the deployment.
#
# Fails (exit 1, no output on stdout) unless Vercel returned a deployment URL.
# Usage: VERCEL_TOKEN=… bash scripts/devos/vercel-deploy.sh <branch> [--prod]
#        DEVOS_VERCEL_LOG=<file> appends the CLI's log there (default: stderr).
set -euo pipefail
branch="${1:?usage: vercel-deploy.sh <branch> [--prod]}"
shift
: "${VERCEL_TOKEN:?VERCEL_TOKEN is not set}"
root=$(git rev-parse --show-toplevel)
cd "$root"
sha=$(git rev-parse HEAD)
log="${DEVOS_VERCEL_LOG:-/dev/stderr}"
[ -d .vercel/output ] || { echo "vercel-deploy: .vercel/output does not exist; run vercel build first" >&2; exit 1; }

aside="$(dirname "$root")/.devos-git-aside-$$"
mv .git "$aside"
trap 'mv "$aside" "$root/.git"' EXIT

set +e
out=$(timeout 300 npx --yes vercel@latest deploy --prebuilt "$@" --token="$VERCEL_TOKEN" \
  --meta devosBranch="$branch" --meta devosSha="$sha" < /dev/null 2>>"$log")
rc=$?
set -e
url=$(printf '%s\n' "$out" | grep -E '^https://[^ ]+$' | tail -n 1 || true)
if [ "$rc" -ne 0 ] || [ -z "$url" ]; then
  echo "vercel-deploy: the upload failed (exit $rc) and Vercel returned no deployment URL; see the log above" >&2
  exit 1
fi
echo "$url"
