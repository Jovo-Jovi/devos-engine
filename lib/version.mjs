// E85d (D-E19): the engine's versions. A release is X.Y.Z; a release candidate is X.Y.Z-rc.N, a GitHub prerelease
// that a test project takes with `devos upgrade --pre`. Anything else (a beta, a hand-edited version) is neither.
// One order for `devos upgrade`, the project page and the release check: X.Y.Z-rc.1 < X.Y.Z-rc.2 < X.Y.Z < X.Y.(Z+1).
// lib/ui/app.js keeps a copy of compareVersions for the page; test/versions.test.mjs holds the two to one table.

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.([1-9]\d*))?$/;

/** { major, minor, patch, rc } for a release (rc null) or a release candidate, or null for anything else. */
export function parseVersion(value) {
  const match = VERSION.exec(String(value ?? ""));
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  return { major, minor, patch, rc: match[4] === undefined ? null : Number(match[4]) };
}

/** A release: X.Y.Z. */
export function isRelease(value) {
  const parsed = parseVersion(value);
  return parsed !== null && parsed.rc === null;
}

/** A release candidate: X.Y.Z-rc.N. */
export function isCandidate(value) {
  const parsed = parseVersion(value);
  return parsed !== null && parsed.rc !== null;
}

/** -1, 0 or 1; null when either is neither a release nor a release candidate. A candidate comes before its release. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (a.rc === b.rc) return 0;
  if (a.rc === null) return 1;
  if (b.rc === null) return -1;
  return a.rc < b.rc ? -1 : 1;
}
