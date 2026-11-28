#!/usr/bin/env bash
# The builder's run, for every tool (E86, PR-106). Its command line, how it takes the prompt, its role files and the
# name of its credential are the tool's devos/agents/<id>.json (tools.mjs); reviews and plans run through plan-agent.sh.
# Every run goes through the watchdog (time slices, idle stop, PR-71's restart in place), which records its usage
# (PR-52). PR-29, PR-64: the models after the prompt file are tried after <model>, each on every account (accounts.sh
# devos_slots); a usage limit moves to the next slot, a model the account cannot use moves on at once. PR-87: a
# temporary server error runs again in place, three times at most.
#   bash scripts/devos/run-agent.sh builder <tool> <model> <effort> <prompt-file> [<model>…]
# Afterwards .devos/builder-run.env holds code=, used= (the account), accounts=, model= (the one that ran) and outcome=.
role="${1:-}"
tool="${2:-}"
model="${3:-}"
effort="${4:-}"
prompt="${5:-}"
shift 5 2>/dev/null || shift $#
models="$model $*"

if [ "$role" != "builder" ]; then echo "run-agent: role must be builder (reviews and plans run through plan-agent.sh)" >&2; exit 1; fi
if [ ! -f "$prompt" ]; then echo "run-agent: no prompt file '$prompt'" >&2; exit 1; fi

budget="${DEVOS_BUDGET_MIN:-72}"
T0=$(date +%s)
out=".devos/builder.json"
err=".devos/builder.err"
last=".devos/builder-last.md"
envfile=".devos/builder-run.env"

. scripts/devos/accounts.sh
devos_tool "$tool" || exit 1
name="$devos_t_name"
accounts=$(devos_accounts "$tool")
if [ -z "$accounts" ]; then
  echo "::error::$(node scripts/devos/tools.mjs missing-key --tool "$tool")"
  exit 1
fi

node scripts/devos/role-env.mjs swap "$tool" builder || exit 1
trap 'node scripts/devos/role-env.mjs restore' EXIT
# The tool's own files in $HOME and its environment (Gemini's policy, settings and workspace trust).
setup=$(node scripts/devos/tools.mjs setup --tool "$tool") || exit 1
while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done <<< "$setup"

# The CLI's arguments for one model, its command first.
args_for() {
  node scripts/devos/tools.mjs args --tool "$tool" --role builder --model "$1" --effort "$effort" --last "$last" --prompt "$prompt" > .devos/agent-args.bin || return 1
  ARGS=()
  while IFS= read -r -d '' a; do
    ARGS+=("$a")
  done < .devos/agent-args.bin
}

slots=$(devos_slots "$tool" $models)
code=1
used=""
used_model="$model"
restarted=""
tries=0
lim=""
outcome=""
mkdir -p .devos/logs
for slot in $slots; do
  run_model="${slot%@*}"
  acc="${slot##*@}"
  args_for "$run_model" || exit 1
  devos_use "$tool" "$acc"
  used="$acc"
  used_model="$run_model"
  while :; do
    left=$(( budget - ($(date +%s) - T0) / 60 ))
    rm -f "$out" "$out.stream.jsonl" "$last"
    # PR-71: a tool that reads standard input gets the prompt there; the others get a line that names the file.
    if [ -n "$devos_t_stdin" ]; then
      DEVOS_STDIN="$prompt" DEVOS_AGENT_TOOL="$tool" bash scripts/devos/agent-watchdog.sh "$left" 10 "$out" "$err" -- "${ARGS[@]}"
    else
      DEVOS_AGENT_TOOL="$tool" bash scripts/devos/agent-watchdog.sh "$left" 10 "$out" "$err" -- "${ARGS[@]}"
    fi
    code=$?
    why=$(devos_restart "$code")
    if [ -n "$why" ] && [ -z "$restarted" ] && [ $(( budget - ($(date +%s) - T0) / 60 )) -ge 25 ]; then
      restarted=1
      cp "$err" .devos/logs/builder-stalled.err 2>/dev/null || true
      devos_note "Builder: the ${name} CLI $why; restarted once."
      printf '\n\n**An earlier run of this attempt %s.** Its partial changes are already in the working tree (`git status`). Verify them against the fence and continue from them; do not redo or duplicate them.\n' "$why" >> "$prompt"
      continue
    fi
    # PR-87: a temporary server error (a 5xx, a dropped connection, "retriable") runs again in place, three times at most.
    if [ "$code" != "0" ] && pause=$(devos_server_wait "$tries") && [ $(( budget - ($(date +%s) - T0) / 60 )) -ge 10 ] && devos_server_error "$out" "$err" "$code"; then
      tries=$(( tries + 1 ))
      cp "$err" ".devos/logs/builder-server-$tries.err" 2>/dev/null || true
      devos_note "Builder: the ${name} CLI stopped on a temporary server error; trying again in $pause s ($tries of 3)."
      sleep "$pause"
      printf '\n\n**An earlier run of this attempt stopped on a temporary server error.** Its partial changes are already in the working tree (`git status`). Verify them against the fence and continue from them; do not redo or duplicate them.\n' >> "$prompt"
      continue
    fi
    break
  done
  if [ "$code" != "0" ] && devos_limited "$out" "$err" "$code"; then
    mkdir -p .devos/limits
    lim=$(devos_limit_file "$tool" "$acc" "$(devos_model_index "$run_model" $models)")
    cat "$out" "$err" > "$lim"
    outcome=limited
    devos_note "Builder: ${name} account ${acc} reached its usage limit on ${run_model}."
    printf '\n\n**This attempt was started on another %s account or model, which reached its usage limit.** Its partial changes are already in the working tree (`git status`). Verify them against the fence and continue from them; do not redo or duplicate them.\n' "$name" >> "$prompt"
    continue
  fi
  if [ "$code" != "0" ] && devos_unavailable "$out" "$err" "$code"; then
    outcome=unavailable
    devos_note "Builder: ${name} account ${acc} cannot use ${run_model}; trying the next model."
    continue
  fi
  outcome=ran
  break
done
devos_settle "$outcome" "$lim" "$err"

# PR-45: a tool whose output is not the runner's result shape is turned into it (Codex, Gemini); the others are kept.
node scripts/devos/agent-cli.mjs normalize --tool "$tool" --raw "$out" --last "$last" --out "$out" || exit 1
node scripts/devos/role-env.mjs restore || exit 1
trap - EXIT
printf 'code=%s\nused=%s\naccounts="%s"\nmodel=%s\noutcome=%s\n' "$code" "$used" "$accounts" "$used_model" "$outcome" > "$envfile"
exit 0
