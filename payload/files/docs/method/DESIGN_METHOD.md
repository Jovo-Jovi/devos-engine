# Design method — the UI/UX gate

How a Dev OS project designs, builds and accepts every screen. It extends the handbook (J3, §10) and binds every UI
task. Project-specific aesthetics are welcome; one look is never forced on every project. A correct page with poor
UI/UX does not pass.

## 1. The design contract

Every project with a web interface (`devos/project.json` `ui` is `true`) keeps two files. The blueprint writes them,
and they change only through decisions:

- `docs/DESIGN_SYSTEM.md`: tokens (colour, type, spacing, radius, elevation), surfaces, themes (light and dark when the
  project has both), components and their states, motion and its reduced-motion behaviour, responsive rules (1280 and
  390 wide at least), the accessibility floor (WCAG 2.2 AA unless the project sets a higher one: contrast, visible
  focus, keyboard paths, target size), and the resource decisions of §5.
- `docs/design/UI_ACCEPTANCE.md`: the pass/fail criteria, one table row each, `| UA-nn | Criterion | Checked by |`.
  *Checked by* is `automated` (a check or a guard decides) or `reviewer` (the reviewer decides from the captures).

Agents work from these files, never from a past conversation.

T01 of such a project also adds the evidence tools as dev dependencies: `@playwright/test` and `@axe-core/playwright`.
The runner serves the production build with the stack's preview command (`devos.config.json` `stack.preview`) to
capture it.

## 2. The lifecycle of a UI task

Design brief → visual direction → design specification (in the fence) → implementation → browser verification →
reviewer design verdict → remediation and re-verification.

The reviewer owns direction and acceptance. The builder implements and checks its own work. Only rendered evidence
counts: the runner's captures (`scripts/devos/screens.mjs`, PR-35), never a description of a screen. Both read the
design skills of §7 that `devos/skills/README.md` gives their role.

## 3. The design specification

A UI fence carries a `- Screens:` line in its header and a `### Design specification` section before `### Prompt`:

- `- States:` the names on the `- Screens:` line, exactly, in backticks separated by ` · `. Each is a route or a state
  of one (loading, empty, error, success, interactive, dialog, form, a step of a key journey) that the builder builds
  and the runner captures.
- `- Criteria:` the rows of `docs/design/UI_ACCEPTANCE.md` that apply, as `UA-nn` in backticks separated by ` · `.
- Then, in prose: what the screens must achieve — hierarchy, the components and tokens to use, the motion, the copy.

`guard:design-spec` fails the run when an open UI fence has no such section, when its states and its `- Screens:`
names differ, or when a criterion is not a row of `docs/design/UI_ACCEPTANCE.md`. A fence that says `- UI: yes` and
has no `- Screens:` line fails it too.

## 4. The acceptance gate

A UI task passes only when all of these hold:

1. the design specification is met;
2. the functional checks are green;
3. every state on the `- Screens:` line has an error-free capture at 1280 and 390, with no layout shift;
4. responsiveness and accessibility were checked, and the reviewer read keyboard paths, focus and contrast from the
   captures (an automated result never replaces that reading);
5. the captures were reviewed against `docs/DESIGN_SYSTEM.md` and the fence's criteria;
6. material defects were fixed and re-captured;
7. the verdict states the known limitations.

**Missing evidence is a failed check (PR-51).** After the captures, `scripts/devos/ui-evidence.mjs` adds two required
checks for a UI fence, so a red one overrides a PASS (PR-08):

- `ui-evidence` fails when a state on the `- Screens:` line has no capture at 1280 or 390, when a capture failed or
  lacks its settled or reduced-motion screenshot, or when it shows a layout shift, a console error or a failed request
  (an HTTP status of 400 or more, or a request that never completed);
- `a11y` fails when axe (`@axe-core/playwright`, the WCAG 2.0, 2.1 and 2.2 A and AA rules) did not run on a capture,
  or found a violation.

**Two kinds of finding.** The verdict keeps them apart:

- **Automated failures** — a red check, `ui-evidence` or `a11y` among them. They always fail the task, whatever the
  captures look like.
- **Design findings** — what the reviewer sees in the captures against `docs/DESIGN_SYSTEM.md`, the criteria and the
  skills of §7. Each is a REVISE: the capture, the rule it breaks, and the exact correction. A REVISE fails the task,
  and the reissued fence's attempt focus lists the corrections.

A point the reviewer leaves open is written in the verdict. A justified exception is written there too, visible to the
owner, never a silent bypass.

## 5. Resource catalogue

Decided per project by the blueprint and recorded in `docs/DESIGN_SYSTEM.md` as *adopt*, *optional* or *reject*, each
with its reason. Nothing is installed by default; the reviewer justifies every dependency, and the lightest tool that
does the job wins.

| Resource | Use | Default |
|---|---|---|
| Motion | component transitions, hover and tap feedback, layout changes | adopt (the method's standard) |
| shadcn/ui | accessible primitives the project owns | adopt when the stack uses it |
| GSAP + `@gsap/react` | coordinated sequences (SVG, timelines) | optional — never on the same element as Motion |
| React Bits | individual effects, copied and owned | optional — one effect at a time |
| React Three Fiber (+ Spline for art direction) | genuine 3D only | optional — needs a reason in the brief |
| Storybook + a11y addon | isolated states of shared components | optional — larger UIs |
| Lenis, Rive | smooth scroll, designed micro-animations | reject unless the brief justifies them |

## 6. Tools stay out of the gate

Playwright, shadcn and Chrome DevTools MCP servers help when the developer works interactively. The automated cycle
never depends on one: the runner captures the real browser itself, and the repository holds the contract, the tests
and the proof.

## 7. Design skills

The agents read pinned design skills from outside DEV_OS: `devos/skills/`, indexed for each role by
`devos/skills/README.md`. `docs/DESIGN_SYSTEM.md`, the acceptance criteria and the fence always win over a skill.

**Licence-aware, not licence-limited.** A skill is chosen for its quality and its licence together, under any licence.
Before anything is copied, the licence is read at the exact commit and classed:

| Class | Meaning | What DEV_OS may do |
|---|---|---|
| `free` | a permissive licence (MIT, Apache-2.0, BSD, ISC) | ship the files with their licence and notices |
| `conditions` | allowed with conditions beyond keeping notices (attribution shown to users, share-alike, file-level copyleft, no resale, a subset only) | ship them once every condition is met and recorded |
| `approval` | a custom, proprietary or unclear licence | nothing, until the author's written permission or a separate licence is recorded |
| `unsuitable` | redistribution is not allowed | nothing |

A skill DEV_OS may not ship is not dropped for that alone: it stays **external** (a developer may use it
interactively), or its general principles are written in DEV_OS's own words without copying it (**principles**).

**Auditable.** `devos/skills/manifest.json` records every skill evaluated, shipped or not: the source and the full
commit, the version, the licence and its class, the copyright, the notices, how each condition is met, any change
made, the roles that read it, and the sha256 of every file. Licence files and notices ship beside the files they
cover. `guard:skills` fails the run when a file is changed, missing or not listed, when a vendored entry lacks its
licence, its obligations or a full commit, or when a licence that needs approval is vendored without it.

**Pinned, never fetched.** A skill is read from its pinned copy. Nothing is fetched or installed from a skill at run
time, and the cycle runs no code that a skill ships.

**Adaptable.** A new skill, tool or framework joins with a manifest entry and its files: for every project through an
engine task, for one project through `devos/skills/local.json` and its own folder. Neither needs a change to the engine.
