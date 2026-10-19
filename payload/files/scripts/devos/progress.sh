#!/usr/bin/env bash
# Live builder progress for the owner (no log access needed): one comment per run on the open
# "devos:notices" issue, edited in place while the builder works, so a phone shows whether the run is
# moving or quiet. Called by agent-watchdog.sh every few minutes and once at the end.
#
# Usage: progress.sh <elapsed-min> <files-changed> <idle-min> [final text]
# Env:   DEVOS_PROGRESS_TOKEN (GitHub token, never passed to the agent), REPO, TASK, ATTEMPT,
#        DEVOS_SLICE, DEVOS_MAX_SLICES, GITHUB_RUN_ID, GITHUB_SERVER_URL
# Never fails the build: every error is ignored.
set -u
[ -n "${DEVOS_PROGRESS_TOKEN:-}" ] && [ -n "${REPO:-}" ] || exit 0
export GH_TOKEN="$DEVOS_PROGRESS_TOKEN"
elapsed=${1:-0}; files=${2:-0}; idle=${3:-0}; final=${4:-}
dir=.devos; mkdir -p "$dir"
issue=$(cat "$dir/progress-issue" 2>/dev/null || true)
if [ -z "$issue" ]; then
  issue=$(gh api "repos/$REPO/issues?labels=devos:notices&state=open&per_page=1" --jq '.[0].number // empty' 2>/dev/null || true)
  [ -n "$issue" ] || exit 0
  echo "$issue" > "$dir/progress-issue"
fi
run="${GITHUB_SERVER_URL:-https://github.com}/$REPO/actions/runs/${GITHUB_RUN_ID:-}"
slice="${DEVOS_SLICE:-1}/${DEVOS_MAX_SLICES:-4}"
[ "${DEVOS_STAGES:-1}" -gt 1 ] && slice="$slice · stage ${DEVOS_STAGE:-1} of ${DEVOS_STAGES}"
if [ -n "$final" ]; then
  line="$final"
elif [ "$idle" -ge 15 ]; then
  line="🟡 **quiet** — no file changed for $idle min (the watchdog stops a run that stays quiet for ${DEVOS_IDLE_STOP:-30} min)"
else
  line="🟢 **working** — last file change $idle min ago"
fi
act=$(tr -d '`' < "$dir/builder-last-action" 2>/dev/null | head -c 200)
actline=""; [ -n "$act" ] && actline="- Last action: \`$act\`"$'\n'
# What the builder has done: its plan, its latest note and a line per 10 minutes (builder-report.mjs).
report=$(timeout 20 node scripts/devos/builder-report.mjs "${DEVOS_BUILDER_STREAM:-$dir/builder.json}" "$dir/builder-timeline.json" 2>/dev/null || true)
body=$(printf '### Dev OS %s · attempt %s · builder · time slice %s\n\n%s\n\n- Running for **%s min** · **%s** file(s) changed so far in this slice\n%s- Updated %s UTC · [run log](%s)\n%s' \
  "${TASK:-?}" "${ATTEMPT:-?}" "$slice" "$line" "$elapsed" "$files" "$actline" "$(date -u +%H:%M)" "$run" "${report:+
$report}")
id=$(cat "$dir/progress-comment" 2>/dev/null || true)
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$body" >/dev/null 2>&1 || true
else
  id=$(gh api "repos/$REPO/issues/$issue/comments" -f body="$body" --jq '.id' 2>/dev/null || true)
  [ -n "$id" ] && echo "$id" > "$dir/progress-comment"
fi
exit 0
