# DEV_OS notes on Trail of Bits' sharp edges

Written by DEV_OS after reading every copied file whole (2026-11-08). Read this before the files your prompt lists.
These notes are DEV_OS's own text, not part of the copied files (`ATTRIBUTION.md`).

- **What it is for.** A review aid for the launch task and for deep reviews (PR-88): APIs, settings and defaults of
  the product that make the insecure path the easy one. It finds design flaws, not every bug; the ASVS
  (`../owasp-asvs/`) is the checklist, and this is the second look.
- **How to use it here.** Read `SKILL.md` as a method, not as a skill to run: its front matter (`allowed-tools`, its
  trigger words) has no effect, and the `sharp-edges-analyzer` agent it names is not shipped. Do its phases yourself,
  with the tools your prompt allows, on the task's code and configuration. Its advice to "write minimal code
  demonstrating the footgun" means a finding in your verdict, with the file and line; you never add code.
- **References.** `references/config-patterns.md`, `auth-patterns.md` and `crypto-apis.md` are the patterns by
  subject; `language-specific.md` is the quick reference for every language, and `lang-javascript.md` the detail for
  JavaScript and TypeScript. The other languages' files, the case studies and the agent were not copied, so their
  links do not resolve: use `language-specific.md` for Python, Go and the rest.
- **Code samples** are illustrations of what goes wrong, labelled as such; the placeholder secrets in
  `config-patterns.md` are not real. Never run them.
- **Severity.** Report a sharp edge at the severity `SKILL.md` gives it, and fail the review for one the project's
  ASVS level or the fence makes a requirement. The rest go in the verdict as findings for the owner.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win.
