#!/usr/bin/env node
// Cursor beforeShellExecution hook: defence in depth for PR-04 and the builder's surface.
// The runner's checkout has no git credential and its surface guard runs after the builder, so
// this hook is a second line, mainly for manual IDE sessions.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try { cmd = JSON.parse(raw).command ?? ""; } catch { /* no input */ }
  const automated = process.env.DEVOS_AUTOMATED === "1";
  const rules = [
    [/\bgit\s+push\b.*(--force|-f\b|\+)/, "Force pushes are never allowed."],
    [/\bgit\s+push\b.*\bmain\b/, "Never push to main; push the task branch with an explicit refspec."],
    [/\bgh\s+pr\s+(merge|create|close)\b/, "The builder never opens, merges or closes PRs (Dev OS §2)."],
    [/\bsudo\b/, "No sudo."],
    [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/, "Refusing to delete a root or home directory."],
    [/\bcurl\b[^|]*\|\s*(ba)?sh\b/, "No piping downloads into a shell."],
    [/\bnpm\s+(i|install|add)\b(?!.*\s-g\b)/, "This repo uses pnpm; use `pnpm add`."],
    [/\b(supabase\s+db\s+push|vercel\s+--prod|vercel\s+deploy)\b/, "No deploys or database pushes from the builder."],
  ];
  if (automated) {
    rules.push([/\bgit\s+(add|commit|push|reset|checkout|rebase|merge)\b/, "Automated run: the runner owns git (PR-04)."]);
    rules.push([/\bgh\b/, "Automated run: no gh (PR-04)."]);
  }
  for (const [re, why] of rules) {
    if (re.test(cmd)) {
      process.stdout.write(JSON.stringify({ permission: "deny", user_message: `Dev OS policy: ${why}`, agent_message: `Blocked by Dev OS policy: ${why} If the fence needs this, HALT and report.` }));
      return;
    }
  }
  process.stdout.write(JSON.stringify({ permission: "allow" }));
});
