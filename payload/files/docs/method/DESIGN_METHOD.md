# Design method — the UI/UX gate

How a Dev OS project designs, builds and accepts every screen. It extends the handbook (J3, §10) and binds every UI
task. Project-specific aesthetics are welcome; one look is never forced on every project. A correct page with poor
UI/UX does not pass.

## 1. The design contract

Every project with a web interface (`devos/project.json` `ui` is `true`) keeps three files. The blueprint writes them,
and they change only through decisions:

- `docs/DESIGN_SYSTEM.md`: its Direction (§5.5), then tokens (colour, type, spacing, radius, elevation), surfaces,
  themes (light and dark when the project has both), components and their states, motion and its reduced-motion
  behaviour, responsive rules (1280 and 390 wide at least), the accessibility floor (WCAG 2.2 AA unless the project
  sets a higher one: contrast, visible focus, keyboard paths, target size), and the resource decisions of §5.
- `docs/design/REFERENCES.md`: the references the direction draws from, the developer's first (§5.4); their
  screenshots are in `docs/design/references/`.
- `docs/design/UI_ACCEPTANCE.md`: the pass/fail criteria, one table row each, `| UA-nn | Criterion | Checked by |`.
  *Checked by* is `automated` (a check or a guard decides) or `reviewer` (the reviewer decides from the captures).

Agents work from these files, never from a past conversation.

T01 of such a project also adds the evidence tools as dev dependencies: `@playwright/test` and `@axe-core/playwright`.
The runner serves the production build with the stack's preview command (`devos.config.json` `stack.preview`) to
capture it.

## 2. The lifecycle of a UI task

Design brief → references (§5.4) → a direction of its own (§5.5) → design specification (in the fence) →
implementation → browser verification → reviewer design verdict → remediation and re-verification.

The reviewer owns direction and acceptance. The builder implements and checks its own work. Only rendered evidence
counts: the runner's captures (`scripts/devos/screens.mjs`, PR-35), never a description of a screen. Both read the
skills of §7 that their prompt lists for the task's layers (`devos/skills/INDEX.md`).

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

## 5. Reference library

The blueprint chooses each project's own direction from two sources, in this order: **the developer's references**
(§5.4) and **this library** (§5.1 to §5.3). A reference is something to learn from, never a look to copy (§5.5).
Nothing is installed by default: the blueprint records each resource it considered in `docs/DESIGN_SYSTEM.md` as
*adopt*, *optional* or *reject*, each with its reason; the reviewer justifies every dependency; the lightest tool that
does the job wins (lean, PR-47). The licences below were read in each project's repository on 2026-10-26. The
licence a project installs is the authority: re-read it when a fence adds the dependency.

### 5.1 Libraries

| Resource | Use | Licence | Default |
|---|---|---|---|
| CSS transitions, CSS scroll-driven animations, the View Transitions API | small state changes, page transitions | the web platform | adopt first: no dependency |
| Motion (`motion`; `motion-v` for Vue) | component transitions, gestures, layout animation | MIT | adopt for a web UI that animates (the method's standard) |
| AutoAnimate (`@formkit/auto-animate`) | list and layout transitions in one line | MIT | optional |
| GSAP (`gsap`, `@gsap/react`) | timelines, scroll-driven sequences, SVG | GreenSock's Standard "no charge" licence: free on any website or app; not allowed in a tool whose users build animations visually | optional — never on the same element as Motion; reject for a visual animation builder |
| anime.js | small timelines | MIT | optional — instead of GSAP when the sequences are small |
| React Spring | physics-based motion | MIT | optional |
| Lenis (`lenis`) | smooth scroll for a scroll-led story | MIT | reject unless the brief's experience needs it; never on a dashboard or a form-heavy app; off with reduced motion |
| React Bits, Animate UI | single effects whose code is copied into the project | MIT + Commons Clause: use in any product; never sell or redistribute the components themselves (a UI kit, a template pack) | optional — one effect at a time, with the licence notice kept in the copied file |
| Magic UI | animated components, copied | MIT | optional — as React Bits |
| shadcn/ui, shadcn-vue, shadcn-svelte | accessible components the project owns | MIT | adopt when the stack uses one |
| Radix Primitives, Reka UI (Vue), Bits UI (Svelte), Ark UI, Headless UI, React Aria | accessible unstyled primitives | MIT; React Aria Apache-2.0 | adopt one family when components are built by hand |
| Tailwind CSS | utilities over the design tokens | MIT | adopt when the stack uses it |
| Radix Colors | accessible colour scales | MIT | optional — a base for the palette |
| Lucide, Phosphor, Heroicons | icons | ISC (Lucide), MIT | adopt one set |
| Fontsource | self-hosted open fonts | MIT for the code; each font has its own licence, most often OFL | optional — or the stack's own font loader |
| Recharts, visx, Apache ECharts | charts | MIT, MIT, Apache-2.0 | adopt one for a dashboard |
| Tremor | dashboard components | Apache-2.0 | optional for a dashboard |
| Embla Carousel | carousels | MIT | optional — only when the brief needs a carousel |
| three.js, React Three Fiber, Drei | real 3D | MIT | optional — needs a reason in the brief |
| Rive runtimes | designed interactive animations | MIT (the editor is Rive's own service) | reject unless the developer brings `.riv` files |
| Lottie (`@lottiefiles/dotlottie-web`, `lottie-web`) | designed vector animations | MIT | optional — when the developer brings animations |
| Barba.js, Swup | transitions between the pages of a multi-page site | MIT | optional — multi-page sites only |
| assistant-ui, AI Elements | chat and AI interfaces | MIT, Apache-2.0 | optional for an AI product |
| Reanimated, Moti, NativeWind, Tamagui | React Native (Expo) motion and styling | MIT | Reanimated for motion; one styling approach |
| flutter_animate | Flutter motion | BSD-3-Clause | optional |
| Storybook + a11y addon | isolated states of shared components | MIT | optional — larger UIs |
| Theatre.js | motion design tooling | Apache-2.0, its studio AGPL-3.0 | reject: its public development is paused (its README) |

### 5.2 By product type

Starting questions, never a template: two projects of the same type do not share a look.

| Type | What good looks like | Consider | Browse |
|---|---|---|---|
| `marketing` | one memorable idea; type and imagery lead; motion tells the story once | Motion; GSAP or Lenis only with a reason; View Transitions | Awwwards, SiteInspire, Land-book, Lapa Ninja, One Page Love |
| `saas` | a clear promise, then a product that feels fast and calm | shadcn/ui or primitives, Motion, Radix Colors | Land-book, Lapa Ninja, Refero, Mobbin |
| `web-app`, `full` | dense, keyboard-first, quick feedback; motion only for state | primitives, Motion or AutoAnimate | Refero, Mobbin |
| `dashboard` | data first: hierarchy, density, legible numbers, near-zero motion | one chart library, primitives, Tremor | Refero, Mobbin, Dribbble |
| `marketplace` | trust and scanning: cards, filters, search, the seller's identity | primitives, Embla only if needed | Mobbin, Refero |
| `commerce` | the product's images, a clear price and stock, a short checkout | primitives, Embla only if needed | Mobbin, Lapa Ninja |
| `ai-product` | the model's states (thinking, streaming, error, cited source) and editable prompts | assistant-ui or AI Elements, Motion | Mobbin, Refero |
| `realtime` | presence, live state, and the reconnect and conflict states | Motion layout, AutoAnimate | Refero |
| `docs` | reading comfort: type scale, code blocks, search, navigation | the docs framework's theme (Starlight), one icon set | Httpster for typography |
| `extension` | small surfaces (popup, options page) that look native to the browser | primitives; little motion | Refero |
| `mobile` | the platform's conventions first | Reanimated with NativeWind or Tamagui; flutter_animate | Mobbin, Apple's Human Interface Guidelines, Material Design 3 |
| `cli` | output, help, errors and colour that degrade in a plain terminal | — | the Command Line Interface Guidelines (clig.dev, CC BY-SA 4.0) |
| `api`, `library`, `worker` | no interface: this library does not apply; their documentation pages follow `docs` | — | — |

### 5.3 Galleries

Look, never copy: every site below holds other people's work.

| Gallery | What it collects |
|---|---|
| Awwwards (awwwards.com) | award-scored websites |
| SiteInspire (siteinspire.com) | websites filtered by style, type and subject |
| Land-book (land-book.com) | curated landing pages |
| Lapa Ninja (lapa.ninja) | full-page landing page screenshots by category |
| One Page Love (onepagelove.com) | single-page websites |
| Httpster (httpster.net) | typography-led minimal websites |
| Refero (refero.design) | web pages and iOS screens, searchable by component and pattern |
| Mobbin (mobbin.com) | screens of shipped mobile and web apps |
| Collect UI (collectui.com) | interface shots by category (sign-in forms, 404 pages) |
| Dribbble (dribbble.com), Behance (behance.net) | concept shots and case studies: ideas, not shipped products |

### 5.4 The developer's references

- **At `devos init`**, the documents step takes design references: documents with links and notes (Markdown, text,
  CSV, JSON or YAML up to 1 MB, PDF up to 20 MB), and images at full quality (PNG, JPEG, WebP or GIF up to 20 MB each;
  up to 30 files, 200 MB in all). The images are kept in `docs/design/references/`, in the repository. Each file is
  named for what it holds and each image for the reference it shows (`ref-checkout-stripe.png`, `logo.png`,
  `flow-sign-up.png`), because the agents cite them by name (PR-60).
- **The blueprint writes `docs/design/REFERENCES.md`:** one table, `| Ref | Source | What we take | What we leave |`.
  The developer's references come first: each image by its file name, each link from their documents. The
  library picks follow. `devos init` refuses a blueprint whose `REFERENCES.md` leaves out an image.
- **Later references** come with a change request (§5.6).

### 5.5 A direction of its own

- **Direction first.** `docs/DESIGN_SYSTEM.md` opens with a **Direction** section:
  - the product's character in three words;
  - the `REFERENCES.md` rows it draws from;
  - its **signature**: one deliberate choice each for type, colour, layout and motion, which no single reference has as
    a whole.
- **No fixed look.** The type table (§5.2) gives questions, not a template. DEV_OS's neutral defaults are used only
  when the developer gives no reference and the brief names no style. Even then the signature is the product's own.
- **Never copy.** No reference's layout, illustration, photography, logo, copy or code is reproduced. Learn the
  principle (proportion, rhythm, contrast, pacing) and make it the product's own. A component library's code is used
  under its licence.
- **Judged in review.** The reviewer reads the captures against the Direction as well as the tokens (the design
  ledger's consistency and craft rows).

### 5.6 A redesign is a change request

- **Filing.** A new look, or a new reference, is filed as a change request.
- **The intake writes:**
  - a DRAFT OD that amends the design OD;
  - a new version of `docs/DESIGN_SYSTEM.md`: its Direction and its tokens;
  - the new rows of `docs/design/REFERENCES.md`;
  - the tasks: the tokens and shared components first, then each area's screens, each with its UI evidence.
- **History.** The repository keeps the old direction.

## 6. Tools stay out of the gate

Playwright, shadcn and Chrome DevTools MCP servers help when the developer works interactively. The automated cycle
never depends on one: the runner captures the real browser itself, and the repository holds the contract, the tests
and the proof.

## 7. Design skills

The agents read pinned skills from outside DEV_OS: `devos/skills/`. Each is mapped to layers (design, motion,
frontend, accessibility, architecture, backend, api, database, security, reliability, testing, ops), stacks and roles in
`devos/skills/manifest.json`, and `devos/skills/INDEX.md`, generated from it, is the discovery reference. A fence
names its layers (`- Layers:`), and the runner lists the files of those layers for the role and the stack in the
builder's and the reviewer's prompt (`scripts/devos/skills.mjs`, PR-55). `docs/DESIGN_SYSTEM.md`, the acceptance criteria and the fence always win over a skill.

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
