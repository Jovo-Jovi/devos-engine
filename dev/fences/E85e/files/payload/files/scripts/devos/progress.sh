#!/usr/bin/env bash
# E85e (PR-104): one progress line for an agent run, in the run's log, at every stage. Nothing is posted: since PR-90
# no job where an agent runs holds a token that could post (D-E18), so the progress comment of earlier versions is gone.
#
#   progress.sh line <minutes> <what>          <stage> · <tool> <model> · effort <label> · <minutes> min · <what>
#   progress.sh label <tool> <model> <effort>  the effort as the line shows it (builder-model.mjs effortLabel)
#   progress.sh watch review|answer|running [file]
#                                              a line every DEVOS_PROGRESS_EVERY seconds (60) until it is stopped:
#                                              review: "review file <K> KB" or "no review file yet"; answer: "answer
#                                              written" or "no answer yet"; running: "running"
# Env: DEVOS_PROGRESS_STAGE, DEVOS_PROGRESS_TOOL, DEVOS_PROGRESS_MODEL, DEVOS_PROGRESS_EFFORT; DEVOS_PROGRESS_UNIT (the
# seconds in a minute, 60; tests shrink it). The watchdog prints the builder's line itself (agent-watchdog.sh); plan-agent.sh
# and the second opinions' steps start `watch` beside their agent and stop it with kill, then wait.
# Never fails the step: a line that cannot be made is skipped.
set -u
here=$(cd "$(dirname "$0")" && pwd)

label() {
  # argv[1] is "label": builder-model.mjs runs as a command only when argv[1] is its own path.
  node --input-type=module -e '
    const [, file, tool, model, effort] = process.argv.slice(1);
    const { effortLabel } = await import(new URL(`file://${file}`).href);
    process.stdout.write(effortLabel(tool, model, effort));
  ' label "$here/builder-model.mjs" "${1:-}" "${2:-}" "${3:-}" 2>/dev/null || printf '%s' "${3:-none}"
}

line() {
  printf '%s · %s %s · effort %s · %s min · %s\n' "${DEVOS_PROGRESS_STAGE:-agent}" "${DEVOS_PROGRESS_TOOL:-?}" \
    "${DEVOS_PROGRESS_MODEL:-?}" "$(label "${DEVOS_PROGRESS_TOOL:-}" "${DEVOS_PROGRESS_MODEL:-}" "${DEVOS_PROGRESS_EFFORT:-}")" \
    "${1:-0}" "${2:-running}"
}

what() {  # kind file
  case "$1" in
    review)
      if [ -n "${2:-}" ] && [ -f "$2" ]; then printf 'review file %s KB' "$(( ($(wc -c < "$2") + 1023) / 1024 ))"
      else printf 'no review file yet'; fi ;;
    answer)
      if [ -n "${2:-}" ] && [ -s "$2" ]; then printf 'answer written'; else printf 'no answer yet'; fi ;;
    *) printf 'running' ;;
  esac
}

watch() {  # kind [file]
  local every=${DEVOS_PROGRESS_EVERY:-60} unit=${DEVOS_PROGRESS_UNIT:-60} t0
  s=""
  t0=$(date +%s)
  # E85c (PR-103): the sleep ends with the loop, so a stopped watcher never holds the step's output open.
  trap '[ -n "$s" ] && kill "$s" 2>/dev/null; exit 0' TERM INT HUP
  while :; do
    sleep "$every" & s=$!
    wait "$s"; s=""
    line "$(( ($(date +%s) - t0) / unit ))" "$(what "${1:-running}" "${2:-}")"
  done
}

case "${1:-}" in
  line) shift; line "$@" ;;
  label) shift; label "$@"; echo ;;
  watch) shift; watch "$@" ;;
  *) echo "usage: progress.sh line <minutes> <what> | label <tool> <model> <effort> | watch review|answer|running [file]" >&2; exit 2 ;;
esac
exit 0
