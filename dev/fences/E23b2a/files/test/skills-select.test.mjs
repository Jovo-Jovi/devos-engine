import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// PR-56: the security, API and database skills, chosen by context, with the security gate. Scenarios A–E run the same
// catalogue on five stacks; (f) the record is reproducible; (g) every shipped skill is pinned and licensed; (h) the
// guard refuses a broken condition.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const skillsDir = path.join(root, "payload", "files", "devos", "skills");
const S = "devos/skills/";

function project({ stack, modules, rows = [], fences = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-select-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  const phases = path.join(dir, "docs", "PHASES.md");
  writeFileSync(phases, readFileSync(phases, "utf8").replace("| T01 | P1 | S1 | First task | 1 | — | [ ] | — |", rows.join("\n")));
  const cfgPath = path.join(dir, "devos.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.stack = { ...cfg.stack, ...stack };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  writeFileSync(path.join(dir, "devos", "answers.json"), JSON.stringify({ modules }));
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  for (const [task, text] of Object.entries(fences)) writeFileSync(path.join(dir, "docs", "fences", `${task}.md`), text);
  return dir;
}

function skills(dir, args, env = {}) {
  const run = spawnSync(process.execPath, ["scripts/devos/skills.mjs", ...args], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, DEVOS_REVIEW_MODE: "", ...env } });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

const record = (dir, task, role, env) => JSON.parse(skills(dir, ["select", "--task", task, "--role", role, "--json"], env));
const paths = (rec) => rec.files.map((file) => file.path.slice(S.length));
const row = (task, risk, gate = "—") => `| ${task} | P1 | S1 | ${task} | ${risk} | ${gate} | [ ] | — |`;
const GATE = ["owasp-cheat-sheets/Input_Validation_Cheat_Sheet.md", "owasp-cheat-sheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md", "owasp-api-top10-2023/0x11-t10.md"];

test("skills-select.test.mjs (a) scenario A: a Next.js and Supabase tenant API gets the API, database and Supabase rules it touches", () => {
  const dir = project({
    stack: { id: "next", toolchain: "node" },
    modules: { database: "supabase" },
    rows: [row("T01", 2)],
    fences: { T01: "# T01 — Projects list\n\n- Layers: api · database\n\nAdd a paginated list endpoint for a workspace's projects, with RLS policies on the new `projects` table.\n" },
  });
  try {
    const rec = record(dir, "T01", "builder");
    assert.deepEqual(rec.layers, { fence: ["api", "database"], added: [{ layer: "security", reason: "the security gate: the api and database layers are server-side" }], all: ["api", "database", "security"] });
    assert.deepEqual(rec.topics.map((item) => item.topic), ["tenant", "pagination", "rls", "migration"]);
    assert.deepEqual(rec.inputs.modules, ["supabase"]);
    assert.deepEqual(paths(rec), [
      "owasp-cheat-sheets/DEVOS-NOTES.md",
      "owasp-cheat-sheets/Input_Validation_Cheat_Sheet.md",
      "owasp-cheat-sheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md",
      "owasp-cheat-sheets/Authorization_Cheat_Sheet.md",
      "owasp-cheat-sheets/SQL_Injection_Prevention_Cheat_Sheet.md",
      "owasp-cheat-sheets/Mass_Assignment_Cheat_Sheet.md",
      "owasp-cheat-sheets/Multi_Tenant_Security_Cheat_Sheet.md",
      "owasp-cheat-sheets/REST_Security_Cheat_Sheet.md",
      "owasp-api-top10-2023/DEVOS-NOTES.md",
      "owasp-api-top10-2023/0x11-t10.md",
      "google-aips/DEVOS-NOTES.md",
      "google-aips/0158.md",
      "supabase-postgres-best-practices/DEVOS-NOTES.md",
      "supabase-postgres-best-practices/SKILL.md",
      "supabase-postgres-best-practices/references/security-rls-basics.md",
      "supabase-postgres-best-practices/references/security-rls-performance.md",
      "supabase-postgres-best-practices/references/security-privileges.md",
      "supabase-postgres-best-practices/references/schema-constraints.md",
      "supabase-postgres-best-practices/references/schema-data-types.md",
      "supabase-postgres-best-practices/references/schema-foreign-key-indexes.md",
      "supabase-postgres-best-practices/references/schema-lowercase-identifiers.md",
      "supabase-postgres-best-practices/references/schema-primary-keys.md",
      "supabase-postgres-best-practices/references/data-n-plus-one.md",
      "supabase-postgres-best-practices/references/data-pagination.md",
      "supabase/DEVOS-NOTES.md",
      "supabase/SKILL.md",
    ]);
    assert.equal(rec.files.find((file) => file.path.endsWith("Multi_Tenant_Security_Cheat_Sheet.md")).reason, "the fence says \"workspace\"");
    assert.equal(rec.files.find((file) => file.path.endsWith("0x11-t10.md")).reason, "the security gate: the api and database layers are server-side");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-select.test.mjs (b) scenario B: a FastAPI risk-3 webhook receiver gets the deep review and no Supabase skill", () => {
  const dir = project({
    stack: { id: "fastapi", toolchain: "python" },
    modules: {},
    rows: [row("T01", 3)],
    fences: { T01: "# T01 — Payment events\n\n- Layers: backend · api\n\nReceive Stripe payment webhooks and record each payment once; retries must not charge twice.\n" },
  });
  try {
    const builder = record(dir, "T01", "builder");
    assert.equal(builder.layers.added[0].reason, "the security gate: the backend and api layers are server-side; risk 3");
    assert.deepEqual(builder.deep, ["risk 3"]);
    assert.deepEqual(paths(builder), [
      "owasp-cheat-sheets/DEVOS-NOTES.md",
      ...GATE.slice(0, 2),
      "owasp-cheat-sheets/Authorization_Cheat_Sheet.md",
      "owasp-cheat-sheets/Injection_Prevention_Cheat_Sheet.md",
      "owasp-cheat-sheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md",
      "owasp-cheat-sheets/Mass_Assignment_Cheat_Sheet.md",
      "owasp-cheat-sheets/REST_Security_Cheat_Sheet.md",
      "owasp-cheat-sheets/Webhook_Security_Cheat_Sheet.md",
      "owasp-api-top10-2023/DEVOS-NOTES.md",
      GATE[2],
      "google-aips/DEVOS-NOTES.md",
      "google-aips/0155.md",
    ]);
    assert.deepEqual(builder.not_selected, [
      { id: "supabase-postgres-best-practices", reason: "needs the module supabase, which this project does not use" },
      { id: "supabase", reason: "needs the module supabase, which this project does not use" },
    ]);
    const reviewer = paths(record(dir, "T01", "reviewer"));
    assert.equal(reviewer.filter((file) => /^owasp-api-top10-2023\/0xa/.test(file)).length, 10);
    assert.ok(reviewer.includes("owasp-cheat-sheets/Threat_Modeling_Cheat_Sheet.md"));
    assert.ok(reviewer.includes("owasp-cheat-sheets/Error_Handling_Cheat_Sheet.md"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-select.test.mjs (c) scenario C: an Expo and Firebase upload gets the upload rules and no Postgres rule", () => {
  const dir = project({
    stack: { id: "expo", toolchain: "node" },
    modules: { storage: "firebase-storage" },
    rows: [row("T01", 2)],
    fences: { T01: "# T01 — Profile picture\n\n- Layers: backend · security\n\nLet a person upload a profile image to storage.\n" },
  });
  try {
    const rec = record(dir, "T01", "builder");
    assert.deepEqual(rec.inputs.modules, ["firebase"]);
    assert.deepEqual(rec.layers.added, []);
    assert.deepEqual(paths(rec), [
      "owasp-cheat-sheets/DEVOS-NOTES.md",
      ...GATE.slice(0, 2),
      "owasp-cheat-sheets/Injection_Prevention_Cheat_Sheet.md",
      "owasp-cheat-sheets/File_Upload_Cheat_Sheet.md",
      "owasp-api-top10-2023/DEVOS-NOTES.md",
      GATE[2],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-select.test.mjs (d) scenario D: a SvelteKit screen gets its design skills and the XSS sheet only for user markdown", () => {
  const dir = project({
    stack: { id: "sveltekit", toolchain: "node" },
    modules: {},
    rows: [row("T01", 1), row("T02", 1)],
    fences: {
      T01: "# T01 — Comments\n\n- Screens: `comments /post/:id`\n\nRender each comment's markdown body.\n",
      T02: "# T02 — Pricing\n\n- Screens: `pricing /pricing`\n\nA pricing page with three plans.\n",
    },
  });
  try {
    const comments = record(dir, "T01", "builder");
    assert.deepEqual(comments.layers.all, ["design", "motion", "frontend", "accessibility"]);
    assert.deepEqual(paths(comments).slice(-2), ["owasp-cheat-sheets/DEVOS-NOTES.md", "owasp-cheat-sheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md"]);
    assert.equal(paths(comments).some((file) => GATE.includes(file)), false);
    const pricing = paths(record(dir, "T02", "builder"));
    assert.equal(pricing.some((file) => file.startsWith("owasp")), false);
    assert.equal(pricing[0], "frontend-design/SKILL.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-select.test.mjs (e) scenario E: a one-line Go change keeps the security gate; a method fix reads none; a Topics line adds a topic", () => {
  const dir = project({
    stack: { id: "go-chi", toolchain: "go" },
    modules: {},
    rows: [row("T01", 1), row("T02", 1), `| T03 | PM | S1 | T03 | 3 | G-Method-1 | [ ] | — |`],
    fences: {
      T01: "# T01 — Rename\n\n- Layers: backend\n\nRename the health endpoint's JSON field.\n",
      T02: "# T02 — Rename\n\n- Layers: backend\n- Topics: secrets\n\nRename the health endpoint's JSON field.\n",
      T03: "# T03 — Method fix\n\n- Surface: method — scripts/devos/x.mjs\n- Layers: backend\n",
    },
  });
  try {
    assert.equal(skills(dir, ["layers", "--task", "T01"]).trim(), "backend security");
    const small = record(dir, "T01", "builder");
    for (const file of GATE) assert.equal(small.files.find((item) => item.path === S + file).priority, "required", file);
    assert.match(skills(dir, ["select", "--task", "T02", "--role", "builder"]), /^devos\/skills\/owasp-cheat-sheets\/Secrets_Management_Cheat_Sheet.md$/m);
    assert.equal(record(dir, "T02", "builder").topics[0].why, "the fence's Topics line");
    assert.equal(skills(dir, ["layers", "--task", "T03"]).trim(), "");
    assert.equal(skills(dir, ["select", "--task", "T03", "--role", "reviewer"]), "");
    const prompt = spawnSync(process.execPath, ["scripts/devos/render-prompt.mjs", "builder", "T01", "1"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(prompt.status, 0, prompt.stderr);
    assert.match(prompt.stdout, /^- \*\*Skills for this task\*\* \(layers backend · security, from the fence and the security gate: the backend layer is server-side; `devos\/skills\/INDEX.md`\): .*A \*\*required\*\* file belongs to the security gate: never skip it\./m);
    assert.match(prompt.stdout, /^  - `devos\/skills\/owasp-cheat-sheets\/Input_Validation_Cheat_Sheet.md` — every server-side task: validate input where it crosses the trust boundary \*\*\(required\)\*\*$/m);
    assert.match(prompt.stdout, /^  - `devos\/skills\/owasp-cheat-sheets\/DEVOS-NOTES.md` — read first: where DEV_OS's audit found this skill wrong or out of scope$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-select.test.mjs (f) the selection record is reproducible and pins its inputs", () => {
  const dir = project({ stack: { id: "hono", toolchain: "node" }, modules: { database: "supabase" }, rows: [row("T01", 2)], fences: { T01: "# T01 — Orders\n\n- Layers: api\n\nList orders with a cursor.\n" } });
  try {
    const first = skills(dir, ["select", "--task", "T01", "--role", "reviewer", "--json"]);
    assert.equal(skills(dir, ["select", "--task", "T01", "--role", "reviewer", "--json"]), first);
    const rec = JSON.parse(first);
    const hash = (rel) => createHash("sha256").update(readFileSync(path.join(dir, rel), "utf8").replaceAll("\r\n", "\n")).digest("hex");
    assert.equal(rec.inputs.fence.sha256, hash("docs/fences/T01.md"));
    assert.equal(rec.inputs.manifest.sha256, hash("devos/skills/manifest.json"));
    assert.equal(rec.inputs.local.sha256, null);
    assert.equal(rec.inputs.risk, 2);
    assert.deepEqual(rec.inputs.stack.id, "hono");
    assert.ok(rec.files.every((file) => ["required", "recommended", "conditional"].includes(file.priority) && file.reason.length > 0));
    assert.deepEqual(record(dir, "T01", "reviewer", { DEVOS_REVIEW_MODE: "deep" }).deep, ["a deep review"]);
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01 — Orders\n\n- Layers: api\n\nList orders.\n");
    const changed = JSON.parse(skills(dir, ["select", "--task", "T01", "--role", "reviewer", "--json"]));
    assert.notEqual(changed.inputs.fence.sha256, rec.inputs.fence.sha256);
    assert.equal(changed.files.some((file) => file.path.endsWith("0158.md")), false);
    assert.equal(rec.files.some((file) => file.path.endsWith("0158.md")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-select.test.mjs (g) every shipped skill is pinned to a commit, keeps its licence and attribution, and ships nothing it excludes", () => {
  const manifest = JSON.parse(readFileSync(path.join(skillsDir, "manifest.json"), "utf8"));
  assert.equal(manifest.version, 3);
  const byId = Object.fromEntries(manifest.entries.map((entry) => [entry.id, entry]));
  for (const id of ["owasp-cheat-sheets", "owasp-api-top10-2023", "google-aips", "supabase-postgres-best-practices", "supabase"]) {
    const entry = byId[id];
    assert.equal(entry.delivery, "vendored", id);
    assert.match(entry.source.commit, /^[0-9a-f]{40}$/, id);
    assert.equal(/\b(main|master|HEAD)\b/.test(entry.source.commit), false, id);
    assert.equal(entry.trust.runs_code, false, id);
    assert.equal(entry.trust.fetches, false, id);
    assert.equal(entry.trust.reviewed, "2026-10-25", id);
    const notes = entry.files.find((file) => file.path === entry.notes);
    assert.equal(notes?.origin, "devos", id);
    for (const file of entry.files.filter((item) => item.origin === "source")) assert.ok(file.from.length > 0, `${id}/${file.path}`);
    for (const skipped of entry.excluded ?? []) assert.equal(existsSync(path.join(skillsDir, id, skipped.path)), false, `${id}/${skipped.path}`);
    if (entry.licence.spdx.startsWith("CC-BY")) {
      assert.equal(entry.licence.class, "conditions", id);
      assert.ok(entry.licence.notices.includes("ATTRIBUTION.md"), id);
      const attribution = readFileSync(path.join(skillsDir, id, "ATTRIBUTION.md"), "utf8");
      assert.ok(attribution.includes(entry.source.commit), id);
      assert.match(attribution, /\*\*Changes:\*\* none\./, id);
      assert.match(readFileSync(path.join(skillsDir, id, entry.licence.file), "utf8"), /Creative Commons Attribution/, id);
    }
  }
  assert.equal(byId["supabase-postgres-best-practices"].source.tag, "v0.1.9");
  assert.equal(byId.supabase.source.commit, byId["supabase-postgres-best-practices"].source.commit);
  assert.deepEqual(byId.supabase.modules, ["supabase"]);
  assert.match(readFileSync(path.join(skillsDir, "supabase", "LICENSE"), "utf8"), /^MIT License\n\nCopyright \(c\) 2026 Supabase\n/);
  for (const id of ["trailofbits-supply-chain-risk-auditor", "owasp-asvs", "wshobson-api-design-principles", "trailofbits-sharp-edges"]) {
    assert.notEqual(byId[id].delivery, "vendored", id);
    assert.ok(byId[id].reason.length > 60, id);
  }
});

test("skills-select.test.mjs (h) the guard refuses a broken priority, condition or notes file", () => {
  const dir = project({ stack: {}, modules: {} });
  try {
    const folder = path.join(dir, "devos", "skills", "house-rules");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "RULES.md"), "# Rules\n");
    writeFileSync(path.join(folder, "LICENSE"), "MIT\n");
    const sha = (text) => createHash("sha256").update(text).digest("hex");
    const entry = (reads, extra = {}) => ({
      id: "house-rules",
      kind: "reference",
      title: "House rules",
      source: { repo: "https://example.com/house-rules", commit: "b".repeat(40) },
      licence: { spdx: "MIT", class: "free", file: "LICENSE", notices: [] },
      delivery: "vendored",
      obligations: ["The licence ships beside the file"],
      roles: ["builder"],
      layers: ["api"],
      stacks: ["any"],
      trust: { runs_code: false, fetches: false, reviewed: "2026-10-25", notes: "Markdown only." },
      reads,
      files: [
        { path: "RULES.md", origin: "source", from: "RULES.md", sha256: sha("# Rules\n") },
        { path: "LICENSE", origin: "source", from: "LICENSE", sha256: sha("MIT\n") },
      ],
      ...extra,
    });
    const guard = (value) => {
      writeFileSync(path.join(dir, "devos", "skills", "local.json"), JSON.stringify({ version: 1, entries: [value] }));
      const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "skills", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
      return JSON.parse(run.stdout).skills;
    };
    const read = { file: "RULES.md", roles: ["builder"], layers: ["api"], when: "every endpoint" };
    assert.deepEqual(guard(entry([{ ...read, priority: "urgent" }, { ...read, priority: "conditional" }, { ...read, if: [{ topics: ["upload"] }] }], { notes: "RULES.md", modules: [] })).findings, [
      "devos/skills/local.json house-rules: modules must list module names",
      "devos/skills/local.json house-rules: notes must be one of its files, written by DEV_OS (origin devos)",
      "devos/skills/local.json house-rules: reads RULES.md: priority must be one of required, recommended, conditional",
      "devos/skills/local.json house-rules: reads RULES.md: a conditional read needs if, a list of clauses",
      "devos/skills/local.json house-rules: reads RULES.md: only a conditional read has if",
    ]);
    assert.deepEqual(guard(entry([{ ...read, priority: "conditional", if: [{ topics: ["weather"] }, { deep: false }, { colour: ["red"] }] }])).findings, [
      "devos/skills/local.json house-rules: reads RULES.md: topics must be some of the manifest's topics",
      "devos/skills/local.json house-rules: reads RULES.md: deep must be true",
      "devos/skills/local.json house-rules: reads RULES.md: each clause of if uses topics, modules, deep",
    ]);
    assert.equal(guard(entry([{ ...read, priority: "conditional", if: [{ topics: ["pagination"], modules: ["supabase"] }, { deep: true }] }])).status, "PASS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
