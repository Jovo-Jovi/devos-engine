#!/usr/bin/env node
const argv = process.argv.slice(2);
const out = (s) => process.stdout.write(`${s}\n`);
const die = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };

if (argv[0] === "--version") {
  out("gh version 2.0.0 (fake)");
  process.exit(0);
}
if (argv[0] === "auth" && argv[1] === "status") {
  if (process.env.DEVOS_GH_SIGNED_OUT === "1") die("gh: not logged in", 1);
  const scopes = process.env.DEVOS_GH_MISSING_SCOPES === "1"
    ? "'gist', 'read:org', 'repo'"
    : "'gist', 'repo', 'workflow'";
  out("github.com");
  out("  ✓ Logged in to github.com account octodev (keyring)");
  out("  - Active account: true");
  out("  - Token: gho_****");
  out(`  - Token scopes: ${scopes}`);
  process.exit(0);
}
if (argv[0] === "api" && argv[1] === "user") {
  if (process.env.DEVOS_GH_BAD_TOKEN === "1") die("gh: REST API 401 (Bad credentials)", 1);
  out(JSON.stringify({ login: process.env.DEVOS_GH_LOGIN || "octodev" }));
  process.exit(0);
}
die(`fake gh: unhandled command ${argv.join(" ")}`, 1);
