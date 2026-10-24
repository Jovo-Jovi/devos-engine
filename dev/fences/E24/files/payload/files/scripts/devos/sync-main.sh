#!/usr/bin/env bash
# Bring the latest main into the task branch right before the runner pushes (PR-14).
# If main changed during the run (for example a method patch to .github/workflows/), a task branch
# without those commits looks to GitHub like it edits workflow files, and GitHub refuses the push
# from the Actions token. Merging main first keeps the branch's workflow files identical to main's.
# Usage: bash scripts/devos/sync-main.sh <authenticated remote URL>
set -euo pipefail
remote="$1"
git fetch --quiet "$remote" "+refs/heads/main:refs/remotes/origin/main"
if git merge-base --is-ancestor origin/main HEAD; then
  exit 0
fi
echo "main moved during this run; merging it into $(git branch --show-current) before pushing"
if ! git merge --no-edit origin/main; then
  # PR-52: docs/USAGE.md is counted from the records, so a conflict in it alone is resolved by counting again.
  if [ "$(git diff --name-only --diff-filter=U)" = "docs/USAGE.md" ] && [ -f scripts/devos/usage.mjs ]; then
    node scripts/devos/usage.mjs report --write && git add docs/USAGE.md && git commit --no-edit --quiet && {
      echo "docs/USAGE.md counted again from the merged usage records"
      exit 0
    }
  fi
  git merge --abort || true
  # Never lose the run's work: push it, unmerged, to a rescue branch before failing.
  branch=$(git branch --show-current)
  rescue="rescue/${branch}-${GITHUB_RUN_ID:-$(date -u +%Y%m%d%H%M%S)}"
  if git push --quiet "$remote" "HEAD:refs/heads/$rescue" 2>/dev/null; then
    echo "$rescue" > .devos/rescue-branch 2>/dev/null || true
    echo "::error title=Dev OS::main changed during this run and conflicts with this task's work. The run's work is saved on branch $rescue (not merged). Merge main into it, resolve, and push it to $branch, or re-run the task."
  else
    echo "::error title=Dev OS::main changed during this run and conflicts with this task's work, and the rescue push failed. Re-run the task; nothing was lost on main."
  fi
  git diff --name-only --diff-filter=U 2>/dev/null || true
  exit 1
fi
