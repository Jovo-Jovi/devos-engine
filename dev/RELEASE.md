# Release in place (decision D-E10)

`devos-engine` is the public repository developers take DEV_OS from. It keeps its whole history, `dev/` included,
by the owner's choice of 2026-10-26 (D-E10). Genuinely private material added from now on goes to a private repository,
never into this one.

## What ships

- **With `npx` or `npm link`:** the `files` of `package.json`: `bin/`, `lib/`, `payload/`, `LICENSE`, `LICENSES.md`,
  `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `SECURITY.md` and `README.md`.
- **The ZIP of a GitHub Release, and a clone:** the whole repository at its tag.

## Each release (the owner)

1. **Date it.** Set the date of the version's heading in `CHANGELOG.md` (`## X.Y.Z — YYYY-MM-DD`), then commit
   `Release vX.Y.Z` on `main`.
2. **The release check.** `node tools/release-check.mjs` prints `release check: ok (N files scanned)`. It checks:
   - the versions agree;
   - the changelog heading is dated;
   - the licence and its notice;
   - `SECURITY.md`;
   - D-E11 is confirmed;
   - no secret in a shipped file.
3. **The history.** `gitleaks git --redact --no-banner .` (gitleaks 8.24 or newer) over the whole history.
   - Only secret *names* may appear, never values (on 2026-10-26: 11 hits, every one a name in a workflow or setup file).
   - A real secret is revoked at its provider first, then removed from history.
4. **Windows.** Actions → `engine-ci` → *Run workflow* on `main`; both test jobs are green.
5. **The first release only:**
   - make the repository public (Settings → General → Change repository visibility);
   - turn on private vulnerability reporting (Settings → Code security), which `SECURITY.md` points to.
6. **Tag and publish.**
   - `git tag vX.Y.Z` and `git push origin vX.Y.Z`;
   - then `gh release create vX.Y.Z --title "DEV_OS Engine vX.Y.Z" --notes "What changed: CHANGELOG.md."`. GitHub attaches
     the source ZIP.

## Not in a release

Nothing secret, ever. No credential, admin access or source of the private DEV_OS Control Tower. The copies of the
Tower's and the pilot's configuration in `dev/sources/` are the one exception the owner accepted (D-E10).
