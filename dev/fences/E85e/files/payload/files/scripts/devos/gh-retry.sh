#!/usr/bin/env bash
# E85e (PR-104): GitHub's server errors are tried again, so one HTTP 502 never stops a run that did its work.
#
#   bash scripts/devos/gh-retry.sh install   in a job (publish, advance): puts this script first on the job's PATH as
#                                            `gh`, for the later steps, and keeps the real gh's path beside it
#   gh <arguments>                           the stand-in: runs the real gh; on an HTTP 5xx or a dropped connection it
#                                            tries again after 10, 30 and 60 seconds (DEVOS_GH_RETRY_WAIT); never on a
#                                            4xx or any other error. Its output and exit code are the last try's.
#
# - `gh pr create` first asks whether the try that failed made the pull request anyway; if it did, its address is the
#   answer. Labels and statuses are the same when repeated; a comment may, rarely, post twice.
# - Standard input is kept for the next try only when gh reads it (an argument `-`, `…=-` or `…@-`); otherwise it is
#   left alone, so a `while read` loop around gh keeps its input.
set -u
if [ "$(basename "$0")" != "gh" ]; then
  if [ "${1:-}" != "install" ]; then echo "usage: bash gh-retry.sh install" >&2; exit 2; fi
  real=$(command -v gh) || { echo "gh-retry: no gh on PATH" >&2; exit 1; }
  dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/devos-gh"
  mkdir -p "$dir" || exit 1
  cp "$0" "$dir/gh" && chmod +x "$dir/gh" && printf '%s\n' "$real" > "$dir/real" || exit 1
  [ -n "${GITHUB_PATH:-}" ] && printf '%s\n' "$dir" >> "$GITHUB_PATH"
  echo "gh-retry: GitHub's server errors are tried again, 3 times, for the later steps of this job ($real)"
  exit 0
fi

here=$(cd "$(dirname "$0")" && pwd)
real=$(cat "$here/real" 2>/dev/null || true)
[ -n "$real" ] && [ -x "$real" ] || { echo "gh-retry: the real gh is not known ($here/real)" >&2; exit 127; }
SERVER='HTTP 5[0-9][0-9]|50[234] (Bad Gateway|Service Unavailable|Gateway Timeout)|connection reset by peer|i/o timeout|TLS handshake timeout|unexpected EOF|error connecting to api\.github\.com'
read -r -a waits <<< "${DEVOS_GH_RETRY_WAIT:-10 30 60}"

stdin=""
for a in "$@"; do case "$a" in -|*=-|*@-) stdin=1 ;; esac; done
out=$(mktemp); err=$(mktemp); in=""
if [ -n "$stdin" ]; then in=$(mktemp); cat > "$in"; fi
trap 'rm -f "$out" "$err" ${in:+"$in"}' EXIT

# The pull request a failed `gh pr create` may have made: its address, or nothing.
made() {
  local repo="" head="" prev="" a
  for a in "$@"; do
    case "$prev" in --repo|-R) repo=$a ;; --head|-H) head=$a ;; esac
    case "$a" in --repo=*) repo=${a#--repo=} ;; --head=*) head=${a#--head=} ;; esac
    prev=$a
  done
  [ -n "$head" ] || return 0
  "$real" pr list ${repo:+--repo "$repo"} --head "$head" --state open --json url --jq '.[0].url // empty' 2>/dev/null || true
}

tries=0
while :; do
  if [ -n "$in" ]; then "$real" "$@" < "$in" > "$out" 2> "$err"; else "$real" "$@" > "$out" 2> "$err"; fi
  code=$?
  if [ "$code" = 0 ] || [ "$tries" -ge "${#waits[@]}" ] || ! grep -qE "$SERVER" "$err"; then break; fi
  if [ "${1:-}" = pr ] && [ "${2:-}" = create ]; then
    url=$(made "$@")
    if [ -n "$url" ]; then
      echo "gh-retry: the pull request was made by the try that failed: $url" >&2
      printf '%s\n' "$url"
      exit 0
    fi
  fi
  echo "gh-retry: GitHub answered '$(grep -m1 -oE "$SERVER" "$err")' to gh ${1:-} ${2:-}; trying again in ${waits[$tries]} s ($(( tries + 1 )) of ${#waits[@]})" >&2
  sleep "${waits[$tries]}"
  tries=$(( tries + 1 ))
done
cat "$out"
cat "$err" >&2
exit "$code"
