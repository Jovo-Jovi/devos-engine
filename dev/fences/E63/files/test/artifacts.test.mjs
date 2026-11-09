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
  // PR-90: the work job (devos-work.yml) keeps its output for publish and the screenshots; publish keeps the record.
  const cycle = read("dot-github/workflows/devos-cycle.yml");
  const work = read("dot-github/workflows/devos-work.yml");
  const kept = uploads(cycle);
  assert.equal(kept.length, 1);
  const [evidence] = kept;
  // Its id is the report job's way to it (PR-90): an upload failure must not stop the run's end.
  assert.equal(evidence.startsWith("name: Keep the evidence\n        id: record\n        if: always()\n        continue-on-error: true\n"), true, evidence);
  assert.equal(evidence.includes("          name: devos-${{ needs.resolve.outputs.task }}-a${{ needs.resolve.outputs.attempt }}\n"), true, evidence);
  for (const out of ["!${{ github.workspace }}/publish/decide/.devos/screens/**/*.png", "!${{ github.workspace }}/publish/decide/.devos/**/*.env", "!${{ github.workspace }}/publish/decide/.devos/reviewer.json"]) assert.equal(evidence.includes(out), true, out);
  assert.equal(evidence.includes("retention-days"), false);
  const steps = uploads(work);
  assert.equal(steps.length, 2);
  const [output, screens] = steps;
  assert.equal(output.includes("          name: devos-${{ inputs.task }}-a${{ inputs.attempt }}-work\n          path: ${{ runner.temp }}/devos-out/\n"), true, output);
  const pack = work.slice(work.indexOf("      - name: Pack the bundle and the evidence"), work.indexOf("      - name: Keep the work job's output"));
  for (const left of ["! -name '*.env'", "! -name '*.png'", "! -name 'builder.json*'", "! -path './limits/*'"]) assert.equal(pack.includes(left), true, left);
  assert.equal(screens, [
    "name: Keep the screenshots (PR-67)",
    "        if: always()",
    "        continue-on-error: true",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: devos-${{ inputs.task }}-a${{ inputs.attempt }}-screens",
    "          path: .devos/screens/**/*.png",
    "          include-hidden-files: true",
    "          retention-days: ${{ vars.DEVOS_SCREENS_RETENTION_DAYS || 3 }}",
    "          if-no-files-found: ignore",
    "",
  ].join("\n"));
  // The report job downloads the evidence artifact for the journal by its id, which only publish's upload has (PR-90).
  assert.equal(cycle.includes("          artifact-ids: ${{ needs.publish.outputs.record_id }}\n          merge-multiple: true\n          path: .devos\n"), true);
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
