import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanup, flow, init, stage } from "./harness.mjs";
import { LINK_QUESTION } from "../lib/init.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { readChoices, rememberChoices } from "../lib/ui-server.mjs";

// E10a (PR-62), the owner's release decisions of 2026-10-26: the private Control Tower is disclosed before the
// contract is accepted, a link is the developer's explicit choice, and the engine works the same without one.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = readFileSync(path.join(root, "payload", "contract", "CONTRACT.md"), "utf8");
const ADDRESS = "https://devos-control-tower.vercel.app";

function ghLines(parent) {
  const file = path.join(parent, "gh.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "" && line !== "--version");
}

test("consent.test.mjs (a) the contract says what the engine and the private Control Tower are, before it is accepted", () => {
  const before = CONTRACT.slice(0, CONTRACT.indexOf("## Accepting"));
  for (const words of [
    "The DEV_OS Control Tower is a private service operated by Jovo-Jovi.",
    "It is not part of the engine, not a public",
    "you get no access to it, and nothing in the engine needs it.",
    "No answer is chosen for you.",
    "No: nothing is ever sent to the Control Tower, and every feature of the engine works the same.",
    "the project key, the run id, a sequence number, the",
    `the events go to ${ADDRESS} over HTTPS`,
    "That job alone receives GitHub's `id-token: write`",
    "`on` links and reports; `off`, or no variable at all, sends nothing",
    "Your code, diffs, prompts, file contents, secrets, keys, email addresses and token counts.",
  ]) {
    assert.equal(before.replace(/\n/g, " ").includes(words.replace(/\n/g, " ")), true, words);
  }
  assert.equal(CONTRACT.includes("Accepting does not link your project: that is the next question, and its answer is yours."), true);
  const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
  assert.equal(defaults.registry.url, ADDRESS);
  assert.equal(readFileSync(path.join(root, "README.md"), "utf8").includes("## The DEV_OS Control Tower (optional)"), true);
});

test("consent.test.mjs (b) the terminal asks right after the contract, asks again on any other answer, and records a yes", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ link: "maybe\nyes" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const out = result.stdout;
    assert.equal(out.indexOf("Type accept to continue: ") < out.indexOf(LINK_QUESTION), true);
    assert.equal(out.split("Type yes or no: ").length - 1, 2);
    assert.equal(out.includes("devos: the project's cycle will ask the Control Tower to link it"), true);
    assert.equal(out.includes("Control Tower link: yes, once its operator approves"), true);
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.registry_link, true);
  } finally {
    cleanup(staged.parent);
  }
});

test("consent.test.mjs (c) without a yes or a no, setup stops and nothing is written", () => {
  const staged = stage();
  try {
    const result = init(staged, "accept\nok\nsure\nfine\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: no valid answer for the Control Tower link"), true, result.stdout);
    assert.equal(existsSync(staged.project), false);
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("repo") || line.startsWith("variable")), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("consent.test.mjs (d) only a yes sets DEVOS_REPORTING to on; a no sets nothing and sends nothing", () => {
  for (const [link, expected] of [["yes", true], ["no", false]]) {
    const staged = stage();
    try {
      const result = init(staged, `${flow({ link }).trimEnd()}\n\n\n`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const lines = ghLines(staged.parent);
      assert.equal(lines.includes("variable set DEVOS_REPORTING --body on --repo devtest/demo-shop"), expected, lines.join("\n"));
      assert.equal(lines.some((line) => line.includes("DEVOS_REPORTING") && !line.endsWith("--body on --repo devtest/demo-shop")), false);
      const variables = result.stdout.split(/\r?\n/).find((line) => line.startsWith("Variables: ")) ?? "";
      assert.equal(variables.includes("DEVOS_REPORTING"), expected, variables);
    } finally {
      cleanup(staged.parent);
    }
  }
});

test("consent.test.mjs (e) the page's plan must say yes or no, and no choice is ever remembered for the next project", () => {
  const plan = { accepted: true, contract_version: "1" };
  const errors = validatePlan(plan, []).errors;
  assert.equal(errors.includes("Choose whether to link this project to the DEV_OS Control Tower: yes or no."), true);
  assert.equal(validatePlan({ ...plan, link: false }, []).errors.includes("Choose whether to link this project to the DEV_OS Control Tower: yes or no."), false);
  const app = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  assert.equal(app.includes("    link: null,\n"), true);
  assert.equal(app.includes('if (d.link !== true && d.link !== false) out.push("Choose whether to link this project to the DEV_OS Control Tower.");'), true);
  const home = mkdtempSync(path.join(tmpdir(), "devos-consent-"));
  const before = process.env.DEVOS_HOME;
  process.env.DEVOS_HOME = home;
  try {
    rememberChoices({ ...plan, link: true, agents: {}, project: {}, fields: {} }, "");
    assert.equal(JSON.stringify(readChoices()).includes("link"), false);
  } finally {
    if (before === undefined) delete process.env.DEVOS_HOME;
    else process.env.DEVOS_HOME = before;
    cleanup(home);
  }
});

test("consent.test.mjs (f) the cycle reports only when the project said yes, and from the report job only", () => {
  const cycle = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8").replaceAll("\r\n", "\n");
  assert.equal(cycle.includes("vars.DEVOS_REPORTING == 'on'"), true);
  assert.equal(cycle.includes("vars.DEVOS_REPORTING != 'off'"), false);
  assert.equal(cycle.split("id-token: write").length - 1, 1);
  const manual = readFileSync(path.join(root, "payload", "files", "docs", "method", "AUTOMATION.md"), "utf8");
  assert.equal(manual.includes("| `DEVOS_REPORTING` | on · **off (not set)** |"), true);
});
