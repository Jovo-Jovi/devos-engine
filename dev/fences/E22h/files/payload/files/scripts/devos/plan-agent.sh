#!/usr/bin/env bash
# One planning run on the project's reviewer agent (PR-53): an intake plan, a method-fix diagnosis or a revision.
# The agent and model are the ones the developer chose (agents.reviewer in devos.config.json); no other is used.
# A usage limit moves the run to the same tool's other account (PR-29); with none left it stops and the caller parks it.
#   bash scripts/devos/plan-agent.sh <stage> <prompt> <schema> <out.json> <effort> <max-turns> [prompt after a switch]
# <out.json> holds {"structured_output": {…} or null, "tool", "model", "limited"} whatever the tool (Claude Code's own
# fields such as duration_ms and usage are kept). The raw output is <out>.raw and the errors <out>.err.
stage="${1:-}"
prompt="${2:-}"
schema="${3:-}"
out="${4:-}"
effort="${5:-high}"
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
line=$(node scripts/devos/agents.mjs reviewer --mode deep) || exit 1
tool=$(printf '%s\n' "$line" | sed -n 's/^reviewer_tool=//p')
model=$(printf '%s\n' "$line" | sed -n 's/^reviewer_model=//p')
mkdir -p .devos
rm -f "$out" "$raw" "$err" "$answer"
: > "$err"

. scripts/devos/accounts.sh
accounts=$(devos_accounts "$tool")
limited=""
if [ -z "$accounts" ]; then
  echo "::error::no $tool credential for the project's reviewer agent: add it (SETUP.md), then run this again"
fi
echo "$stage: the reviewer agent, $tool $model, effort $effort"

ARGS=()
case "$tool" in
  claude) ;;
  cursor)
    node scripts/devos/role-env.mjs swap cursor-planner || exit 1
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
    node scripts/devos/agent-cli.mjs args --tool "$tool" --role reviewer --model "$model" --effort "$effort" --last "$base.last" > .devos/plan-args.bin || exit 1
    while IFS= read -r -d '' a; do ARGS+=("$a"); done < .devos/plan-args.bin
    ;;
  *) echo "::error::plan-agent: unknown reviewer tool '$tool'"; exit 1 ;;
esac

first=1
for acc in $accounts; do
  p="$prompt"
  [ -z "$first" ] && p="$again"
  first=""
  if [ "$tool" != "claude" ]; then
    # These CLIs take no schema: the prompt asks for the answer in a file, which is read back below.
    { cat "$p"; printf '\n\n## Your answer\n\nWhen you have finished, write your answer to `%s` as one JSON object that matches this schema, and nothing else in that file:\n\n```json\n' "$answer"; cat "$schema"; printf '\n```\n'; } > "$base-prompt.md"
    p="$base-prompt.md"
  fi
  case "$tool" in
    claude)
      devos_use_claude "$acc"
      claude -p "$(cat "$p")" --model "$model" --effort "$effort" --output-format json \
        --json-schema "$(cat "$schema")" --permission-mode dontAsk --max-turns "$turns" \
        --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Task,Agent,Skill" \
        --disallowedTools "Bash(git push *),Bash(git commit *),Bash(git checkout *),Bash(git reset *),Bash(gh *),Bash(curl *),Bash(wget *)" \
        > "$raw" 2> "$err"
      code=$?; cmd=claude ;;
    cursor)
      devos_use_cursor "$acc"
      agent -p --force --trust --model "$model" --output-format stream-json "$(cat "$p")" > "$raw" 2> "$err"
      code=$?; cmd=agent ;;
    codex)
      devos_use_codex "$acc"
      "${ARGS[@]}" "$(cat "$p")" > "$raw" 2> "$err"
      code=$?; cmd=codex ;;
    gemini)
      devos_use_gemini "$acc"
      "${ARGS[@]}" "$(cat "$p")" > "$raw" 2> "$err"
      code=$?; cmd=gemini ;;
  esac
  node scripts/devos/usage.mjs record --stage "$stage" --command "$cmd" --model "$model" --out "$raw" --code "$code" || true
  echo "$stage exit code: $code ($tool account $acc)"
  if devos_limited "$raw" "$err" "$code"; then
    mkdir -p .devos/limits
    cat "$raw" "$err" > ".devos/limits/$tool-$acc.txt"
    devos_note "$stage: $tool account $acc reached its usage limit."
    limited=1
    continue
  fi
  limited=""
  break
done

TOOL="$tool" MODEL="$model" LIMITED="$limited" RAW="$raw" ANSWER="$answer" OUT="$out" node -e '
  const fs = require("fs");
  const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
  let r = {};
  if (process.env.TOOL === "claude") {
    try { r = JSON.parse(read(process.env.RAW)) || {}; } catch { r = {}; }
  } else {
    try { r.structured_output = JSON.parse(read(process.env.ANSWER)); } catch { r.structured_output = null; }
  }
  if (r.structured_output === undefined) r.structured_output = null;
  Object.assign(r, { tool: process.env.TOOL, model: process.env.MODEL, limited: Boolean(process.env.LIMITED) });
  fs.writeFileSync(process.env.OUT, JSON.stringify(r, null, 2) + "\n");'
[ -n "$accounts" ] || exit 1
exit 0
