# E72 — Screenshot audit of the guided page (new, current, adopt)

Audit of `main` @ cf84a87 (v1.13.4), 2026-11-11, by the reviewer. It is a list for the owner to choose from. Nothing
is built until the owner picks items; the picked items become one or more fences.

## How it was run

- **Driving the page.** Chrome (Playwright) drove `devos ui` on the tests' stand-ins: the `test/harness.mjs` stubs for
  the AI tool, `gh` and git, with a bare origin. It walked every flow by its own buttons:
  - **New project:** 17 steps, from the first screen to "Your project is on GitHub".
  - **Current project:** the folder finder, then the project's page.
  - **Existing project:** the adoption, from the survey to the pull request.
  - **Light theme:** a sample of the first screen.
- **Per screen:**
  - full-page screenshots at 1280×900 and 390×844;
  - a script that measured sideways scroll, elements past the edge, targets under 24 px, text under 12 px and running
    animations;
  - axe-core 4.10.2 (WCAG 2.0/2.1/2.2 A and AA).
  - 41 screens in all; no page error.
- **Limits:**
  - The stand-ins draft instantly, so the drafting screen was not seen at work.
  - The project's page was opened on a project with no GitHub repository, so its models section did not show.
  - Light theme: the first screen only.

## What the checks found

- **Sideways scroll at 390:** none, on every screen. On a phone the step rail becomes a "Step N of M" bar, and it works.
- **axe:** one rule, `scrollable-region-focusable` (serious), on `#rail`. It shows on the GitHub and finish screens,
  where the 17-step rail overflows a 900 px window.
- **Targets under 24 px:** the "Engine output" disclosure on every run screen, and the contract's "I have read…" row.
- **Motion:**
  - each screen fades in (one animated element per screen);
  - the adoption also staggers its survey facts and key rows;
  - the working screens pulse.

## The list

Size: S is a few lines or one screen's text; M is one screen reworked; L is several screens or new data.

### Fixes: the page says something wrong or leaves something out

1. **The new project's end says "The first cycle has started" even when keys the cycle needs were skipped** (M).
   The run skipped all 12 keys, among them `CURSOR_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`, both marked "Needed for the
   cycle". Show what must be set before the cycle
   can build, and where. Keep the keys to set later under it, as the adoption's end screen does.
2. **The new project never says what to set in Vercel** (S, reuses E71). With hosting on Vercel,
   `DEVOS_PRODUCTION_URL` must be in Vercel's Production variables, or the first deploy stops at its settings check:
   the Control Tower's deploy stopped exactly there. Show the adoption's "Set these in Vercel yourself" on the new
   project's Keys, GitHub and finish screens.
3. **The current-project flow shows the new project's 17-step rail** (S). "This computer" stays lit on every screen,
   the project's page included: the problem fixed for adopt in E71. Give it its own rail: This computer · Find the
   project · Project page.
4. **The first screen ignores the choice** (S). With "Existing project" or "Current project" chosen, three texts still
   describe a new project. Make them follow the choice:
   - the bar says "Setting up a new project";
   - the lede says DEV_OS "turns an empty folder into a project";
   - the folder row says "A new folder, named after your project in step 10".
5. **Internal precedent ids in the page's text** (S). Key descriptions say "(PR-29)" and "(PR-81)" (from
   `devos/setup.json`), and two catalogue texts say "(PR-49)" and "(PR-51)". They mean nothing to a user. The page
   drops `(PR-nn)` when it shows a text, so the payload stays as it is (engine only).

### Consistency between the flows

6. **One Keys step for both flows** (M). The new project asks key by key with no overview. Give it the adoption's
   list of every key, marked "On GitHub", "Needed" or "Optional", under the field. It pairs with 2.
7. **Summaries instead of raw lists** (M). "Create the repository" prints 11 `DEVOS_*` variable names and 12 key
   names. "Push and open the pull request?" is five long sentences. Make each one card:
   - the repository and its visibility;
   - what changes on GitHub, with the Actions permission as a notice;
   - keys uploaded and to set later, with counts;
   - the variable names behind a disclosure.
8. **The Continue button jumps** (S). Most screens use a column of about 720 px, but project type, modules and
   review use about 850 px, so Back and Continue move sideways between steps. Use one width, or keep the footer in
   one place.

### Guides and details

9. **A "How it works" opener for a new project** (S). Model it on the adoption's four steps, with rough times:
   - your choices: 12 short steps, about five minutes;
   - the blueprint: your AI tool drafts it, and you approve it or ask for another round;
   - the keys and the repository;
   - then the cycle.
10. **Change links on "Check your answers"** (M). Each block (Team, Product, Build, Documents) gets a Change link that
    opens its step and returns to the review.
11. **"What's this?" on the agent steps** (M). A short disclosure per step, with a one-line example from a real task:
    reviewer and light reviewer, builder pool and strengths, who picks the builder, and effort.
12. **Drafting with a document checklist** (M). While the blueprint is drafted, list the documents it writes (the
    S-01 to S-12 list of the approval screen) and tick each as it appears. Show the elapsed time and a typical
    duration.
13. **A shorter documents step** (S). It is the longest screen: 393 words, about three screens tall on a phone. Put
    the file rules (formats, sizes, naming) behind "What files work", and show the eight document kinds as compact cards.
14. **A fuller project page** (L). Today it shows Setup, Version and the Control Tower link, plus the models once the
    project has a repository. Add:
    - the cycle now: the current task from `docs/PHASES.md`, and the last run and its result;
    - the settings still missing (names only, from the setup check);
    - the upgrade command when a newer engine is out;
    - links to the repository, its Actions and the open pull request.

### Motion

All motion stays off under "reduce motion", as now.

15. **Direction-aware steps** (S). Continue brings the next screen in from the right, and Back from the left. A step's
    tick draws in on the rail when the step completes, and the phone's progress bar fills.
16. **Feedback on choices and at the end** (S). Cards and chips press on selection, and their check draws in. On the
    finish screen the check mark draws, then "What happens next" staggers in.

### Accessibility

17. **The step rail reachable by keyboard** (S). It scrolls when it overflows, but cannot be focused (axe, serious).
    Make it a focusable, labelled region, or fold finished groups so it does not overflow.
18. **Targets of at least 24 px** (S). The "Engine output" disclosure and the contract's checkbox row are under 24 px
    tall (WCAG 2.2, target size); make them 24 px at least, 44 px where it fits.

## Suggested packages (the owner decides)

- **E72a, fixes and keys:** 1, 2, 3, 4, 5, 6, 17 and 18. Engine only, risk 2.
- **E72b, guides and motion:** 7, 8, 9, 10, 11, 12, 13, 15 and 16. Engine only, risk 1.
- **E72c, the project page:** 14. It reads new data (the cycle's runs and the setup check), so risk 2 and its own
  fence.
