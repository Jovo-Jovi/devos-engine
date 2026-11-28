# Two accounts per agent, with an automatic switch on a usage limit (PR-29). Source it in a step:
#   . scripts/devos/accounts.sh
# PR-90: DEVOS_SCRIPTS names the folder of the runner scripts it calls (default scripts/devos): the publish job sets it
# to its checkout of main, so a review never runs a script from the branch.
#
# Credentials come from the step's environment (mapped from GitHub secrets, never printed). E86 (PR-106): each tool's
# names are in its devos/agents/<id>.json `keys`, which tools.mjs reads (names only, never a value):
#   <keys.env>_1 and <keys.env>_2 (secrets <keys.secret> and <keys.secret>_2), and for a tool with an alternative key
#   <keys.alt.env>_1 and _2 (secrets <keys.alt.secret>, _2): Claude Code's CLAUDE_OAUTH_1 / CLAUDE_APIKEY_1, Cursor's
#   CURSOR_KEY_1, Codex's CODEX_KEY_1, Gemini's GEMINI_KEY_1.
# Your choice, as repository variables (or the cycle's run form):
#   <keys.account> (DEVOS_CURSOR_ACCOUNT, DEVOS_CLAUDE_ACCOUNT, …) = 1 | 2   which account a run starts with (default 1)
#   DEVOS_ACCOUNT_SWITCH = auto | off                   auto (default): on a usage limit, the same run
#                                                       continues on the other account; off: only the chosen one
# Several models per role (PR-64): an agent's fallback_models are tried after its model. devos_slots gives the order:
# the model on each account, then the next model. A limit moves to the next slot; a model the account cannot use
# (devos_unavailable) moves on at once; the run waits for the earliest reset only when no slot could run.

# E86 (PR-106): devos_tool <tool> → the tool's names from its registry file, as devos_t_* variables (id, name, label,
# command, stdin, answer, effort, env, cli, alt_env, alt_cli, unset, account). Names only: no value is read or printed.
# E86b (PR-107): a job's keys come in generic, DEVOS_KEY_1, DEVOS_KEY_2, DEVOS_ALT_1 and DEVOS_ALT_2, which the calling
# job chose by the secrets' names. They become this tool's account slots (<env>_1, <env>_2, <alt_env>_1, <alt_env>_2)
# and are cleared, so nothing started from here sees them.
devos_tool() {
  [ -n "${1:-}" ] || { echo "accounts: no tool named" >&2; return 1; }
  [ "${devos_t_id:-}" = "$1" ] && return 0
  local names n v
  names=$(node "${DEVOS_SCRIPTS:-scripts/devos}/tools.mjs" shell --tool "$1") || return 1
  eval "$names"
  for n in 1 2; do
    eval "v=\"\${DEVOS_KEY_$n:-}\""
    if [ -n "$v" ]; then export "${devos_t_env}_$n=$v"; fi
    eval "v=\"\${DEVOS_ALT_$n:-}\""
    if [ -n "$v" ] && [ -n "$devos_t_alt_env" ]; then export "${devos_t_alt_env}_$n=$v"; fi
  done
  unset DEVOS_KEY_1 DEVOS_KEY_2 DEVOS_ALT_1 DEVOS_ALT_2
}

# devos_accounts <tool> → the account numbers to try, in order, that have a credential.
devos_accounts() {
  local tool="$1" first second order="" a v
  devos_tool "$tool" || return 1
  eval "first=\"\${${devos_t_account}:-1}\""
  case "$first" in 2) second=1 ;; *) first=1; second=2 ;; esac
  for a in "$first" "$second"; do
    eval "v=\"\${${devos_t_env}_$a:-}\""
    if [ -z "$v" ] && [ -n "$devos_t_alt_env" ]; then eval "v=\"\${${devos_t_alt_env}_$a:-}\""; fi
    [ -n "$v" ] || continue
    order="$order $a"
    [ "${DEVOS_ACCOUNT_SWITCH:-auto}" = "off" ] && break
  done
  echo "${order# }"
}

# devos_slots <tool> <model> [<model>…] → "<model>@<account>" pairs in the order to try (PR-64). A model id never holds @.
devos_slots() {
  local tool="$1" accounts m a seen=" " out=""
  shift
  accounts=$(devos_accounts "$tool")
  for m in "$@"; do
    [ -n "$m" ] || continue
    case "$seen" in *" $m "*) continue ;; esac
    seen="$seen$m "
    for a in $accounts; do out="$out $m@$a"; done
  done
  echo "${out# }"
}

# devos_limit_file <tool> <account> <model index, from 1> → where that slot's limit text is kept. The first model keeps
# PR-29's name, so .devos/limits/<tool>-* holds every slot of the tool (limits.mjs earliestNotBefore).
devos_limit_file() {
  if [ "${3:-1}" = "1" ]; then echo ".devos/limits/$1-$2.txt"; else echo ".devos/limits/$1-$2-m$3.txt"; fi
}

# devos_model_index <model> <model>… → the position of the first among the rest, from 1.
devos_model_index() {
  local want="$1" i=0 m
  shift
  for m in "$@"; do
    i=$((i + 1))
    [ "$m" = "$want" ] && { echo "$i"; return 0; }
  done
  echo 1
}

# devos_settle <last outcome> <last limit file> <err file> → when the last slot could not use its model but an earlier
# one was limited, the run ends as limited: that limit's text and a last line naming it join the error file, so the
# caller parks the run until the earliest reset (read from .devos/limits) instead of failing it (PR-64).
devos_settle() {
  if [ "$1" = "unavailable" ] && [ -n "$2" ] && [ -f "$2" ]; then
    cat "$2" >> "$3"
    echo "devos: no model of this agent could run; an earlier one reached its usage limit ($2)" >> "$3"
  fi
}

# devos_use <tool> N → export account N's credential under the name the tool's CLI reads (its keys.cli), or its
# alternative's (keys.alt.cli) when that account has only the alternative. The names in keys.unset are cleared first.
devos_use() {
  local v="" a="" n
  devos_tool "$1" || return 1
  for n in $devos_t_unset; do unset "$n"; done
  eval "v=\"\${${devos_t_env}_$2:-}\""
  if [ -n "$devos_t_alt_env" ]; then eval "a=\"\${${devos_t_alt_env}_$2:-}\""; fi
  if [ -n "$v" ] || [ -z "$devos_t_alt_cli" ]; then export "$devos_t_cli=$v"; else export "$devos_t_alt_cli=$a"; fi
}

# devos_limited <json> <err> [exit] → true when that run stopped on a usage or rate limit.
devos_limited() { node "${DEVOS_SCRIPTS:-scripts/devos}/limit-check.mjs" --json "$1" --err "$2" ${3:+--exit "$3"}; }

# devos_unavailable <json> <err> [exit] → true when that run stopped because the account cannot use its model (PR-64).
devos_unavailable() { node "${DEVOS_SCRIPTS:-scripts/devos}/limit-check.mjs" --unavailable --json "$1" --err "$2" ${3:+--exit "$3"}; }

# PR-87: devos_server_error <json> <err> [exit] → true when a failed run stopped on a temporary server error: an HTTP
# 5xx, a dropped connection, or an error the CLI marks retriable (limits.mjs serverError: the CLI's own error only).
devos_server_error() { node "${DEVOS_SCRIPTS:-scripts/devos}/limit-check.mjs" --server --json "$1" --err "$2" ${3:+--exit "$3"}; }

# PR-87: devos_server_wait <retries so far> → the seconds to wait before the same run is tried again (30, then 60,
# then 120), or nothing and false once a run's three retries are spent. DEVOS_SERVER_WAIT sets the first wait.
devos_server_wait() {
  [ "${1:-0}" -lt 3 ] || return 1
  echo $(( ${DEVOS_SERVER_WAIT:-30} << ${1:-0} ))
}

# devos_note "text" → one line for the PR comment (appended to the verdict or builder summary).
devos_note() { echo "- $1" >> .devos/accounts.md; echo "::notice title=Dev OS::$1"; }

# PR-71: an agent's arguments never hold its prompt. With the whole prompt as an argument, a command the agent ran that
# finds processes by their command line (`pkill -f "next dev"`) matched the agent itself, because its prompt named that
# command. A tool with `stdin` true reads the prompt on standard input; one without gets one line that names the file
# ({prompt} in its command line, devos/agents/<id>.json), as `devos init`'s blueprint run does (E86, PR-106).

# devos_restart <exit> → why a builder run is restarted once in place, or nothing (PR-71). 125 and 126 are the
# watchdog's (a lost connection, stuck); 137 and 143 are a signal from inside the run, such as a command the agent ran
# that stops processes by name, or the runner running out of memory.
devos_restart() {
  case "$1" in
    125|126) printf 'stopped making progress (exit %s: 125 lost connection, 126 stuck)' "$1" ;;
    137|143) printf 'was stopped by a signal (exit %s), most likely by a command it ran that stops processes by name' "$1" ;;
  esac
}
