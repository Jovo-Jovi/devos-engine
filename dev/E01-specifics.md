# Tower- and pilot-specific lines in the payload (input for E03)

| Installed path | Line | Text |
| .claude/commands/devos-new-project.md | 48 | Where to run this: in the **new** project's repository, not in the pilot. Copy this command to |
| .claude/commands/devos-new-project.md | 49 | `~/.claude/commands/` so it is available everywhere. Then copy the pilot's method files into the |
| .claude/commands/devos-new-project.md | 63 | pilot's `.claude/settings.json` **last**, after the bootstrap is written: its deny rules lock the |
| .cursor/rules/10-security-data.mdc | 8 | - No contact data (phone, email, address) as literals in source: the Tower has none (docs/CONTENT_MODEL.md). `guard:lite |
| .cursor/rules/30-vocabulary.mdc | 6 | - Use the qualified names: event → `StepEvent` (type), `stepEvents` (collection); log → `WebhookDelivery` or `Observatio |
| .github/workflows/devos-deploy.yml | 223 | # Tower ADR-004: no bypass secret. Generated deployment URLs sit behind Vercel |
| .github/workflows/devos-deploy.yml | 224 | # Authentication (Standard), so production is probed on its own domain: vars.TOWER_URL when |
| .github/workflows/devos-deploy.yml | 225 | # set, else the production hostname (public, not a secret; devos/setup.json tower-url). |
| .github/workflows/devos-deploy.yml | 226 | URL: ${{ (inputs.target \|\| 'production') == 'production' && (vars.TOWER_URL \|\| 'https://devos-control-tower.vercel.app') |
| .github/workflows/devos-intake.yml | 66 | # A planning run reads the whole document set at Opus extra-high effort; the pilot's first took |
| devos/prompts/builder.md | 1 | You are the BUILDER surface (Cursor, {{BUILDER_MODEL}}, effort {{BUILDER_EFFORT}}) for PILOT under the Dev OS v2 method, |
| devos/prompts/intake.md | 1 | You are the REVIEWER surface for PILOT under the Dev OS v2 method (`CLAUDE.md` applies), acting on a |
| devos/prompts/method.md | 1 | You are the REVIEWER surface for PILOT under the Dev OS v2 method (`CLAUDE.md` applies), acting on a |
| devos/prompts/reviewer.md | 1 | You are the REVIEWER surface for PILOT under the Dev OS v2 method (`CLAUDE.md` applies in full). |
| devos/prompts/revise.md | 1 | You are the REVIEWER surface for PILOT under the Dev OS v2 method (`CLAUDE.md` applies). The human |
| devos/setup.json | 2 | "$comment": "PR-27. Everything outside the repository the method needs for the Tower: GitHub secrets and variables, and  |
| devos/setup.json | 13 | "cursor.com → Dashboard → Integrations → API Keys → create a key named devos-tower.", |
| devos/setup.json | 40 | "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → Generate a NEW token (never reuse the  |
| devos/setup.json | 41 | "Repository access: only devos-control-tower. Permissions (Read and write): Contents, Pull requests, Workflows, Issues,  |
| devos/setup.json | 53 | "vercel.com → create the project `devos-control-tower` from this repository; Settings → Deployment Protection = Standard |
| devos/setup.json | 54 | "Account Settings → Tokens → create `devos-tower` (scope: your team). Project → Settings → General: copy the Project ID; |
| devos/setup.json | 55 | "Add the three as repository secrets. Do NOT create a Protection Bypass for Automation secret (Tower ADR-004)." |
| devos/setup.json | 76 | "Supabase → New project `devos-control-tower` (after the M0 capacity check: paid plan, second organisation or co-locatio |
| devos/setup.json | 103 | "id": "tower-url", |
| devos/setup.json | 104 | "title": "The Tower's production URL (OIDC audience, host check)", |
| devos/setup.json | 106 | "names": ["TOWER_URL"], |
| devos/setup.json | 110 | "Vercel → Environment Variables → **Production**: `TOWER_URL` = `https://<the production hostname>` with no trailing sla |
| devos/setup.json | 111 | "A custom domain later = a new audience: change it here and in every project's `tower.url` together." |
| devos/setup.json | 116 | "title": "GitHub App `devos-control-tower` webhook secret", |
| devos/setup.json | 123 | "GitHub → Settings → Developer settings → GitHub Apps → New: name `devos-control-tower`; Webhook URL `<TOWER_URL>/api/gi |
| devos/setup.json | 136 | "steps": ["Repository variable `DEVOS_GITHUB_APP` = `true` once the App is installed on the pilot and the Tower (T03 rea |
| docs/method/AUTOMATION.md | 168 | Other scripts: `scripts/scene/art.mjs` is product code of the Tower (T04): it prints the scene-art prompts, checks gener |
| docs/method/AUTOMATION.md | 212 | (the storage and Firestore modules are inactive in the Tower; their names stay for the method). |
| docs/method/AUTOMATION.md | 213 | The Tower has **no** Vercel Protection Bypass for Automation secret (Tower ADR-004). |
| docs/method/AUTOMATION.md | 216 | `SUPABASE_SECRET_KEY` (Sensitive), `TOWER_URL` (the production URL, no trailing slash: the OIDC |
| docs/method/AUTOMATION.md | 217 | audience every reporting project uses as `tower.url` and the host the machine routes accept), |
| docs/method/AUTOMATION.md | 218 | `GITHUB_WEBHOOK_SECRET` (Sensitive; the GitHub App `devos-control-tower`, needed from T03). |
| docs/method/AUTOMATION.md | 226 | \| `DEVOS_GITHUB_APP` \| true · **unset** \| the GitHub App `devos-control-tower` exists and is installed on the pilot and  |
| docs/method/FULLSTACK_MODULE.md | 121 | a real product rarely needs two data stores (the pilot runs both only to test the method). |
| docs/method/PRECEDENTS.md | 1 | # TOWER — Precedents |
| docs/method/PRECEDENTS.md | 5 | PR-01…PR-33 are the pilot's rulings (`devos-pilot` @ `4ccbef7`), kept because the runner implements |
| docs/method/PRECEDENTS.md | 10 | \| PR-01 \| **Environment profile.** Automated runs (builder and reviewer) execute on GitHub Actions `ubuntu-latest`, bash |
| docs/method/PRECEDENTS.md | 35 | \| PR-26 \| **Every stack module is declared, emulated and moved by the deploy.** Object storage (R2, `src/lib/r2/`) and F |
| docs/method/PRECEDENTS.md | 43 | \| PR-34 \| **Tower configuration deviations: one catalogue, GitHub hosts allow-listed.** The Tower's method is the pilot' |
| scripts/devos/doctor.mjs | 277 | // Tower ADR-004: no Protection Bypass for Automation by design. A preview behind the Vercel login is |
| scripts/devos/doctor.mjs | 279 | add({ key: "vercel", label: "Vercel preview", level: "info", state: "behind the Vercel login (expected, ADR-004)", link: |
| scripts/devos/doctor.mjs | 280 | todo: [{ who: "you", text: "Open the preview yourself while signed in to Vercel. No bypass secret is added (Tower ADR-00 |
| scripts/devos/render-prompt.mjs | 40 | ? `- Preview deployment of this branch: ${env.DEVOS_PREVIEW_URL} (check it with \`node scripts/devos/probe.mjs --base ${ |
| scripts/guards/design.mjs | 20 | // Tower configuration (docs/DESIGN_SYSTEM.md §5, PR-34): the Tower must name GitHub origins in code. Allowed hosts: |
| scripts/guards/i18n.mjs | 4 | // Tower configuration (docs/I18N_MODEL.md §5, PR-34): one catalogue. A second locale restores the pilot's constant. |
| scripts/guards/i18n.mjs | 24 | // Tower configuration (docs/I18N_MODEL.md §5): key parity across the catalogues present (one today); the empty-value ch |
| scripts/guards/naming.mjs | 5 | const ALLOW_ROUTES = new Set([]); // the pilot's "notices" exception does not apply to the Tower |
Total: 52 lines in 19 files
