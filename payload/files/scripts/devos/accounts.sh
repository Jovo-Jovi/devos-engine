# Two accounts per agent, with an automatic switch on a usage limit (PR-29). Source it in a step:
#   . scripts/devos/accounts.sh
#
# Credentials come from the step's environment (mapped from GitHub secrets, never printed):
#   Cursor : CURSOR_KEY_1 (secret CURSOR_API_KEY)            · CURSOR_KEY_2 (secret CURSOR_API_KEY_2)
#   Claude : CLAUDE_OAUTH_1 / CLAUDE_APIKEY_1 (CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY)
#            CLAUDE_OAUTH_2 / CLAUDE_APIKEY_2 (CLAUDE_CODE_OAUTH_TOKEN_2 / ANTHROPIC_API_KEY_2)
#   Codex  : CODEX_KEY_1 (secret OPENAI_API_KEY)             · CODEX_KEY_2 (secret OPENAI_API_KEY_2)
#   Gemini : GEMINI_KEY_1 (secret GEMINI_API_KEY)            · GEMINI_KEY_2 (secret GEMINI_API_KEY_2)
# Your choice, as repository variables (or the cycle's run form):
#   DEVOS_CURSOR_ACCOUNT, DEVOS_CLAUDE_ACCOUNT, DEVOS_CODEX_ACCOUNT, DEVOS_GEMINI_ACCOUNT = 1 | 2   which account a run starts with (default 1)
#   DEVOS_ACCOUNT_SWITCH = auto | off                   auto (default): on a usage limit, the same run
#                                                       continues on the other account; off: only the chosen one

# devos_accounts cursor|claude|codex|gemini → the account numbers to try, in order, that have a credential.
devos_accounts() {
  local tool="$1" first second order="" a
  case "$tool" in
    cursor) first="${DEVOS_CURSOR_ACCOUNT:-1}" ;;
    codex) first="${DEVOS_CODEX_ACCOUNT:-1}" ;;
    gemini) first="${DEVOS_GEMINI_ACCOUNT:-1}" ;;
    *) first="${DEVOS_CLAUDE_ACCOUNT:-1}" ;;
  esac
  case "$first" in 2) second=1 ;; *) first=1; second=2 ;; esac
  for a in "$first" "$second"; do
    case "$tool" in
      cursor) eval "[ -n \"\${CURSOR_KEY_$a:-}\" ]" || continue ;;
      codex) eval "[ -n \"\${CODEX_KEY_$a:-}\" ]" || continue ;;
      gemini) eval "[ -n \"\${GEMINI_KEY_$a:-}\" ]" || continue ;;
      *) eval "[ -n \"\${CLAUDE_OAUTH_$a:-}\${CLAUDE_APIKEY_$a:-}\" ]" || continue ;;
    esac
    order="$order $a"
    [ "${DEVOS_ACCOUNT_SWITCH:-auto}" = "off" ] && break
  done
  echo "${order# }"
}

# devos_use_cursor N / devos_use_claude N / devos_use_codex N / devos_use_gemini N → export that account's credential for the CLI.
devos_use_cursor() { eval "export CURSOR_API_KEY=\"\${CURSOR_KEY_$1}\""; }
devos_use_claude() {
  unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
  local o k
  eval "o=\"\${CLAUDE_OAUTH_$1:-}\"; k=\"\${CLAUDE_APIKEY_$1:-}\""
  if [ -n "$o" ]; then export CLAUDE_CODE_OAUTH_TOKEN="$o"; else export ANTHROPIC_API_KEY="$k"; fi
}
devos_use_codex() {
  unset OPENAI_API_KEY
  eval "export CODEX_API_KEY=\"\${CODEX_KEY_$1}\""
}
devos_use_gemini() { eval "export GEMINI_API_KEY=\"\${GEMINI_KEY_$1}\""; }

# devos_limited <json> <err> [exit] → true when that run stopped on a usage or rate limit.
devos_limited() { node scripts/devos/limit-check.mjs --json "$1" --err "$2" ${3:+--exit "$3"}; }

# devos_note "text" → one line for the PR comment (appended to the verdict or builder summary).
devos_note() { echo "- $1" >> .devos/accounts.md; echo "::notice title=Dev OS::$1"; }
