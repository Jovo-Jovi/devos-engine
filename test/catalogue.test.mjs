import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { KEY_SOURCES, keySource, neededKeys, readFileKey } from "../lib/keys.mjs";
import { cleanup, flow, init, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import {
  derivedAnswers,
  loadCatalogue,
  methodModules,
  modulesFor,
  prepareFor,
  stacksFor,
  typeById,
} from "../lib/catalogue.mjs";

const METHODS = new Set(["supabase", "r2", "firebase", "vercel"]);

test("catalogue.test.mjs (a) integrity", () => {
  const catalogue = loadCatalogue();
  assert.equal(catalogue.types.length, 16);
  assert.equal(catalogue.stacks.length, 20);
  assert.equal(catalogue.stacks.filter((stack) => stack.runs === true).length, 20);
  assert.equal(catalogue.modules.length, 10);
  assert.equal(catalogue.documents.length, 8);
  for (const type of catalogue.types) {
    const stack = catalogue.stacks.find((item) => item.id === type.stack);
    assert.equal(stack?.runs, true, type.id);
    assert.equal(stack.fits.includes(type.id), true, type.id);
    assert.equal(typeById(type.id)?.id, type.id);
    for (const [moduleId, providerId] of Object.entries(type.defaults)) {
      const module = catalogue.modules.find((item) => item.id === moduleId);
      assert.ok(module, `${type.id} ${moduleId}`);
      assert.equal(module.providers.some((provider) => provider.id === providerId), true, `${type.id} ${moduleId} ${providerId}`);
    }
    for (const id of type.prepare) {
      assert.equal(catalogue.documents.some((doc) => doc.id === id), true, id);
    }
  }
  for (const module of catalogue.modules) {
    for (const provider of module.providers) {
      if (provider.method) assert.equal(METHODS.has(provider.method), true, provider.method);
      for (const name of provider.env ?? []) assert.equal(Object.hasOwn(KEY_SOURCES, name), true, name);
    }
  }
});

test("catalogue.test.mjs (b) stacks for an api", () => {
  assert.deepEqual(stacksFor("api").map((stack) => stack.id), ["hono", "fastify", "nest", "fastapi", "django", "go-chi"]);
});

test("catalogue.test.mjs (c) modules for saas", () => {
  const modules = modulesFor("saas");
  assert.deepEqual(modules.map((module) => module.id), ["database", "storage", "auth", "payments", "email", "hosting", "observability"]);
  assert.deepEqual(modules.map((module) => module.default), ["supabase", "none", "email", "none", "resend", "vercel", "structured-logs"]);
});

test("catalogue.test.mjs (d) method modules", () => {
  assert.deepEqual(methodModules({ database: "supabase", storage: "r2" }), ["r2", "supabase"]);
  assert.deepEqual(methodModules({ database: "firebase" }), ["firebase"]);
  assert.deepEqual(methodModules({ storage: "firebase-storage" }), ["firebase"]);
  assert.deepEqual(methodModules({ hosting: "vercel" }), []);
  assert.deepEqual(methodModules({}), []);
});

test("catalogue.test.mjs (e) derived answers", () => {
  assert.deepEqual(derivedAnswers({ database: "none", auth: "email+oauth", hosting: "vercel" }), {
    stores_data: false,
    sign_in: "email+oauth",
    deploy: "vercel",
  });
  assert.deepEqual(derivedAnswers({}), { stores_data: false, sign_in: "none", deploy: "none" });
});

test("catalogue.test.mjs (f) documents to prepare for marketing", () => {
  assert.deepEqual(prepareFor("marketing").map((doc) => doc.id), ["brief", "design", "brand", "content", "similar"]);
});

function appearsInOrder(text, parts) {
  let from = 0;
  for (const part of parts) {
    const index = text.indexOf(part, from);
    assert.equal(index >= from, true, part);
    from = index + part.length;
  }
}

test("catalogue.test.mjs (g) init asks the type, the stack and the saas modules", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const modules = modulesFor("saas");
    appearsInOrder(result.stdout, [
      "Project type",
      "Stack",
      ...modules.map((module) => `${module.label} — ${module.consequence}`),
    ]);
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.type, "saas");
    assert.equal(answers.stack, "next");
    assert.deepEqual(answers.modules, {
      database: "none",
      storage: "none",
      auth: "none",
      payments: "none",
      email: "none",
      hosting: "vercel",
      observability: "structured-logs",
    });
    assert.equal(answers.stores_data, false);
    assert.equal(answers.sign_in, "none");
    assert.equal(answers.deploy, "vercel");
    assert.equal(answers.scope, "mvp");
    assert.equal(result.stdout.includes("Type: SaaS application"), true);
    assert.equal(result.stdout.includes("Stack: Next.js (App Router, TypeScript)"), true);
    assert.equal(result.stdout.includes("Modules: database none · storage none · auth none · payments none · email none · hosting vercel · observability structured-logs"), true);
    assert.equal(result.stdout.includes("Python, Go and Dart stacks join in a later version."), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("catalogue.test.mjs (h) the prepare list comes before attachments", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const docs = prepareFor("saas");
    assert.deepEqual(docs.map((doc) => doc.id), ["brief", "design", "flows", "brand", "content", "data", "rules", "similar"]);
    const block = result.stdout.indexOf("Have these ready (all optional; attach the ones you have):");
    const attach = result.stdout.indexOf("Documents (Markdown, text, CSV, JSON, YAML up to 1 MB; PDF up to 20 MB) and design images (PNG, JPEG, WebP, GIF up to 20 MB) to attach");
    assert.equal(block >= 0 && attach > block, true, result.stdout);
    let from = block;
    for (const doc of docs) {
      const line = `- ${doc.label} — ${doc.why}`;
      const index = result.stdout.indexOf(line, from);
      assert.equal(index > from && index < attach, true, line);
      from = index + line.length;
    }
    const keys = result.stdout.indexOf("Keys are typed later, hidden, and never attached.", from);
    assert.equal(keys >= from && keys < attach, true);
  } finally {
    cleanup(staged.parent);
  }
});

const DEFAULT_AGENTS = {
  reviewer: { tool: "claude" },
  reviewer_light: { tool: "claude" },
  pool: [{ tool: "cursor" }],
};

test("catalogue.test.mjs (i) module keys follow the cycle keys", () => {
  const setup = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8"));
  const keys = neededKeys(setup, {
    deploy: "vercel",
    modules: { database: "supabase", payments: "stripe", hosting: "vercel" },
  }, DEFAULT_AGENTS);
  assert.deepEqual(keys.map((key) => key.name), [
    "CURSOR_API_KEY",
    "CURSOR_API_KEY_2",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_2",
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_DB_PASSWORD",
    "DEVOS_BACKUP_PASSPHRASE",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  assert.deepEqual(keys.slice(0, 4).map((key) => key.optional), [false, true, false, true]);
  assert.equal(keys.slice(4).every((key) => key.optional === true), true);
  for (const key of keys) assert.equal(Object.hasOwn(KEY_SOURCES, key.name), true, key.name);
});

test("catalogue.test.mjs (j) a supabase database lists its secret and sets no variable", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ modules: ["supabase", "", "auth none", "", "email none", "", ""] }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("SUPABASE_PROJECT_REF"), true, result.stdout);
    const setup = readFileSync(path.join(staged.project, "SETUP.md"), "utf8");
    assert.equal(setup.includes("Supabase production project"), true, setup);
    const gh = readFileSync(staged.env.DEVOS_GH_LOG, "utf8");
    assert.equal(gh.includes("variable set DEVOS_SUPABASE"), false, gh);
  } finally {
    cleanup(staged.parent);
  }
});

test("catalogue.test.mjs (k) a file key is read and never printed", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-file-key-"));
  try {
    const file = path.join(dir, "account.json");
    const text = "{\"role\":\"fixture\"}\n";
    writeFileSync(file, text);
    const shown = [];
    const stdout = { write: (chunk) => shown.push(String(chunk)) };
    const got = await readFileKey("FIREBASE_SERVICE_ACCOUNT", async () => file, stdout);
    assert.equal(got, text);
    assert.equal(shown.join("").includes(text.trim()), false);
    const errors = [];
    const missing = path.join(dir, "missing.json");
    let asks = 0;
    const skipped = await readFileKey("FIREBASE_DEPLOY_SERVICE_ACCOUNT", async () => {
      asks += 1;
      return missing;
    }, { write: (chunk) => errors.push(String(chunk)) });
    assert.equal(skipped, "");
    assert.equal(asks, 3);
    const joined = errors.join("");
    assert.equal(joined.split("is not a readable JSON file").length - 1, 3);
    assert.equal(joined.includes("FIREBASE_DEPLOY_SERVICE_ACCOUNT"), true);
    const secret = "{\"role\":\"fixture\"}";
    const encoded = Buffer.from(secret).toString("base64");
    const inlineShown = [];
    const inlineRead = async () => `base64:${encoded}`;
    inlineRead.interactive = true;
    const inline = await readFileKey("FIREBASE_SERVICE_ACCOUNT", inlineRead, { write: (chunk) => inlineShown.push(String(chunk)) });
    assert.equal(inline, secret);
    assert.equal(inlineShown.join("").includes(secret), false);
    let pathAsks = 0;
    const asPath = await readFileKey("FIREBASE_SERVICE_ACCOUNT", async () => {
      pathAsks += 1;
      return `base64:${encoded}`;
    }, { write: () => {} });
    assert.equal(asPath, "");
    assert.equal(pathAsks, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("catalogue.test.mjs (l) app keys close SETUP.md", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ modules: ["database none", "", "auth none", "stripe", "email none", "", ""] }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const setup = readFileSync(path.join(staged.project, "SETUP.md"), "utf8");
    const ending = [
      "## Keys your app reads",
      "",
      "DEV_OS stored these as GitHub secrets. Until the deploy copies them to your host, also set them in Vercel → Settings → Environment Variables (Production).",
      "",
      `- STRIPE_SECRET_KEY — ${keySource("STRIPE_SECRET_KEY")}`,
      `- STRIPE_WEBHOOK_SECRET — ${keySource("STRIPE_WEBHOOK_SECRET")}`,
      "",
    ].join("\n");
    assert.equal(setup.endsWith(ending), true, setup.slice(-600));
  } finally {
    cleanup(staged.parent);
  }
});

test("catalogue.test.mjs (t) the scope choice is mvp or full", () => {
  const mvp = stage();
  const full = stage();
  try {
    const first = init(mvp, flow());
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const mvpAnswers = JSON.parse(readFileSync(path.join(mvp.project, "devos", "answers.json"), "utf8"));
    assert.equal(mvpAnswers.scope, "mvp");
    assert.equal(first.stdout.includes("Scope: mvp"), true, first.stdout);
    const second = init(full, flow({ scope: "2" }));
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const fullAnswers = JSON.parse(readFileSync(path.join(full.project, "devos", "answers.json"), "utf8"));
    assert.equal(fullAnswers.scope, "full");
    assert.equal(second.stdout.includes("Scope: full"), true, second.stdout);
  } finally {
    cleanup(mvp.parent);
    cleanup(full.parent);
  }
});
