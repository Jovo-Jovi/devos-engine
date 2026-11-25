#!/usr/bin/env bash
# One run of the project's reviewer agent (PR-53): an intake plan, a method-fix diagnosis, a revision, and since E85
# (PR-101) the review itself, in the cycle's review job (stage reviewer, DEVOS_AGENT_MODE light or deep). It runs in a
# job that holds no write token, with the agent's own keys only, so the agent has its shell.
# The agent and model are the ones the developer chose (agents.reviewer in devos.config.json); no other is used.
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
accounts=$(devos_accounts "$tool")
limited=""
if [ -z "$accounts" ]; then
  echo "::error::no $tool credential for the project's reviewer agent: add it (SETUP.md), then run this again"
fi
# PR-99: a tool that takes an effort runs at the developer's; agents.mjs effort --kind gives it, and none stops here.
if [ -z "$effort" ] && { [ "$tool" = "claude" ] || [ "$tool" = "codex" ]; }; then
  echo "::error title=Dev OS::no effort for the reviewer agent ($tool $model); set it in devos/project.json (devos upgrade asks for it, PR-99)"
  exit 1
fi
echo "$stage: the reviewer agent, $tool $model, effort ${effort:-none (the tool takes none)}"

ARGS=()
case "$tool" in
  claude) ;;
  cursor)
    kit=cursor-planner; [ "$stage" = reviewer ] && kit=cursor-reviewer
    node scripts/devos/role-env.mjs swap "$kit" || exit 1
    trap 'node scripts/devos/role-env.mjs restore' EXIT
    ;;
  codex|gemini)
    node scripts/devos/role-env.mjs swap "${tool}-reviewer" || exit 1
    trap 'node scripts/devos/role-env.mjs restore' EXIT
    if [ "$tool" = "gemini" ]; then
      export GEMINI_CLI_TRUST_WORKSPACE=true
      mkdir -p "$HOME/.gemini/policies"
      cp devos/roles/gemini/policy.toml "$HOME/.gemini/policies/devos.toml" || exit 1
      cp devos/roles/gemini/settings.json "$HOME/.gemini/settings.json" || exit 1
    fi
    ;;
  *) echo "::error::plan-agent: unknown reviewer tool '$tool'"; exit 1 ;;
esac

# The CLI's arguments for one model (Codex and Gemini name it in them).
args_for() {
  node scripts/devos/agent-cli.mjs args --tool "$tool" --role reviewer --model "$1" --effort "$effort" --last "$base.last" > .devos/plan-args.bin || return 1
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
  case "$tool" in codex|gemini) args_for "$run_model" || exit 1 ;; esac
  p="$prompt"
  [ -z "$first" ] && p="$again"
  first=""
  if [ "$tool" != "claude" ]; then
    # These CLIs take no schema: the prompt asks for the answer in a file, which is read back below.
    { cat "$p"; printf '\n\n## Your answer\n\nWhen you have finished, write your answer to `%s` as one JSON object that matches this schema, and nothing else in that file:\n\n```json\n' "$answer"; cat "$schema"; printf '\n```\n'; } > "$base-prompt.md"
    p="$base-prompt.md"
  fi
  # PR-87: a temporary server error (a 5xx, a dropped connection, "retriable") runs again in place, three times at most.
  while :; do
    case "$tool" in
      claude)
        devos_use_claude "$acc"
        # E85 (PR-101): the review keeps its documentation lookups (context7, and the three documentation sites it had).
        tools="Read,Glob,Grep,Write,Edit,Bash,Task,Agent,Skill"; mcp=()
        if [ "$stage" = reviewer ] && [ -f devos/ci/mcp.claude.json ]; then
          mcp=(--mcp-config devos/ci/mcp.claude.json)
          tools="$tools,mcp__context7,WebFetch(domain:nextjs.org),WebFetch(domain:cursor.com),WebFetch(domain:code.claude.com)"
        fi
        # PR-71: the prompt on standard input, never on the command line.
        claude -p --model "$run_model" --effort "$effort" --output-format json \
          --json-schema "$(cat "$schema")" --permission-mode dontAsk --max-turns "$turns" "${mcp[@]}" \
          --allowedTools "$tools" \
          --disallowedTools "Bash(git push *),Bash(git commit *),Bash(git checkout *),Bash(git reset *),Bash(gh *),Bash(curl *),Bash(wget *),Bash(pkill *),Bash(killall *)" \
          < "$p" > "$raw" 2> "$err"
        code=$?; cmd=claude ;;
      cursor)
        devos_use_cursor "$acc"
        agent -p --force --trust --model "$run_model" --output-format stream-json "$(devos_prompt cursor "$p")" > "$raw" 2> "$err"
        code=$?; cmd=agent ;;
      codex)
        devos_use_codex "$acc"
        "${ARGS[@]}" "$(devos_prompt codex "$p")" < "$p" > "$raw" 2> "$err"
        code=$?; cmd=codex ;;
      gemini)
        devos_use_gemini "$acc"
        "${ARGS[@]}" "$(devos_prompt gemini "$p")" < "$p" > "$raw" 2> "$err"
        code=$?; cmd=gemini ;;
    esac
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
