#!/usr/bin/env bash
# One run of the project's reviewer agent (PR-53): an intake plan, a method-fix diagnosis, a revision, and since E85
# (PR-101) the review itself, in the cycle's review job (stage reviewer, DEVOS_AGENT_MODE light or deep). It runs in a
# job that holds no write token, with the agent's own keys only, so the agent has its shell.
# The agent and model are the ones the developer chose (agents.reviewer in devos.config.json); no other is used. E86
# (PR-106): the tool's command line for a review (stage reviewer) or a plan (every other stage), how it takes the prompt
# and gives its answer, its role files and its credential's name are its devos/agents/<id>.json (tools.mjs).
# A usage limit moves the run to the same tool's other account (PR-29), then to the reviewer's next model (its
# fallback_models, PR-64); a model the account cannot use moves on at once. With no slot left it stops and the caller
# parks it.
#   bash scripts/devos/plan-agent.sh <stage> <prompt> <schema> <out.json> <effort> <max-turns> [prompt after a switch]
# <out.json> is the agent output contract (agent-result.mjs): "structured_output" ({…} or null), "agent" and "tool",
# "provider", "model", "result", "usage", "limited" and "not_before", whatever the tool. <out>-run.env records the
# exit code, the account and the model (verdict.mjs, PR-54). The raw output is <out>.raw and the errors <out>.err.
stage="${1:-}"
prompt="${2:-}"
schema="${3:-}"
out="${4:-}"
effort="${5:-}"
turns="${6:-120}"
again="${7:-$2}"
if [ -z "$stage" ] || [ ! -f "$prompt" ] || [ ! -f "$schema" ] || [ -z "$out" ]; then
  echo "usage: plan-agent.sh <stage> <prompt> <schema> <out.json> <effort> <max-turns> [prompt after a switch]" >&2
  exit 2
fi
base="${out%.json}"
raw="$base.raw"
err="$base.err"
answer="$base-answer.json"
line=$(node scripts/devos/agents.mjs reviewer --mode "${DEVOS_AGENT_MODE:-deep}") || exit 1
tool=$(printf '%s\n' "$line" | sed -n 's/^reviewer_tool=//p')
provider=$(printf '%s\n' "$line" | sed -n 's/^reviewer_provider=//p')
model=$(printf '%s\n' "$line" | sed -n 's/^reviewer_model=//p')
fallback=$(printf '%s\n' "$line" | sed -n 's/^reviewer_fallbacks=//p')
models="$model $fallback"
mkdir -p .devos
rm -f "$out" "$raw" "$err" "$answer"
: > "$err"

. scripts/devos/accounts.sh
devos_tool "$tool" || exit 1
accounts=$(devos_accounts "$tool")
limited=""
if [ -z "$accounts" ]; then
  echo "::error::no $tool credential for the project's reviewer agent: add it (SETUP.md), then run this again"
fi
# PR-99: a tool that takes an effort runs at the developer's; agents.mjs effort --kind gives it, and none stops here.
if [ -z "$effort" ] && [ "$devos_t_effort" = flag ]; then
  echo "::error title=Dev OS::no effort for the reviewer agent ($tool $model); set it in devos/project.json (devos upgrade asks for it, PR-99)"
  exit 1
fi
echo "$stage: the reviewer agent, $tool $model, effort $(bash scripts/devos/progress.sh label "$tool" "$model" "$effort")"

# E85e (PR-104): one progress line a minute while the agent runs (progress.sh watch): the review file's size for a
# review (DEVOS_PROGRESS_FILE, which the review job names), whether the answer file is written for a plan by a tool that
# writes one, else "running".
progress_kind=answer; progress_file="$answer"
if [ "$stage" = reviewer ]; then
  progress_kind=review; progress_file="${DEVOS_PROGRESS_FILE:-}"; [ -n "$progress_file" ] || progress_kind=running
elif [ "$devos_t_answer" = schema ]; then
  progress_kind=running
fi
watcher=""
watch_start() {
  DEVOS_PROGRESS_STAGE="$stage" DEVOS_PROGRESS_TOOL="$tool" DEVOS_PROGRESS_MODEL="$1" DEVOS_PROGRESS_EFFORT="$effort" \
    bash scripts/devos/progress.sh watch "$progress_kind" "$progress_file" &
  watcher=$!
}
# E86 (PR-106): a stop that reaches the watcher while it is still starting can be lost, and the run then waited on it
# for ever (seen in the tests, under load). The stop is sent again until the watcher has ended; one still there after
# 5 s is ended with its sleep.
watch_stop() {
  [ -n "$watcher" ] || return 0
  local n=0
  while kill "$watcher" 2>/dev/null; do
    case "$(ps -o stat= -p "$watcher" 2>/dev/null)" in Z*|"") break ;; esac
    n=$((n + 1))
    if [ "$n" -ge 50 ]; then kill -STOP "$watcher" 2>/dev/null; pkill -KILL -P "$watcher" 2>/dev/null; kill -KILL "$watcher" 2>/dev/null; break; fi
    sleep 0.1
  done
  wait "$watcher" 2>/dev/null; watcher=""
}

ARGS=()
# A review swaps in the tool's reviewer kit, every other stage its planner kit (role-env.mjs); a tool with none keeps
# the tree as it is. Then the tool's own files in $HOME and its environment (tools.mjs setup).
role=planner
[ "$stage" = reviewer ] && role=reviewer
node scripts/devos/role-env.mjs swap "$tool" "$role" || exit 1
trap 'node scripts/devos/role-env.mjs restore' EXIT
setup=$(node scripts/devos/tools.mjs setup --tool "$tool") || exit 1
while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done <<< "$setup"

# The CLI's arguments for one model and prompt file, its command first.
args_for() {
  node scripts/devos/tools.mjs args --tool "$tool" --role "$role" --model "$1" --effort "$effort" --turns "$turns" --schema "$schema" --last "$base.last" --prompt "$2" > .devos/plan-args.bin || return 1
  ARGS=()
  while IFS= read -r -d '' a; do ARGS+=("$a"); done < .devos/plan-args.bin
}

first=1
tries=0
ran_model="$model"
code=""
used=""
for slot in $(devos_slots "$tool" $models); do
  run_model="${slot%@*}"
  acc="${slot##*@}"
  ran_model="$run_model"
  used="$acc"
  p="$prompt"
  [ -z "$first" ] && p="$again"
  first=""
  if [ "$devos_t_answer" = file ]; then
    # A CLI that takes no schema: the prompt asks for the answer in a file, which is read back below.
    # E85c (PR-103): into a file of its own. The callers name their prompt <base>-prompt.md, and writing there emptied
    # it before cat read it, so Cursor, Codex and Gemini got only the answer section.
    { cat "$p"; printf '\n\n## Your answer\n\nWhen you have finished, write your answer to `%s` as one JSON object that matches this schema, and nothing else in that file:\n\n```json\n' "$answer"; cat "$schema"; printf '\n```\n'; } > "$base-answer-prompt.md"
    p="$base-answer-prompt.md"
  fi
  args_for "$run_model" "$p" || exit 1
  # PR-87: a temporary server error (a 5xx, a dropped connection, "retriable") runs again in place, three times at most.
  while :; do
    watch_start "$run_model"
    devos_use "$tool" "$acc"
    # PR-71: the prompt on standard input for a tool that reads it, never on the command line; the others get a line
    # that names the file. E85 (PR-101): Claude Code's review keeps its documentation lookups (its reviewer command line).
    if [ -n "$devos_t_stdin" ]; then
      "${ARGS[@]}" < "$p" > "$raw" 2> "$err"
    else
      "${ARGS[@]}" > "$raw" 2> "$err"
    fi
    code=$?; cmd="${ARGS[0]}"
    watch_stop
    node scripts/devos/usage.mjs record --stage "$stage" --command "$cmd" --model "$run_model" --out "$raw" --code "$code" || true
    if [ "$code" != "0" ] && pause=$(devos_server_wait "$tries") && devos_server_error "$raw" "$err" "$code"; then
      tries=$(( tries + 1 ))
      devos_note "$stage: the $tool CLI stopped on a temporary server error; trying again in $pause s ($tries of 3)."
      sleep "$pause"
      continue
    fi
    break
  done
  echo "$stage exit code: $code ($tool $run_model, account $acc)"
  if devos_limited "$raw" "$err" "$code"; then
    mkdir -p .devos/limits
    cat "$raw" "$err" > "$(devos_limit_file "$tool" "$acc" "$(devos_model_index "$run_model" $models)")"
    devos_note "$stage: $tool account $acc reached its usage limit on $run_model."
    limited=1
    continue
  fi
  if [ "$code" != "0" ] && devos_unavailable "$raw" "$err" "$code"; then
    devos_note "$stage: $tool account $acc cannot use $run_model; trying the next model."
    continue
  fi
  limited=""
  break
done

# E85 (PR-101): the run in the agent output contract, and its record for the verdict.
node scripts/devos/agent-result.mjs --role "$stage" --tool "$tool" --model "$ran_model" --provider "$provider" \
  --raw "$raw" --err "$err" --last "$base.last" --answer "$answer" --code "$code" --limited "${limited:+true}" --out "$out" || exit 1
printf 'code=%s\nused=%s\naccounts="%s"\ntool=%s\nmodel=%s\n' "$code" "$used" "$accounts" "$tool" "$ran_model" > "$base-run.env"
[ -n "$accounts" ] || exit 1
exit 0
