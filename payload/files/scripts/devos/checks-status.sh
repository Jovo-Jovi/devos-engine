#!/usr/bin/env bash
# Post the runner's checks as the commit status devos/checks (PR-25), so every PR shows them before
# merge, with no separate workflow to approve. Reads .devos/ci-results.json.
# Usage: GH_TOKEN=… REPO=owner/name bash scripts/devos/checks-status.sh <sha>
set -u
sha="$1"
read -r state desc < <(node -e '
  let r = {};
  try { r = require("./.devos/ci-results.json"); } catch {}
  const names = (r.results || []).filter((x) => x.required).map((x) => x.name);
  if (!r.results) console.log("failure no check results");
  else if (r.all_required_passed) console.log(`success Passed: ${names.join(", ")}`.slice(0, 139));
  else console.log(`failure Failed: ${(r.failed_required || []).join(", ")}`.slice(0, 139));')
gh api "repos/${REPO}/statuses/${sha}" -f state="$state" -f context=devos/checks -f description="$desc" \
  -f target_url="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-}" >/dev/null \
  && echo "devos/checks → $state: $desc" || echo "::warning::could not post devos/checks"
