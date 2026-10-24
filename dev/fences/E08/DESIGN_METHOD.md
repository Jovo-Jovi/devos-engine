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

## 2. The lifecycle of a UI task

Design brief → visual direction → design specification (in the fence) → implementation → browser verification →
reviewer design verdict → remediation and re-verification.

The reviewer owns direction and acceptance. The builder implements and checks its own work. Only rendered evidence
counts: the runner's captures (`scripts/devos/screens.mjs`, PR-35), never a description of a screen.

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

An automated failure always fails the task. A design finding fails it with exact corrections. A point left open is
recorded in the verdict; a justified exception is written there, visible to the owner, never a silent bypass.

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
