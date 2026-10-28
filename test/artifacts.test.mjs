import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// E30 (PR-67): a cycle run's PNG screenshots are most of its Actions storage and matter only while its attempt is
// reviewed. They go to an artifact of their own, kept DEVOS_SCREENS_RETENTION_DAYS days (3 when unset); the rest of the
// evidence and ci-evidence keep the repository's retention, without the PNGs. No .devos/*.env file is uploaded.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payload = path.join(root, "payload", "files");
const read = (file) => readFileSync(path.join(payload, file), "utf8").replaceAll("\r\n", "\n");
const EXCLUDE = "          path: |\n            .devos/\n            !.devos/screens/**/*.png\n            !.devos/**/*.env\n          include-hidden-files: true\n";

/** The upload steps of a workflow: every `actions/upload-artifact` step, from its first line to the next step. */
function uploads(text) {
  return text.split("\n      - ").filter((step) => step.includes("uses: actions/upload-artifact@"));
}

test("artifacts.test.mjs (a) a cycle run keeps its evidence without the screenshots, and its screenshots for 3 days", () => {
  const cycle = read("dot-github/workflows/devos-cycle.yml");
  const steps = uploads(cycle);
  assert.equal(steps.length, 2);
  const [evidence, screens] = steps;
  assert.equal(evidence.startsWith("name: Keep the evidence\n        if: always()\n"), true, evidence);
  assert.equal(evidence.includes("          name: devos-${{ needs.resolve.outputs.task }}-a${{ needs.resolve.outputs.attempt }}\n" + EXCLUDE), true, evidence);
  assert.equal(evidence.includes("retention-days"), false);
  assert.equal(screens, [
    "name: Keep the screenshots (PR-67)",
    "        if: always()",
    "        continue-on-error: true",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: devos-${{ needs.resolve.outputs.task }}-a${{ needs.resolve.outputs.attempt }}-screens",
    "          path: .devos/screens/**/*.png",
    "          include-hidden-files: true",
    "          retention-days: ${{ vars.DEVOS_SCREENS_RETENTION_DAYS || 3 }}",
    "          if-no-files-found: ignore",
    "",
  ].join("\n"));
  // The report job still downloads the evidence artifact by its name, for the journal.
  assert.equal(cycle.includes("          name: devos-${{ needs.resolve.outputs.task }}-a${{ needs.resolve.outputs.attempt }}\n          path: .devos\n"), true);
});

test("artifacts.test.mjs (b) ci-evidence keeps what the gate doctor reads, without screenshots or env files", () => {
  const ci = read("dot-github/workflows/ci.yml");
  const steps = uploads(ci);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].includes("          name: ci-evidence\n" + EXCLUDE), true, steps[0]);
  const doctor = read("scripts/devos/doctor.mjs");
  for (const used of ["ci-results.json", "/ci/logs/"]) assert.equal(doctor.includes(used), true, used);
  assert.equal(/screens|\.env/.test(doctor.slice(doctor.indexOf("async function diagnoseCi"), doctor.indexOf("async function diagnoseCi") + 2000)), false);
});

test("artifacts.test.mjs (c) the manual names the setting and PR-67 records the decision", () => {
  const manual = read("docs/method/AUTOMATION.md");
  assert.equal(manual.includes("  | `DEVOS_SCREENS_RETENTION_DAYS` | days · **3 (not set)** |"), true);
  assert.equal(manual.includes("its PNG screenshots in an artifact of their own, `<artifact>-screens`, for `DEVOS_SCREENS_RETENTION_DAYS` days; its `*.env` files never uploaded"), true);
  const precedents = read("docs/method/PRECEDENTS.md");
  assert.equal(precedents.includes("| PR-67 | **Screenshots are kept briefly; the rest of the evidence is kept as before.**"), true);
});
