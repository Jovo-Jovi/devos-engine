# Third-party notices

DEV_OS ships the third-party works below, whole or in part. Each keeps its own licence: the licence and notice files
stay beside the work and go with it. None of them is under DEV_OS's own licences (`LICENSES.md`).

## Fonts of the guided page (`devos ui`)

| Work | Files | Licence | Copyright | Source |
|---|---|---|---|---|
| IBM Plex Sans, IBM Plex Serif and IBM Plex Mono (Latin subsets, woff2) | `lib/ui/fonts/plex-*.woff2` (5 files) | `OFL-1.1`, in `lib/ui/fonts/OFL.txt` | Copyright 2017, 2019, 2020 IBM Corp. | the @fontsource 5.3.0 packages |

## Vendored skills (installed into each project under `devos/skills/`)

Each skill sits in `payload/files/devos/skills/<folder>/` and is installed as `devos/skills/<folder>/`. Its source is
pinned to the commit below, and `devos/skills/manifest.json` lists every file it ships, what was left out and what
changed. The `DEVOS-NOTES.md` and `ATTRIBUTION.md` files in these folders are DEV_OS's own (MIT).

| Folder | Source | Licence | Copyright | Licence and notice files |
|---|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) @ `dbd4588f9e` | `Apache-2.0` | Anthropic (the licence file names no holder) | `LICENSE.txt` |
| `web-interface-guidelines` | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) @ `434b7f9136` | `MIT` | Copyright (c) 2025 Vercel Labs | `LICENSE` |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) @ `2d228630ba` | `MIT` | Copyright (c) 2026 Emil Kowalski | `LICENSE` |
| `review-animations` | [emilkowalski/skills](https://github.com/emilkowalski/skills) @ `2d228630ba` | `MIT` | Copyright (c) 2026 Emil Kowalski | `LICENSE` |
| `fixing-accessibility` | [ibelick/ui-skills](https://github.com/ibelick/ui-skills) @ `55363c3050` | `MIT` | Copyright (c) 2026 Julien Thibeaut | `LICENSE` |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) @ `936867543a` | `Apache-2.0` | Copyright 2025 Paul Bakaus | `LICENSE`, `NOTICE.md` |
| `taste` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) @ `6010f91a99` | `MIT` | Copyright (c) 2026 Leonxlnx | `LICENSE` |
| `owasp-cheat-sheets` | [OWASP/CheatSheetSeries](https://github.com/OWASP/CheatSheetSeries) @ `a8ecf45fa8` | `CC-BY-SA-4.0` | the OWASP Cheat Sheet Series contributors (the licence file names no holder) | `LICENSE.md`, `ATTRIBUTION.md` |
| `owasp-api-top10-2023` | [OWASP/API-Security](https://github.com/OWASP/API-Security) @ `33cea37b2f` | `CC-BY-SA-4.0` | the OWASP API Security Project (leaders named in 0x00-notice.md) | `LICENSE`, `0x00-notice.md`, `ATTRIBUTION.md` |
| `google-aips` | [googleapis/aip](https://github.com/googleapis/aip) @ `2ccc61a4e0` | `CC-BY-4.0 AND Apache-2.0` | the AIP authors (the licence file names no holder) | `LICENSE.md`, `ATTRIBUTION.md` |
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) @ `544bfc56c8` | `MIT` | Copyright (c) 2026 Supabase | `LICENSE` |
| `supabase` | [supabase/agent-skills](https://github.com/supabase/agent-skills) @ `544bfc56c8` | `MIT` | Copyright (c) 2026 Supabase | `LICENSE` |
| `superpowers` | [obra/superpowers](https://github.com/obra/superpowers) @ `2ce8aa15d0` | `MIT` | Copyright (c) 2025 Jesse Vincent | `LICENSE` |
| `playwright-best-practices` | [microsoft/playwright](https://github.com/microsoft/playwright) @ `cfe490d941` | `Apache-2.0` | Copyright (c) Microsoft Corporation (NOTICE) | `LICENSE`, `NOTICE` |
| `azure-cloud-patterns` | [MicrosoftDocs/architecture-center](https://github.com/MicrosoftDocs/architecture-center) @ `b60c2b4526` | `CC-BY-4.0 AND MIT` | Microsoft and the contributors (ThirdPartyNotices) | `LICENSE`, `LICENSE-CODE`, `ThirdPartyNotices`, `ATTRIBUTION.md` |
| `twelve-factor` | [heroku/12factor](https://github.com/heroku/12factor) @ `1385d2c80b` | `MIT` | Copyright (c) 2012 Adam Wiggins | `LICENSE` |
| `github-actions-security` | [github/docs](https://github.com/github/docs) @ `02c25d1636` | `CC-BY-4.0 AND MIT` | GitHub and the contributors (LICENSE-CODE: Copyright 2026 GitHub) | `LICENSE`, `LICENSE-CODE`, `ATTRIBUTION.md` |
| `opentelemetry-concepts` | [open-telemetry/opentelemetry.io](https://github.com/open-telemetry/opentelemetry.io) @ `bb4e55d88b` | `CC-BY-4.0 AND Apache-2.0` | the OpenTelemetry authors (the licence files name no holder) | `LICENSE`, `LICENSE-CODE`, `ATTRIBUTION.md` |

## Referenced, not shipped

The external skills and the libraries named in `docs/method/DESIGN_METHOD.md` are installed by the developer from
their own sources, under their own licences. DEV_OS ships no copy of them.
