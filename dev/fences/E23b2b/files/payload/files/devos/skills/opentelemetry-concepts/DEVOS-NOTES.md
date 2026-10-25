# DEV_OS notes on the OpenTelemetry concepts

Written by DEV_OS after reading every copied page whole (2026-10-25). Read this before the pages your prompt lists.
These notes are DEV_OS's own text, not part of the pages (`ATTRIBUTION.md`).

- **Concepts, not a dependency.** The pages explain traces, metrics and logs. Adding OpenTelemetry (an SDK, a
  Collector, an exporter or a vendor backend) is a dependency and a decision for the fence.
- **Never log tokens or personal data.** The structured log sample in `signals/logs.md` records a response token
  (`"token": "jwt-token-here"`), a username and an IP address. Leave tokens and secrets out of every log, and personal
  data unless the fence needs it (`../owasp-cheat-sheets/Logging_Cheat_Sheet.md`, "Data to exclude").
- **Keep metric attributes low-cardinality.** Use route templates, not raw paths or user ids, as `signals/metrics.md`
  explains under cardinality limits.
- **Current attribute names.** The second span sample in `signals/traces.md` uses older names (`http.method`,
  `net.peer.ip`); use the current semantic conventions, as the primer's table does (`http.request.method`). The
  `hello-greetings` sample span ends four hours after it starts, a typo in the sample.
- **Templates and links.** `{{% signal-support-table %}}` is a site template that does not render here. Links to
  `/docs/...` and images do not resolve. Do not fetch them.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win over the pages.
