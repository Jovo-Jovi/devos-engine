import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { blueprintFiles } from "../lib/init.mjs";
import { projectReadme, projectReadmeHow, writeProjectReadme } from "../lib/setup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flat = (file) => readFileSync(path.join(root, file), "utf8").replace(/\s+/g, " ");
const answers = { name: "Shop", type: "saas", stack: "next", modules: {}, deploy: "none" };
const blueprint = "# Shop\n\n## Features\n\n- [ ] Invoices\n\n## Status\n\nIn development: 3 tasks in 2 phases; see docs/PHASES.md.\n\n";

test("readme.test.mjs (a) setup keeps the blueprint's README and adds how the project is built once (PR-77)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-readme-"));
  const readme = path.join(dir, "README.md");
  try {
    writeProjectReadme(dir, answers);
    assert.equal(readFileSync(readme, "utf8"), projectReadme(answers));

    writeFileSync(readme, blueprint);
    writeProjectReadme(dir, answers, "owner/shop");
    const once = readFileSync(readme, "utf8");
    const kept = blueprint.replace(/\s+$/, "\n");
    assert.equal(once, `${kept}${projectReadmeHow(answers, "owner/shop").join("\n")}`);
    assert.equal(once.split("## How this project is built").length, 2);
    assert.match(once, /\n\n## How this project is built\n/);
    assert.equal(once.includes("owner/shop"), true);
    writeProjectReadme(dir, answers, "owner/shop");
    assert.equal(readFileSync(readme, "utf8"), once);

    writeFileSync(readme, blueprint);
    writeProjectReadme(dir, { ...answers, cycle: "local" });
    const local = readFileSync(readme, "utf8");
    assert.equal(local.includes("DEV_OS planned this project with its method and handed it over"), true);
    assert.equal(local.split("## How this project is built").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readme.test.mjs (b) the blueprint, builders and reviewers keep the README (PR-77)", () => {
  const has = (file, sentence) => assert.equal(flat(file).includes(sentence), true, file);
  has(
    "payload/files/devos/prompts/blueprint.md",
    "Also write the product's `README.md` at the root, for the people who will use or try the product (PR-77), from the brief, the scope and the design direction: `# <name>` and one line saying what it is and for whom, then `## What it does` (the problem and the core flow, in a few sentences), `## Features` (one line per feature of `docs/SCOPE.md` as `- [ ] <feature>`, ticked by the task that builds it, and the **Later** items under `### Later`), `## Screenshots` (the line `Screenshots arrive with the first screen.`), `## Getting started` (what to install, the stack's `install` command and how to run the product locally; keys by name only), `## Built with` (the stack and each chosen provider) and `## Status` (`In development: <n> tasks in <m> phases; see docs/PHASES.md.`).",
  );
  has(
    "payload/files/devos/prompts/blueprint.md",
    "is `node scripts/devos/run-checks.mjs --strict` exiting 0. T01 keeps the root `README.md` (PR-77): the generator's own README is never copied, T01 only fills `## Getting started` with the commands it makes work, and no Done-when asks for `README.md` to be absent.",
  );
  has(
    "payload/files/devos/prompts/builder.md",
    "**The README is the product's (PR-77).** Never delete `README.md` or remove one of its sections.",
  );
  has(
    "payload/files/devos/prompts/reviewer.md",
    "**README (PR-77):** a deleted or emptied `README.md`, or a removed section, is a FAIL (`guard:scope` fails a deletion).",
  );
  has(
    "payload/files/devos/prompts/reviewer.md",
    "A fence that builds a feature or changes what a user sees ends with a step that updates `README.md` (PR-77): it ticks the feature in `## Features`, and for a UI fence copies the settled desktop capture of its first `- Screens:` state, `.devos/screens/<state>-1280.png`, to `docs/screenshots/<state>.png` and links it under `## Screenshots`.",
  );
  has(
    "payload/files/docs/method/DEV_OS_V2_REVIEWER.md",
    "The root `README.md` is the product's own page for the people who use or try it (PR-77): what it does, its features, screenshots, getting started, what it is built with and its status.",
  );
  has(
    "payload/files/docs/method/DEV_OS_V2_REVIEWER.md",
    "**The README is kept (PR-77).** A fence that builds a feature or changes what a user sees ends with a step that updates `README.md`",
  );
  has(
    "payload/files/dot-cursor/rules/00-project.mdc",
    "Never delete `README.md` or remove one of its sections (PR-77). Update it only as the fence says.",
  );
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-77 | **The product README is kept.**");
  has("payload/files/docs/method/AUTOMATION.md", "A task never deletes the product's `README.md`:");
});

test("readme.test.mjs (c) the blueprint's files list the README first when it wrote one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-readme-"));
  try {
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "SCOPE.md"), "# Scope\n");
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01\n");
    assert.equal(blueprintFiles(dir).includes("README.md"), false);
    assert.deepEqual(blueprintFiles(dir), ["docs/SCOPE.md", "docs/fences/T01.md"]);
    writeFileSync(path.join(dir, "README.md"), "# Shop\n");
    assert.deepEqual(blueprintFiles(dir), ["README.md", "docs/SCOPE.md", "docs/fences/T01.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readme.test.mjs (d) a README with no final newline gets a blank line before how the project is built", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-readme-"));
  try {
    const readme = path.join(dir, "README.md");
    writeFileSync(readme, "# Shop\n\n## Status\n\nIn development.");
    writeProjectReadme(dir, answers);
    assert.equal(readFileSync(readme, "utf8").startsWith("# Shop\n\n## Status\n\nIn development.\n\n## How this project is built\n"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
