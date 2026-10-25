# DEV_OS notes on the Google AIPs

Written by DEV_OS after reading every copied file whole (2026-10-25). Read this before the files your prompt lists.
These notes are DEV_OS's own text, not part of the copied files (`ATTRIBUTION.md`).

- **Google's API style, used for its principles.** The AIPs are written for resource-oriented APIs with Protocol
  Buffers and gRPC. Apply the principles in the project's own API style (REST and JSON, GraphQL, RPC). Keep the
  project's naming and wire format unless the fence or `docs/DECISIONS.md` adopts Google's.
- **AIP-155 (request identification).** A client-supplied request id makes a retried create or payment safe: the
  server returns the first result and does not act twice. Use it wherever a retry could repeat an effect.
- **AIP-158 (pagination).** Paginate every collection from its first version, with a server default and maximum page
  size, an opaque page token, and the authorization check on every page. A page token is never a permission.
- **AIP-180 (backwards compatibility).** It applies once an API has users the project does not update in the same
  change. The `Automobile` sample in "Serializing defaults" is not valid Protocol Buffers (`int wheels = 2;`: the type
  is `int32`, and `2` is the field number, not the default). Read the rule, not the sample.
- **AIP-193 (errors).** The `google.rpc.Status` shape and its detail types are Google's. Keep the principles: a stable
  machine-readable reason per error, a short message that says how to fix it, and no internal detail. Use the
  project's error format (record it in `docs/DECISIONS.md` if it has none). The AIP is inconsistent about the
  message's language: the guidance says English, while its changelog of 2023-05-17 says the service's own language.
  Follow the project's documents.
- **Not-found and forbidden.** AIP-193 answers `403` before checking whether an object exists. The OWASP IDOR sheet
  suggests one public answer, such as `404`, for both. Both hide whether an object exists. Choose one per project and
  use it on every endpoint (see `../owasp-cheat-sheets/DEVOS-NOTES.md`).
- **Links to AIPs that were not copied** are pointers for a person. Do not fetch them.
