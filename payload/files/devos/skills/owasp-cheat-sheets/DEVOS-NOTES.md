# DEV_OS notes on the OWASP Cheat Sheets

Written by DEV_OS after reading every copied sheet whole (2026-10-25). Read this before the sheets your prompt lists.
It records where a sheet does not apply to a DEV_OS project and what DEV_OS decided instead. These notes are DEV_OS's
own text. They are not part of the sheets, which are copied unchanged under their own licence (`ATTRIBUTION.md`).

## Who wins

- The fence, `docs/DECISIONS.md` and the method (`docs/method/`) win over every sheet. A sheet is guidance, never
  authority.
- Where two sources disagree on a security point, follow the stricter rule and name the conflict in your report or
  verdict.
- **Secrets are never written to a file in the repository** (the method's rule, `guard:secrets`). Where a sheet offers
  a configuration file for credentials (`Database_Security`, "Storing Database Credentials Securely"), keep them in the
  project's secret store or environment (GitHub secrets, the host's environment variables), not in any file.

## How to read the sheets

- **Each sheet covers many stacks.** Apply the principles in the project's own language and framework. The code
  samples are illustrations: some are partial, and some cannot run as printed. For example, the Python sample in
  `Server_Side_Request_Forgery_Prevention` assumes extra packages and leaves parts out. Never paste one into the product
  without writing and testing it for the project.
- **Links that do not resolve here.** The sheets link to other OWASP sheets and to images and PDFs in `../assets/`.
  Only the sheets in this folder are copied. Treat a link to anything else as a pointer for a person: do not fetch it.
- **Vendor and tool names** (scanners, libraries, cloud services) are examples, not choices. The project's stack and
  `docs/DECISIONS.md` decide what is used. Adding a dependency is a decision for the fence.

## Corrections and choices

- **`Database_Security` → "Creating Secure Permissions"** says most applications need only `SELECT`, `UPDATE` and
  `DELETE`. That list leaves out `INSERT`, which most applications also need. Grant each role exactly the statements its
  code runs.
- **Not-found and forbidden.** `Insecure_Direct_Object_Reference_Prevention` suggests one public answer, such as
  `404`, for "does not exist" and "not yours". Google's AIP-193 (`google-aips/0193.md`) answers `403` before checking
  existence. Both hide whether an object exists. Choose one per project, record it in `docs/DECISIONS.md`, and use it on
  every endpoint.
- **Webhook signing (`Webhook_Security`).** A publisher's own verification library and its documented format come
  first. Do not invent a signature scheme when the provider already defines one.
- **Rate limits and tiers (`Multi_Tenant_Security`).** The numbers in the samples are illustrations. Limits come from
  the fence or `docs/DECISIONS.md`.
- **Merging and repository settings (`CI_CD_Security`).** The sheet advises against auto-merge. DEV_OS's runner merges
  a task only after its review passes and its required checks are green, and the human gate holds risk-3 tasks, gates
  and migrations. The method wins. Signed commits, MFA, branch protection and the other repository settings are the
  owner's to choose: propose them in the report, never change them from a task. DEV_OS keeps its workflows in the
  repository, and any change to them gets the deep review and the human gate (PR-28).
- **Containers (`Docker_Security`).** The Kubernetes parts apply only when the project runs Kubernetes. Keeping the
  host and Docker up to date is operations work, outside a task. The tools listed are examples.
- **Vulnerable dependencies (`Vulnerable_Dependency_Management`).** Where the sheet says a risk officer accepts a risk,
  in DEV_OS the owner decides: record the finding and the options in the report. Never open an issue or a pull request
  on another project. Upgrading, replacing or patching a dependency is a decision for the fence.
- **Microservices (`Microservices_Security`).** It points to sheets that are not copied (Authorization Patterns,
  Identity Propagation). A DEV_OS project starts as one service (lean by default, PR-47); use the sheet only when the
  fence names several services.

## Not copied

The OWASP Cheat Sheet Series has more than one hundred sheets. These 26 cover the security, api, database, backend,
architecture and ops layers. Further sheets (for example JSON Web Tokens, Content Security Policy, Transport Layer
Security) may come in a later engine task.
