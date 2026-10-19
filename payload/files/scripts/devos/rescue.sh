#!/usr/bin/env bash
# Put the work a failed push saved on a rescue branch back on its task branch (the supervisor's
# "recover-rescue" action). Merges main (the journal merges by union) and the task branch's own head,
# pushes the result to the task branch without force, then deletes the rescue branch.
# A real conflict stops here with exit 1 and nothing pushed: a person resolves it.
# Usage: bash scripts/devos/rescue.sh <rescue-branch> <task-branch>   (env GH_TOKEN, REPO)
set -euo pipefail
rescue="$1"; task="$2"
remote="${RESCUE_REMOTE:-https://x-access-token:${GH_TOKEN:-}@github.com/${REPO:-}.git}"   # RESCUE_REMOTE: tests only
work=$(mktemp -d)
git clone --quiet --no-tags "$remote" "$work"
cd "$work"
git config user.name "devos-runner"; git config user.email "devos-runner@users.noreply.github.com"
git fetch --quiet origin "+refs/heads/$rescue:refs/remotes/origin/$rescue" "+refs/heads/$task:refs/remotes/origin/$task" "+refs/heads/main:refs/remotes/origin/main"
git checkout --quiet -B "$task" "origin/$rescue"
for base in "origin/$task" origin/main; do
  git merge-base --is-ancestor "$base" HEAD && continue
  if ! git merge --no-edit "$base"; then
    git merge --abort || true
    echo "rescue: $rescue conflicts with $base beyond the append-only journal; nothing pushed" >&2
    exit 1
  fi
done
git push --quiet origin "HEAD:refs/heads/$task"
git push --quiet origin --delete "$rescue" || true
echo "rescue: $rescue is on $task at $(git rev-parse --short HEAD)"
