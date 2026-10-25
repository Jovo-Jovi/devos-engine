---
name: devos-compose-ui
description: Compose the approved Dev OS design (docs/DESIGN_SYSTEM.md and docs/design/mockup.html) into Next.js components with CSS modules. Use for any Dev OS task that changes what a page looks like.
---

# Compose the approved design

The design is decided before the build (Dev OS J3). Your job is to reproduce it exactly, not to
improve it. A gap or a contradiction is reported, never improvised.

1. **Read the sources, in order:** the fence; `docs/DESIGN_SYSTEM.md` (tokens, type, components,
   compositions, catalogue keys); `docs/design/mockup.html` for the intended rendering; then the design
   skills your prompt lists for the task (`devos/skills/INDEX.md`). Where they disagree, the design system
   wins; note the difference in the report.
2. **Tokens first.** Every colour, size, space and radius comes from `src/styles/tokens.css`. Copy the
   token block exactly as the design system gives it. Raw values anywhere else fail `guard:design`.
3. **One CSS module per component** (`Component.module.css` beside `Component.tsx`). Logical properties
   only (`margin-inline-start`, `padding-block`, `inset-inline-start`, `text-align: start`,
   `border-block-end`). Inline `style` only for computed geometry (for example a timetable bar's
   `insetInlineStart` and `inlineSize` as percentages).
4. **Typography is part of the design.** Use the faces, weights, sizes and line heights in the type
   table; load fonts only through `next/font/google` (self-hosted). Sentence case; no all-caps.
5. **Stay logical.** Never branch on direction in CSS or JS for layout. Repository names, logins,
   hashes and evidence paths go through `<bdi>` (docs/I18N_MODEL.md).
6. **States are designed:** loading, empty, error, stale, offline (docs/DESIGN_SYSTEM.md). Render each
   one the way the design system says; never placeholder text.
7. **Quality floor:** visible focus ring, AA contrast from the tokens, no horizontal scroll at 390px,
   tap targets ≥ 44px, `aria-hidden` on purely visual marks with a text equivalent beside them.
8. **Check yourself before you report.** Build, start the app, and compare every page the fence names at 1280px
   and 390px with docs/DESIGN_SYSTEM.md. In the IDE use the Playwright MCP to take screenshots; in automated runs
   `node scripts/devos/screens.mjs` writes them to `.devos/screens/`. List every visible difference
   you could not remove in the report under "Notes for the reviewer".
9. **The runner's checks fail missing evidence (PR-51).** Every state on the `- Screens:` line needs an
   error-free capture at 1280 and 390 with no layout shift, no console error, no failed request and no
   axe violation. After `screens.mjs`, `node scripts/devos/ui-evidence.mjs --task <task>` prints what the
   runner will find; fix it before you report.
