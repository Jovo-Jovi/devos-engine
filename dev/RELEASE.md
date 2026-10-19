# Clean release (decision D-E10)

The public `devos-engine` is the only source developers take DEV_OS from. It must read as a product, not as the
workshop it was built in.

## What ships

| Path | Ships | Note |
|---|---|---|
| `bin/`, `lib/` | yes | the `devos` command |
| `payload/` | yes | the method installed into projects; already project-neutral after E03 (specifics scan `0 0`, allow-list only for the registry operator and URL) |
| `test/` | yes, cleaned | only tests of the engine itself; fixtures renamed to neutral examples (`example-a`, `example-b`), no other project's name, key, hostname or config copy |
| `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md` | yes | written in E10 |
| `package.json` | yes | `files` already limits what `npx` fetches |
| `dev/` | **no** | fences, reviews, reports, plan, decisions, ledger, `sources/` |
| `tools/extract.mjs`, `tools/verify-source.mjs`, `tools/sources.mjs`, `tools/find-specifics.mjs`, `tools/specifics-allow.json` | **no** | they name and read the reference repositories; `tools/build-manifest.mjs` and `tools/stage.mjs` stay if tests need them |
| `CLAUDE.md`, `.claude/`, `.cursor/` at the root | **no** | they drive the engine's own build, not a developer's project (the project versions live in `payload/`) |

## How the release is made (E10)

1. `tools/release-check.mjs` (built in E10, shipped only in the private build repo) fails if any shipped path matches
   the reference patterns outside `specifics-allow.json`, if `dev/` or a non-shipping tool is in the release tree, or if
   a test fixture names another project.
2. The release tree is produced from a tagged commit of this build repository and published as **fresh history**
   (one commit per release: `DEV_OS Engine vX.Y.Z`) to the public repository, so the build history, fences and source
   pins are not reachable from it.
3. This build repository stays **private** (renamed `devos-engine-build` at E10, or kept as is with the public one
   created beside it — owner's choice at E10). Later releases repeat steps 1–2.
4. The GitHub Release carries the ZIP of the same tree.

Until E10, nothing here changes how tasks are built: the build needs `dev/`, the pins and the extraction tools.
