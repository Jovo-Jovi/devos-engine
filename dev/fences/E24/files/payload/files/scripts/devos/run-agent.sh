#!/usr/bin/env bash
# One Codex or Gemini run for the cycle (PR-45). The workflow reads .devos/<role>-run.env afterwards.
# Every run is in the usage record (PR-52): a builder run through the watchdog (DEVOS_USAGE_STAGE), a reviewer run here.
#   bash scripts/devos/run-agent.sh <builder|reviewer> <codex|gemini> <model> <effort> <prompt-file>
role="${1:-}"
tool="${2:-}"
model="${3:-}"
effort="${4:-}"
prompt="${5:-}"

case "$role" in
  builder|reviewer) ;;
  *) echo "run-agent: role must be builder or reviewer" >&2; exit 1 ;;
esac
case "$tool" in
  codex|gemini) ;;
  *) echo "run-agent: tool must be codex or gemini" >&2; exit 1 ;;
esac

budget="${DEVOS_BUDGET_MIN:-72}"
T0=$(date +%s)
name="Codex"
[ "$tool" = "gemini" ] && name="Gemini"
out=".devos/${role}.json"
err=".devos/${role}.err"
last=".devos/${role}-last.md"
envfile=".devos/${role}-run.env"

. scripts/devos/accounts.sh
accounts=$(devos_accounts "$tool")
if [ -z "$accounts" ]; then
  if [ "$tool" = "codex" ]; then
    echo "::error::set secret OPENAI_API_KEY (and optionally OPENAI_API_KEY_2)"
  else
    echo "::error::set secret GEMINI_API_KEY (and optionally GEMINI_API_KEY_2)"
  fi
  exit 1
fi

node scripts/devos/role-env.mjs swap "${tool}-${role}" || exit 1
trap 'node scripts/devos/role-env.mjs restore' EXIT

if [ "$tool" = "gemini" ]; then
  export GEMINI_CLI_TRUST_WORKSPACE=true
  mkdir -p "$HOME/.gemini/policies"
  cp devos/roles/gemini/policy.toml "$HOME/.gemini/policies/devos.toml" || exit 1
  cp devos/roles/gemini/settings.json "$HOME/.gemini/settings.json" || exit 1
fi

node scripts/devos/agent-cli.mjs args --tool "$tool" --role "$role" --model "$model" --effort "$effort" --last "$last" > .devos/agent-args.bin || exit 1
ARGS=()
while IFS= read -r -d '' a; do
  ARGS+=("$a")
done < .devos/agent-args.bin

code=1
used=""
restarted=""
if [ "$role" = "builder" ]; then
  for acc in $accounts; do
    if [ "$tool" = "codex" ]; then devos_use_codex "$acc"; else devos_use_gemini "$acc"; fi
    used="$acc"
    while :; do
      left=$(( budget - ($(date +%s) - T0) / 60 ))
      rm -f "$out" "$out.stream.jsonl" "$last"
      bash scripts/devos/agent-watchdog.sh "$left" 10 "$out" "$err" -- "${ARGS[@]}" "$(cat "$prompt")"
      code=$?
      if { [ "$code" = "125" ] || [ "$code" = "126" ]; } && [ -z "$restarted" ] && [ $(( budget - ($(date +%s) - T0) / 60 )) -ge 25 ]; then
        restarted=1
        devos_note "Builder: the ${name} CLI stopped making progress (exit $code: 125 lost connection, 126 stuck); restarted once."
        printf '\n\n**An earlier run of this attempt stopped making progress (lost connection or stuck).** Its partial changes are already in the working tree (`git status`). Verify them against the fence and continue from them; do not redo or duplicate them.\n' >> "$prompt"
        continue
      fi
      break
    done
    if [ "$code" != "0" ] && devos_limited "$out" "$err" "$code"; then
      mkdir -p .devos/limits
      cat "$out" "$err" > ".devos/limits/${tool}-${acc}.txt"
      devos_note "Builder: ${name} account ${acc} reached its usage limit."
      printf '\n\n**This attempt was started on another %s account, which reached its usage limit.** Its partial changes are already in the working tree (`git status`). Verify them against the fence and continue from them; do not redo or duplicate them.\n' "$name" >> "$prompt"
      continue
    fi
    break
  done
else
  for acc in $accounts; do
    if [ "$tool" = "codex" ]; then devos_use_codex "$acc"; else devos_use_gemini "$acc"; fi
    used="$acc"
    rm -f "$out" "$out.stream.jsonl" "$last"
    "${ARGS[@]}" "$(cat "$prompt")" > "$out" 2> "$err"
    code=$?
    node scripts/devos/usage.mjs record --stage reviewer --command "$tool" --model "$model" --out "$out" --code "$code" || true
    if [ "$code" != "0" ] && devos_limited "$out" "$err" "$code"; then
      mkdir -p .devos/limits
      cat "$out" "$err" > ".devos/limits/${tool}-${acc}.txt"
      devos_note "Reviewer: ${name} account ${acc} reached its usage limit."
      continue
    fi
    break
  done
fi

node scripts/devos/agent-cli.mjs normalize --tool "$tool" --raw "$out" --last "$last" --out "$out" || exit 1
node scripts/devos/role-env.mjs restore || exit 1
trap - EXIT
printf 'code=%s\nused=%s\naccounts="%s"\n' "$code" "$used" "$accounts" > "$envfile"
exit 0
