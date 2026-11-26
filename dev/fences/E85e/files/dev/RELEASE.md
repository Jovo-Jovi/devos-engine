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
3. **The history.** `gitleaks git --redact --no-banner .` (gitleaks 8.24 or newer) over the whole history prints
   `no leaks found`.
   - `.gitleaks.toml` allows two things that are never credentials: the content hashes in a fence's `before.json`,
     and the *names* of secrets (`ANTHROPIC_API_KEY_2`, `secrets.CURSOR_API_KEY`). A value is still reported.
   - A real secret is revoked at its provider first, then removed from history.
4. **Windows.** Actions → `engine-ci` → *Run workflow* on `main`; both test jobs are green.
   - The push of step 1 has its own `engine-ci` run, and it must be green too.
   - The two runs no longer cancel each other (E32).
5. **The first release only:**
   - make the repository public (Settings → General → Change repository visibility);
   - turn on private vulnerability reporting (Settings → Code security), which `SECURITY.md` points to.
6. **Tag and publish.**
   - `git tag vX.Y.Z` and `git push origin vX.Y.Z`;
   - then `gh release create vX.Y.Z --title "DEV_OS Engine vX.Y.Z" --notes "What changed: CHANGELOG.md."`. GitHub attaches
     the source ZIP.

## Release candidates (D-E19)

Until 1.14.0, tasks merge into `next`, and `main` keeps the last stable release. `next` names the first candidate,
`1.14.0-rc.1`, and each task adds its changelog lines under that heading. The owner runs no live check per task
(D-E19, amended): the first candidate is published for E91, the acceptance task, which runs every live check. A later
candidate, when E91 needs one, sets `X.Y.Z-rc.N` in `package.json`, `README.md`, the manifest and the changelog's first
heading.

1. **Date it, on `next`.** Set the date of the candidate's heading in `CHANGELOG.md` (`## X.Y.Z-rc.N — YYYY-MM-DD`),
   then commit `Release vX.Y.Z-rc.N` on `next`.
2. **The checks.** `node tools/release-check.mjs` prints `release check: ok (N files scanned) · X.Y.Z-rc.N is a release
   candidate: publish it as a prerelease, from next (dev/RELEASE.md)`. The history and Windows checks are as for a
   release (steps 3 and 4 above), on `next`.
3. **Tag and publish it as a prerelease.**
   - `git tag vX.Y.Z-rc.N` and `git push origin vX.Y.Z-rc.N`;
   - then `gh release create vX.Y.Z-rc.N --prerelease --title "DEV_OS Engine vX.Y.Z-rc.N" --notes "A release candidate,
     for test projects. What changed: CHANGELOG.md."`.

   GitHub's latest release stays the last stable one, so the project page never offers the candidate.
4. **A test project takes it.** With the engine folder at the tag (right after step 3, `next` is that commit), run
   `devos upgrade --pre` in the test project and merge its pull request. E91's live checks run there.

- **A plain `devos upgrade` refuses a candidate**, and a project on a candidate takes the release with a plain
  `devos upgrade`.
- **A fix developers need before 1.14.0** is a release from `main`, as above, and is merged into `next` too.
- **The stable 1.14.0.** When the acceptance task (E91) passes on the latest candidate, `next` merges into `main`, and
  `main` is released as above. E91 writes those steps.

## Not in a release

Nothing secret, ever. No credential, admin access or source of the private DEV_OS Control Tower. The copies of the
Tower's and the pilot's configuration in `dev/sources/` are the one exception the owner accepted (D-E10).
