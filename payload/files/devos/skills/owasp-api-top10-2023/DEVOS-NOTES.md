# DEV_OS notes on the OWASP API Security Top 10 (2023)

Written by DEV_OS after reading every copied file whole (2026-10-25). Read this before the files your prompt lists.
These notes are DEV_OS's own text, not part of the copied files (`ATTRIBUTION.md`).

- **What it is for.** `0x11-t10.md` is the list of the ten risks. Every server-side task reads it as a checklist. The
  reviewer reads the risk files (`0xa1` to `0xaa`) that the task touches, and all of them on a deep review.
- **A risk list, not a design.** Each file says how a risk shows up and how to prevent it. How to build the control
  is in the OWASP Cheat Sheets (`../owasp-cheat-sheets/`) and the project's own documents.
- **The attack scenarios are illustrations.** Some request bodies are not valid as printed. For example, the GraphQL
  mutation in `0xa1` has an extra pair of braces. Do not copy them as tests; write the project's own.
- **Vendor names** (Docker, cloud metadata addresses, a logging library) are examples, not choices.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win. Where this list and another source disagree on a
  security point, follow the stricter rule and name the conflict in your report or verdict.
- **Links that do not resolve here** (`0x00-notice.md` → `CONTRIBUTING.md`, the 2019 edition, the other OWASP
  projects) are pointers for a person. Do not fetch them.
