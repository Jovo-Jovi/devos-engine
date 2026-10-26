# E23b3 — research and decisions

The reviewer's record behind the E23b3 fence. The owner's decision of 2026-10-25: every project's design is its own
(no fixed look per project type), drawn from the references the developer gives at onboarding or a curated library,
and a project's design may change later. Every licence below was read in the repository at the commit given on
2026-10-26. Nothing here is legal advice.

## 1. What ships

- **The reference library** replaces the resource catalogue of `docs/method/DESIGN_METHOD.md` §5. It contains
  DEV_OS's own text and links only: no library code or gallery content is copied, so nothing new is vendored.
- **The developer's references.** Screenshots at `devos init` are kept in `docs/design/references/`. The blueprint
  writes `docs/design/REFERENCES.md`.
- **A Direction** opens `docs/DESIGN_SYSTEM.md`.
- **A redesign** is a change request.

## 2. Libraries: licence as read

The licences apply to a product that installs the library, not to DEV_OS, which ships none of them.

| Library | Repository @ commit (date) | Licence file says | Decision |
|---|---|---|---|
| Motion | motiondivision/motion @ fa2079f10135 (2026-10-23) | MIT, "Copyright (c) 2024 Motion B.V." | adopt (the method's standard) |
| Motion for Vue | motiondivision/motion-vue @ b9ddfd630ea2 (2026-10-16) | MIT; package `motion-v` | listed with Motion |
| GSAP | greensock/GSAP @ 13e2b7905464 (2026-04-13), v3.15.0 | no licence file; `package.json` and README: GreenSock's Standard "no charge" licence | optional; reject for a visual animation builder (§3) |
| Lenis | darkroomengineering/lenis @ e01eefb1f55c (2026-10-15) | MIT | reject unless the brief needs it |
| React Bits | DavidHDev/react-bits @ e12c22192ac7 (2026-10-19) | MIT + Commons Clause: use in an application, website or product; do not sell, sublicense or redistribute the components themselves | optional, the notice kept in copied files |
| Animate UI | imskyleen/animate-ui @ 7fffde3e56e8 (2026-10-25) | MIT + Commons Clause: do not sell or redistribute the components in their original form | optional, as React Bits |
| Magic UI | magicuidesign/magicui @ efe76fc5755e (2026-10-17) | MIT | optional |
| AutoAnimate | formkit/auto-animate @ 06882a8e69ba (2026-07-10) | MIT text, "Copyright 2022 FormKit Inc." | optional |
| anime.js | juliangarnier/anime @ 01b81be1df68 (2026-08-09) | MIT | optional |
| React Spring | pmndrs/react-spring @ e17c982134c2 (2026-10-20) | MIT | optional |
| shadcn/ui · shadcn-vue · shadcn-svelte | shadcn-ui/ui @ 481d52337474 · unovue/shadcn-vue @ de1f76cbb4b3 · huntabyte/shadcn-svelte @ 6149e14107a9 | MIT | adopt when the stack uses one |
| Radix Primitives · Reka UI · Bits UI · Ark UI · Headless UI | radix-ui/primitives @ eb3a2b709129 · unovue/reka-ui @ 78fb7748aa4f · huntabyte/bits-ui @ 33186c8cc7bb · chakra-ui/ark @ c7af88a51b9d · tailwindlabs/headlessui @ eea57cf46fd6 | MIT | adopt one family |
| React Aria | adobe/react-spectrum @ 338cf2e1940e (2026-10-23) | Apache-2.0 | as above |
| Tailwind CSS · Radix Colors | tailwindlabs/tailwindcss @ 8cc0551b1217 · radix-ui/colors @ dbdb85470547 | MIT | adopt when the stack uses it · optional |
| Lucide · Phosphor · Heroicons | lucide-icons/lucide @ 7faf87628a1a · phosphor-icons/core @ 2b75f3ad12b4 · tailwindlabs/heroicons @ 616b7a4dbbf3 | ISC · MIT · MIT | adopt one set |
| Fontsource | fontsource/fontsource @ f7706ecae800 | MIT (code) | optional |
| Recharts · visx · Apache ECharts | recharts/recharts @ bb1a3751c683 · airbnb/visx @ 485c0359664e · apache/echarts @ 34f4d927eafe | MIT · MIT · Apache-2.0 | adopt one for a dashboard |
| Tremor | tremorlabs/tremor @ ca4d588f4782 (2025-10-10) | Apache-2.0 | optional |
| Embla Carousel | davidjerleke/embla-carousel @ 0423b61463dd | MIT | optional |
| three.js · React Three Fiber · Drei | mrdoob/three.js @ 51fda2ac9604 · pmndrs/react-three-fiber @ d74622ea8ed7 · pmndrs/drei @ bf6f4addf474 | MIT | optional, with a reason |
| Rive runtimes | rive-app/rive-wasm @ bade9980b1ff · rive-app/rive-react @ 8f4ab5a831bb | MIT | reject unless `.riv` files are given |
| Lottie | LottieFiles/dotlottie-web @ d8a4e9e2cf76 · airbnb/lottie-web @ bede03d25d23 (2024-11-19) | MIT | optional |
| Barba.js · Swup | barbajs/barba @ a7c99a5557be (2024-08-12) · swup/swup @ 774d0f9f1a12 | MIT | optional, multi-page sites |
| assistant-ui · AI Elements | assistant-ui/assistant-ui @ 86040b77b3a6 · vercel/ai-elements @ ca8be600bfd0 | MIT · Apache-2.0 | optional, AI products |
| Reanimated · Moti · NativeWind · Tamagui | software-mansion/react-native-reanimated @ 1735e0312ad1 · nandorojo/moti @ 1854a19e5f18 · nativewind/nativewind @ 7dbaf1829398 · tamagui/tamagui @ 7ea8fdab519a | MIT | Reanimated for motion; one styling approach |
| flutter_animate | gskinner/flutter_animate @ 62c12040b1e3 (2024-11-25) | BSD-3-Clause | optional |
| Storybook | storybookjs/storybook @ d394f947b34e | MIT | optional |
| Starlight | withastro/starlight @ af9557ea8c95 | MIT | the `docs` type's theme |
| Theatre.js | theatre-js/theatre @ 6ea82b938ea4 (2024-04-11) | Apache-2.0; its README: the studio is AGPL-3.0, and development moved to a private repository for now | reject |
| Command Line Interface Guidelines | cli-guidelines/cli-guidelines @ 697d6a29fc8c | CC BY-SA 4.0; the README points to clig.dev | a link for the `cli` type |

**Considered and left out:**
- Locomotive Scroll (locomotivemtl/locomotive-scroll @ b6bcc569e803, MIT). Lenis and CSS scroll-driven animations cover
  its use.
- Aceternity UI and Spline. No licence file was read in a public repository.
- Godly. Sources disagree on its current address.
- `@vueuse/motion` (vueuse/motion @ c0efec2b20d5, MIT). Motion's own `motion-v` is listed instead.

## 3. GSAP's licence

The licence page at gsap.com could not be fetched from this session (not on the allowlist). It was read in ScanCode's
licence database, which keeps a copy as `gsap-standard-no-charge-2025` (category "Proprietary Free"):
<https://scancode-licensedb.aboutcode.org/gsap-standard-no-charge-2025.html>. What it says:
- **Permitted Uses:** "the implementation and/or use of GSAP Products on any website, web application, or digital
  interface by any person or entity".
- **Prohibited Uses:** use "in tools that allow users to build visual animations without code" that compete with
  Webflow's "visual animation building capabilities".

Hence the library's row: free on any website or app, and not allowed in a product that is itself a visual animation
builder.

## 4. Galleries

The gallery list and each description come from a March 2026 survey, <https://wbcomdesigns.com/best-websites-design-inspiration/>,
read on 2026-10-26: Awwwards, SiteInspire, Land-book, Lapa Ninja, One Page Love, Httpster, Refero, Mobbin, Collect UI,
Dribbble and Behance. The sites were not opened. Each holds other people's work, so the rule is "look, never copy".

## 5. Onboarding and checks

- **Screenshots** are PNG, JPEG or WebP, up to 1 MB each, within the existing 8 attachments. The browser server's
  per-file limit (2 MiB) and body limit (24 MiB) already allow them. Documents keep their 200 KB limit.
- **Formats left out.** GIF and SVG are not taken: an SVG can carry script, and animated GIFs are better described
  in words.
- **Where they go.** `devos init` copies screenshots to `docs/design/references/` and documents to
  `devos/intake-docs/`.
- **What is checked.** `checkBlueprint` requires `docs/design/REFERENCES.md` for a UI project. It refuses a file that
  does not name every screenshot, and the existing repair rounds fix it.
- **Who may change them.** The builder may never change `docs/design/**` (builder deny). The intake may now change
  `docs/design/REFERENCES.md`. A link to an image in an issue is listed, never fetched.

## 6. Validation

- **New tests:**
  - `test/design-library.test.mjs` (a)–(c): every catalogue type has a §5.2 row, 27 library rows each with a licence
    and a default, 10 galleries, and the surfaces;
  - `test/plan.test.mjs` (h): images up to 1 MB pass; a bigger one, a GIF and a big document are refused;
  - `test/init.test.mjs`: a screenshot is kept in `docs/design/references/` and named in `REFERENCES.md`, and a
    `REFERENCES.md` that leaves one out is repaired.
- **Results.** The full suite runs on top of E23c. Its count is in the fence.

## 7. Limits

- The library is a starting point the blueprint reads. Its licences are as read on 2026-10-26; a project re-reads the
  licence of what it installs.
- Whether a blueprint agent can read images depends on its tool. One that cannot works from the developer's notes and
  records that as an assumption.
