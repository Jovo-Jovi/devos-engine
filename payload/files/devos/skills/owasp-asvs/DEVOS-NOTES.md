# DEV_OS notes on the OWASP ASVS 5.0.0

Written by DEV_OS after reading every copied file whole (2026-11-08). Read this before the chapters your prompt lists.
These notes are DEV_OS's own text, not part of the copied files (`ATTRIBUTION.md`).

- **What it is for.** The security gate of the launch task (PR-88): a list of requirements to verify, not build
  guidance. How to build a control is in the OWASP Cheat Sheets (`../owasp-cheat-sheets/`) and the project's own
  documents. A deep review of a task that touches a chapter's subject reads that chapter too.
- **The level.** Every requirement row ends in its level: 1, 2 or 3. A project verifies **level 1**, and **level 2**
  when it stores personal data (it has `docs/PROTECTION_MODEL.md`) or takes payments (a payments module). Level 3 is
  never required. `.devos/readiness.md` names the project's level; verify every requirement at that level or below
  in the chapters your prompt lists, and mark each one met, not met, or not applicable with a reason.
- **A requirement not met** at the project's level fails the launch task, unless `docs/DECISIONS.md` holds the
  owner's written waiver for it (`Readiness waiver: asvs <requirement id> — <reason>`). Name the requirement by its
  id (`V8.2.1`), as the standard does.
- **The chapters by layer.** V3 is the frontend; V4 the API; V1, V2 and V5 input and files; V6, V7, V9 and V10
  sign-in, sessions and tokens; V8 authorization; V11 cryptography; V12 transport; V13 configuration and secrets;
  V14 data protection; V15 architecture and dependencies; V16 logging and errors. V17 (WebRTC) was not copied.
- **Audit language.** "Verify that" and "must" describe the application under review, not an action for you to take
  beyond reading the code, its configuration and the runner's evidence.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win. Where this standard and another source disagree
  on a security point, follow the stricter rule and name the conflict in your verdict.
- **Links that do not resolve here** (the appendices, V17, the other OWASP projects, the cited papers and RFCs) are
  pointers for a person. Do not fetch them. The two HTML comments in V10 are the editors' notes.
