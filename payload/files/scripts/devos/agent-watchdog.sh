#!/usr/bin/env bash
# Run an agent CLI with a watchdog, so a hung run ends cleanly inside its step instead of hitting the
# step timeout (which skips the commit, the PR and the park/halt comment: "nothing happened").
#
# Usage: agent-watchdog.sh <budget-min> <stall-min> <stdout-file> <stderr-file> -- <command...>
# Exit:  the command's own exit code, or
#        124  the time slice ran out while the run was still making progress (the work stays in the
#             tree; the cycle continues it in a fresh slice)
#        125  the CLI reported a lost connection and nothing changed for <stall-min> minutes
#             (a "devos-stall:" line is appended to the stderr file)
#        126  nothing changed at all (tree, stdout, stderr) for DEVOS_IDLE_STOP minutes (default 30):
#             the run is stuck (a "devos-stuck:" line is appended to the stderr file)
# Progress: every DEVOS_REPORT_EVERY seconds (default 300) and at the end, DEVOS_WATCHDOG_REPORT (a
# command) is called with <elapsed-min> <files-changed> <idle-min> [final text].
# Activity is any of: the tree changing, the CLI writing output, or the run's processes using CPU
# (DEVOS_CPU_ACTIVE seconds or more per check: a build or a test suite is work, a hung server is not).
# With `--output-format stream-json` the CLI prints one line per message and tool call: the last
# action is kept in <stdout-dir>/builder-last-action (shown in the progress comment and named when
# the run is stopped), and at the end the stream is saved as <stdout>.stream.jsonl and <stdout> is
# rewritten to the final result object, the same shape `--output-format json` prints.
# The agent never sees DEVOS_PROGRESS_TOKEN: it is removed from the child's environment.
# Usage (PR-52): with DEVOS_USAGE_STAGE set, every run ends with one line in the usage record
# (scripts/devos/usage.mjs record), its tool and model read from the command line.
set -u
budget=$1; stall=$2; out=$3; err=$4; shift 4
tick=${DEVOS_WATCHDOG_TICK:-20}; unit=${DEVOS_WATCHDOG_UNIT:-60}   # tests shrink these
idle_stop=${DEVOS_IDLE_STOP:-30}; report_every=${DEVOS_REPORT_EVERY:-300}; cpu_active=${DEVOS_CPU_ACTIVE:-5}
last_file="$(dirname "$out")/builder-last-action"
report=${DEVOS_WATCHDOG_REPORT:-}
[ "${1:-}" = "--" ] && shift
usage_command=${1:-}; usage_model=auto; prev=""
for a in "$@"; do [ "$prev" = "--model" ] && usage_model=$a; prev=$a; done

# A stream kept from an earlier run (another tool) never stands for this one.
rm -f "$out.stream.jsonl"
env -u DEVOS_PROGRESS_TOKEN -u GH_TOKEN -u GITHUB_TOKEN setsid "$@" > "$out" 2> "$err" &
pid=$!
start=$(date +%s); last_change=$start; last_sig=""; last_report=$start; last_cpu=0

stop() { kill -TERM -- "-$pid" 2>/dev/null; sleep 5; kill -KILL -- "-$pid" 2>/dev/null; wait "$pid" 2>/dev/null; }
files() { git status --porcelain 2>/dev/null | wc -l | tr -d ' '; }
# CPU seconds used so far by every process of the run's session (the CLI and what it started).
cpu() { ps -s "$pid" -o times= 2>/dev/null | awk '{s+=$1} END{print s+0}'; }
# The CLI's last action, read from its stream-json output (empty for other output formats).
action() {
  node -e '
    const fs=require("fs"); let t=""; try { t=fs.readFileSync(process.argv[1],"utf8"); } catch { process.exit(0); }
    const open=new Map(); let last="";
    const say=(e)=>{ const tc=e.tool_call||{}; const k=Object.keys(tc)[0]||"tool"; const v=tc[k]||{};
      const a=v.args||v.arguments||{}; const o=typeof a==="string"?a:(a.command||a.path||a.pattern||a.query||a.url||JSON.stringify(a));
      const name=(v.name||k).replace(/ToolCall$/,"");
      return (name+": "+String(o)).replace(/[\r\n`]+/g," ").slice(0,160); };
    for (const l of t.split("\n").slice(-2000)) { let e; try { e=JSON.parse(l); } catch { continue; }
      if (e.type==="tool_call"&&e.subtype==="started") { open.set(e.call_id,say(e)); last="running "+say(e); }
      else if (e.type==="tool_call"&&e.subtype==="completed") { open.delete(e.call_id); last="finished "+say(e); }
      else if (e.type==="assistant") { last="wrote a message"; } }
    const p=[...open.values()].pop(); process.stdout.write(p?"running "+p:last);
  ' "$out" 2>/dev/null
}
# Stream-json: keep the whole stream, leave the final result object where `json` would have put it.
unstream() {
  grep -q '^{"type":' "$out" 2>/dev/null || return 0
  cp "$out" "$out.stream.jsonl"
  local r; r=$(grep '"type":"result"' "$out.stream.jsonl" | tail -n 1)
  if [ -n "$r" ]; then printf '%s\n' "$r" > "$out"; else tail -n 200 "$out.stream.jsonl" > "$out"; fi
}
say() {  # elapsed files idle [final]
  [ -n "$report" ] || return 0
  timeout 30 $report "$@" >/dev/null 2>&1 || true
}
finish() {  # code final-text
  local now; now=$(date +%s)
  action > "$last_file" 2>/dev/null || true
  say $(( (now - start) / unit )) "$(files)" $(( (now - last_change) / unit )) "$2"
  unstream
  if [ -n "${DEVOS_USAGE_STAGE:-}" ] && [ -f scripts/devos/usage.mjs ]; then
    node scripts/devos/usage.mjs record --stage "$DEVOS_USAGE_STAGE" --command "$usage_command" --model "$usage_model" \
      --out "$out" --code "$1" --seconds "$(( now - start ))" || true
  fi
  exit "$1"
}

say 0 "$(files)" 0
while kill -0 "$pid" 2>/dev/null; do
  sleep "$tick"
  now=$(date +%s)
  sig="$(git status --porcelain 2>/dev/null | md5sum)|$(git diff 2>/dev/null | md5sum)|$(stat -c %s "$out" "$err" 2>/dev/null | tr '\n' ' ')"
  if [ "$sig" != "$last_sig" ]; then last_sig=$sig; last_change=$now; fi
  c=$(cpu); if [ "${c:-0}" -ge $(( last_cpu + cpu_active )) ]; then last_change=$now; fi; last_cpu=${c:-0}
  action > "$last_file" 2>/dev/null || true
  idle=$(( (now - last_change) / unit ))

  if [ $(( now - last_report )) -ge "$report_every" ]; then
    say $(( (now - start) / unit )) "$(files)" "$idle"; last_report=$now
  fi
  if [ $(( now - start )) -ge $(( budget * unit )) ]; then
    echo "devos-watchdog: stopped after the ${budget}-minute builder budget" >> "$err"
    stop; finish 124 "⏱️ **time slice used up while working** — the work is saved on the branch; the next slice continues it"
  fi
  # A lost connection that is still the CLI's last word, with nothing changing: restartable.
  last_line=$(grep -v '^[[:space:]]*$' "$err" 2>/dev/null | tail -n 1)
  if printf '%s' "$last_line" | grep -qiE 'connection lost|reconnecting|retry attempt' \
     && [ $(( now - last_change )) -ge $(( stall * unit )) ]; then
    echo "devos-stall: the CLI lost its connection and made no progress for ${stall} minutes" >> "$err"
    stop; finish 125 "🔌 **lost its connection to Cursor** — stopped after ${stall} quiet minutes"
  fi
  # Nothing at all changed for a long time: stuck, whatever the reason.
  if [ $(( now - last_change )) -ge $(( idle_stop * unit )) ]; then
    act=$(action); echo "devos-stuck: nothing changed in the tree, the CLI output or the CPU use for ${idle_stop} minutes${act:+ (last action: $act)}" >> "$err"
    stop; finish 126 "🔴 **stuck** — nothing changed for ${idle_stop} min; the run was stopped${act:+ while it was $act}"
  fi
done
wait "$pid"; code=$?
finish "$code" "✅ **builder finished** (exit $code) — next: checks and review"
