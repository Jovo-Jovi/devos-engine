# Licences

DEV_OS holds files under four licences. For any file, the first rule below that matches it decides.

| Rule | Files | Licence | Text |
|---|---|---|---|
| 1 | The fonts of the guided page, `lib/ui/fonts/` | `OFL-1.1` | `lib/ui/fonts/OFL.txt` |
| 2 | The third-party files of the vendored skills in `payload/files/devos/skills/`: every file that `devos/skills/manifest.json` marks `"origin": "source"` | each skill's own: `MIT`, `Apache-2.0`, `CC-BY-4.0` or `CC-BY-SA-4.0` | the licence and notice files in the skill's folder; `THIRD_PARTY_NOTICES.md` |
| 3 | Every other file DEV_OS installs into a project: `payload/files/` and `payload/templates/` | `MIT` | `payload/files/devos/LICENSE.md`, installed as `devos/LICENSE.md` |
| 4 | Everything else: the `devos` command (`bin/`, `lib/`), the contract (`payload/contract/`), the tests, the tools and these documents | `PolyForm-Shield-1.0.0` | `LICENSE` |

## What this means

- **The engine** (rule 4) may be used for any purpose, commercial work included, except to provide a product that
  competes with it, or with a product its licensor provides using it. The text in `LICENSE` is what binds.
- **The files installed into your project** (rule 3) are yours to keep, change and ship under your project's own
  licence, with the MIT notice in `devos/LICENSE.md`.
- **Third-party files** (rules 1 and 2) keep their own licences, copyright notices and attributions. Rule 2's
  CC-BY-SA-4.0 files are shared alike: a changed copy stays under CC-BY-SA-4.0.

`THIRD_PARTY_NOTICES.md` lists every third-party work, its source and its notices. The engine itself has no
dependency.
