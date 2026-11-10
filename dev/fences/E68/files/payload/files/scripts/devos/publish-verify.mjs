#!/usr/bin/env node
// The publish job's own git (PR-90). The cycle's `work` job builds and checks with no write token and hands over a git
// bundle; `publish` holds the tokens and runs no branch code. This script is the only place publish touches git, and it
// recomputes everything it decides from main's files: the bundle is data, never instructions.
//
//   verify  --task Tnn --attempt N --branch task/Tnn --main-sha <sha> --out <dir> [--bundle <file>] [--remote <url>]
//           [--base main|devos/unit-Tnn] [--builder true|false --exit <code> --model <id> --effort <e> --fast yes|no]
//           PR-91: a product task's base is its unit's branch; "main" below is that base, and --main-sha its commit.
//           Fetches main and the task branch into a repository it creates (<out>/decide), takes the bundle's one ref,
//           and rejects, each with its own line: (a) another ref, or more than one; (b) a head that does not descend
//           from the task branch on GitHub (or, for a new branch, from main at <sha>); (c) a symbolic link, a
//           submodule, a .gitmodules or a file over 50 MiB among the changed paths; (d) a change to a method file
//           (unless main's PHASES row is a method fix), to docs/fences/, docs/reviews/ or docs/PHASES.md; (e) a change
//           outside the builder's surface (main's devos.config.json surfaces, PR-07, PR-81). It compares the bundle
//           with the merge of the task branch and main that it computes itself, so main's changes are never the
//           builder's. Accepted: <out>/decide is checked out at the new head, main's method files are laid over it,
//           and <out>/verify.json records the result.
//           PR-94: the builder's model is kept only when main's configuration or --trusted-models names it (or one of
//           its effort and Fast variants), else "unknown"; its effort and Fast only from their fixed lists.
//   guards  --out <dir>                                          PR-94: main's guards on the verified tree, before any
//           push, with no secret and no package manager (DEVOS_GUARDS_NO_AUDIT); and main's secret rules on every file
//           this run changed, as it will be pushed. A secret finding, or guards that do not finish, rejects the bundle
//           (verify.json ok=false): nothing is pushed. Every other result is <out>/guards.json, for checks.
//   state   --out <dir> --claimed <state> [--not-before <iso>] [--picked <pool id>]     the builder's outcome, bounded
//   checks  --out <dir> [--ci <work's ci-results.json>]          the required checks from main's rules (needs DEVOS_ROOT);
//           PR-94: "guards" is publish's own run, red also when the work job's was
//   usage   --in <file> --dest <file>                            keeps only well-formed usage records
//   review-tree --out <dir> --dest <dir>                         the head's files, and .devos/diff.patch, for the review
//   take-review --out <dir> --from <dir> --task Tnn --attempt N  copies the review file and fences the reviewer wrote;
//           PR-94: a fence the head already has changes only with a higher Fence version, and each fence taken is
//           listed in .devos/fence-changes.txt
//   commit  --out <dir> --message <text> [--amend]               commits the runner's files (reviews, fences, PHASES, usage)
//   sync    --out <dir> [--remote <url>]                         merges a base (main or the unit) that moved meanwhile
//   push    --out <dir> [--remote <url>] [--to refs/heads/rescue/…]
//   plan    --kind intake|revise --branch <intake/issue-N | task/Tnn | devos/unit-Tnn> --base main --base-sha <sha>
//           --out <dir> --message <one line> [--bundle <file>] [--remote <url>] [--task Tnn] [--fresh true]
//           [--method true]
//           PR-92: a planning run's bundle (`/devos intake`, a method fix, `/devos revise`), checked like verify's (a)–(c),
//           then against main's surface for it: an intake plan only within surfaces.intake.allow, adding rows to
//           docs/PHASES.md without changing one or repeating a number (Phase PM only for a method fix); a revision only
//           docs/fences/<task>.md, on the task's branch or, for the last task of a unit (/devos revise on its acceptance
//           PR), on the unit's branch, where publish opens the task's row again. Accepted: the head, committed with
//           --message on what the planner started from, in <out>/decide, and <out>/verify.json for commit and push.
//
// Every git command runs with no system or global configuration, hooks off and no fsmonitor, in a repository this
// script created. DEVOS_GIT_TOKEN, when set, authenticates https://github.com through an environment header, never in
// a URL or on disk.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePhases, isMethodRow, matchesAny } from "./lib.mjs";
import { headOf, fenceMedia } from "./fence-check.mjs";

export const TRUSTED = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAX_FILE = 50 * 1024 * 1024;
export const MAX_BUNDLE = 1024 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;
const MAX_PATCH = 4 * 1024 * 1024;
const EFFORTS = ["low", "medium", "high", "xhigh"];
const STATES = ["ok", "continue", "switch", "quota", "error"];
/** PR-28: the method files. A product task never changes them; the same list as the cycle has always used. */
export const METHOD_RE = /^(\.github\/|scripts\/devos\/|scripts\/guards\/|devos\/|devos\.config\.json$|CLAUDE\.md$|\.claude\/|\.cursor\/(rules|hooks|cli))/;
/** A workflow or a local action: run by GitHub from the branch that holds it. */
export const WORKFLOW_RE = /^\.github\/(workflows|actions)\//;
/** vercel.json's programmatic forms, which Vercel evaluates as code. */
export const VERCEL_CODE_RE = /^vercel\.(ts|mts|js|mjs|cjs)$/;
/** Files only the reviewer or the runner writes, in every task. */
export const RUNNER_ONLY = (p) => p.startsWith("docs/fences/") || p.startsWith("docs/reviews/") || p === "docs/PHASES.md";
/** What the decision reads from main: laid over the workspace after checkout. */
export const OVERLAY = [".github", "scripts/devos", "scripts/guards", "devos", "devos.config.json", "CLAUDE.md", ".claude", ".cursor"];
/** The runner's own commit may hold only these. */
export const COMMIT_SURFACE = (p) =>
  /^docs\/reviews\/[^/]+\.md$/.test(p) || /^docs\/fences\/T\d{2}\.md$/.test(p) || p === "docs/PHASES.md" ||
  /^docs\/usage\/[A-Za-z0-9._-]+\.jsonl$/.test(p) || p === "docs/USAGE.md";

// ---------- git ----------------------------------------------------------------------------------------------------

function gitEnv(extra = {}, auth = false) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "devos-runner",
    GIT_AUTHOR_EMAIL: "devos-runner@users.noreply.github.com",
    GIT_COMMITTER_NAME: "devos-runner",
    GIT_COMMITTER_EMAIL: "devos-runner@users.noreply.github.com",
  });
  const token = process.env.DEVOS_GIT_TOKEN;
  if (auth && token) {
    const server = (process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `http.${server}/.extraheader`;
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return { ...env, ...extra };
}

/** One git command, hardened. Returns { status, stdout, stderr }; throws unless `allowFail`. */
export function g(args, { cwd, env = {}, auth = false, allowFail = false, input, encoding = "utf8" } = {}) {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
    cwd, env: gitEnv(env, auth), encoding, input, maxBuffer: 256 * 1024 * 1024,
  });
  const out = { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: String(r.stderr ?? "") };
  if (out.status !== 0 && !allowFail) {
    const e = new Error(`git ${args[0]} failed: ${out.stderr.trim().split(/\r?\n/).slice(-3).join(" / ")}`);
    e.git = out;
    throw e;
  }
  return out;
}
const sha = (cwd, rev) => g(["rev-parse", "--verify", "--quiet", rev], { cwd, allowFail: true }).stdout.trim();
const isAncestor = (cwd, a, b) => g(["merge-base", "--is-ancestor", a, b], { cwd, allowFail: true }).status === 0;
const commitTree = (cwd, tree, parents, message) =>
  g(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message], { cwd }).stdout.trim();

// ---------- arguments and state ------------------------------------------------------------------------------------

/** The flags that take no value; every other flag takes the next argument as it is, even one that starts with "--". */
const SWITCHES = new Set(["amend"]);
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (SWITCHES.has(key)) out[key] = true;
      else { out[key] = argv[i + 1] ?? ""; i++; }
    } else out._.push(a);
  }
  return out;
}
/** A path as it is safe to print in a log or a comment: quoted when it could be read as anything but a path. */
export const q = (p) => (/^[A-Za-z0-9_.@+\/-][A-Za-z0-9_.@+ \/-]*$/.test(String(p)) ? String(p) : JSON.stringify(String(p)));
const stateFile = (out) => path.join(out, "verify.json");
/** U5: nothing after verify runs on a bundle verify did not accept. */
function readState(out) {
  let s;
  try { s = JSON.parse(readFileSync(stateFile(out), "utf8")); } catch { die(`no ${stateFile(out)}: run verify first`); }
  if (s.ok !== true || !/^[0-9a-f]{40}$/.test(String(s.head ?? ""))) die("verify did not accept this bundle; nothing is done with it");
  return s;
}
const writeState = (out, s) => writeFileSync(stateFile(out), `${JSON.stringify(s, null, 2)}\n`);
function emit(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${String(v ?? "").replace(/\r?\n/g, " ")}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}
const die = (msg, code = 1) => { console.error(`publish-verify: ${msg}`); process.exit(code); };
const trustedText = (rel) => readFileSync(path.join(TRUSTED, rel), "utf8");
const remoteOf = (a) => a.remote || `${(process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "")}/${process.env.GITHUB_REPOSITORY}.git`;

/** The `-z --raw` diff between two trees: [{ path, oldMode, newMode, newSha, status }]. */
function rawDiff(cwd, a, b) {
  const text = g(["diff", "--raw", "-z", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv", a, b], { cwd }).stdout;
  const parts = text.split("\0");
  const entries = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/.exec(parts[i]);
    if (!m) continue;
    entries.push({ oldMode: m[1], newMode: m[2], newSha: m[4], status: m[5], path: parts[i + 1] });
  }
  return entries;
}

/** The fence's builder bookkeeping read back from this attempt's last builder commit on GitHub (PR-38, the slices). */
export function priorTags(subjects, task, attempt) {
  const prev = subjects.find((s) => s.startsWith(`${task} a${attempt}: builder `)) ?? "";
  const slice = /\(time slice (\d+)\)/.exec(prev);
  const done = /\(stage (\d+) of \d+ done\)/.exec(prev);
  const going = /\(stage (\d+) of \d+\)/.exec(prev);
  return {
    slice: slice ? Number(slice[1]) + 1 : 1,
    stage: done ? Number(done[1]) + 1 : going ? Number(going[1]) : 1,
  };
}

/** The builder commit's message, from publish's own count and the work job's claims, each checked. */
const MODEL_ID = /^[A-Za-z0-9._:/@+-]{1,100}$/;
const VARIANT = /(-(low|medium|high|xhigh))?(-fast)?(-(low|medium|high|xhigh))?$/;
/** PR-94 (N6): every model id main's configuration names (agents, builder), and those of this run's own choice. */
export function trustedModels(cfg, extra = []) {
  const out = new Set();
  const walk = (o, key) => {
    if (Array.isArray(o)) for (const x of o) walk(x, key);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, k);
    else if (typeof o === "string" && /model|family|fallback/i.test(key ?? "")) out.add(o);
  };
  walk(cfg?.agents, "agents");
  walk(cfg?.builder, "builder");
  for (const v of extra) for (const w of String(v ?? "").split(/[\s,]+/)) if (w) out.add(w);
  return [...out].filter((m) => MODEL_ID.test(m));
}
/** The work job's model, kept only when a trusted id names it or one of its effort and Fast variants; else "unknown". */
export function allowedModel(model, trusted) {
  const m = String(model ?? "");
  if (!MODEL_ID.test(m)) return "unknown";
  for (const t of trusted) {
    const base = String(t).replace(VARIANT, "");
    if (m === t || m === base) return m;
    if (base && m.startsWith(`${base}-`) && new RegExp(`^${VARIANT.source}`).test(m.slice(base.length))) return m;
  }
  return "unknown";
}

export function builderMessage({ task, attempt, model, effort, fast, exit, slice, stage, stages }) {
  const m = MODEL_ID.test(String(model ?? "")) ? model : "unknown";
  const e = EFFORTS.includes(effort) ? effort : "unknown";
  const f = fast === "yes" || fast === "no" ? fast : "unknown";
  let tag = String(exit) === "124" ? ` (time slice ${slice})` : "";
  if (stages > 1) tag = String(exit) === "0" ? ` (stage ${stage} of ${stages} done)` : ` (stage ${stage} of ${stages})${tag}`;
  return `${task} a${attempt}: builder (${m}, effort ${e}, fast ${f})${tag}`;
}

// ---------- verify -------------------------------------------------------------------------------------------------

export function verify(a) {
  const task = String(a.task ?? "");
  const attempt = Number(a.attempt);
  const branch = String(a.branch ?? "");
  const mainSha = String(a["main-sha"] ?? "");
  // PR-91: the base is main, or the unit branch a product task merges into; --main-sha is the base's commit.
  const baseName = String(a.base ?? "main");
  if (baseName !== "main" && !/^devos\/unit-T\d{2,3}$/.test(baseName)) die("--base must be main or devos/unit-Tnn", 2);
  if (!/^T\d{2}$/.test(task) || !Number.isInteger(attempt) || attempt < 1) die("usage: verify --task Tnn --attempt N …", 2);
  if (branch !== `task/${task}`) die(`the branch must be task/${task}`, 2);
  if (!/^[0-9a-f]{40}$/.test(mainSha)) die("--main-sha must be a full commit id", 2);
  const out = path.resolve(String(a.out ?? ""));
  const repo = path.join(out, "decide");
  if (existsSync(repo)) die(`${repo} exists: verify needs a fresh workspace`, 2);
  mkdirSync(out, { recursive: true });
  const builder = a.builder === "true" || a.builder === true;
  const remote = remoteOf(a);
  const reasons = [];
  const reject = (why) => reasons.push(why);
  const finish = (extra = {}) => {
    const result = { ok: reasons.length === 0, reasons, task, attempt, branch, main_sha: mainSha, base: baseName, ...extra };
    writeState(out, result);
    if (reasons.length) {
      for (const r of reasons) console.log(`REJECTED: ${r}`);
      console.log(`verify: the bundle is rejected (${reasons.length} reason${reasons.length > 1 ? "s" : ""}); nothing is pushed`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=false\nreasons=${reasons.join(" · ").replace(/\r?\n/g, " ").slice(0, 3000)}\n`);
      process.exit(1);
    }
    return result;
  };

  // The repository: created here, with nothing of the branch's but objects.
  g(["init", "-q", repo]);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["core.fsmonitor", "false"], ["gc.auto", "0"], ["user.name", "devos-runner"], ["user.email", "devos-runner@users.noreply.github.com"]]) {
    g(["config", k, v], { cwd: repo });
  }
  // The base and the task branch, from GitHub (or a test's remote). A new unit's branch is made after verify.
  if (g(["ls-remote", remote, `refs/heads/${baseName}`], { cwd: repo, auth: true }).stdout.trim()) {
    g(["fetch", "-q", "--no-tags", remote, `+refs/heads/${baseName}:refs/devos/base-latest`], { cwd: repo, auth: true });
  }
  const listed = g(["ls-remote", remote, `refs/heads/${branch}`], { cwd: repo, auth: true }).stdout.trim();
  let remoteHead = "";
  if (listed) {
    g(["fetch", "-q", "--no-tags", remote, `+refs/heads/${branch}:refs/devos/remote-branch`], { cwd: repo, auth: true });
    remoteHead = sha(repo, "refs/devos/remote-branch");
  }
  if (!sha(repo, `${mainSha}^{commit}`)) g(["fetch", "-q", "--no-tags", remote, mainSha], { cwd: repo, auth: true });
  if (!sha(repo, `${mainSha}^{commit}`)) die(`${baseName}'s commit ${mainSha} is not on ${remote}`);

  // (a) the bundle: exactly one ref, the task branch.
  const bundle = a.bundle ? path.resolve(String(a.bundle)) : "";
  let bundleHead = "";
  let bundleSha256 = "";
  if (bundle && existsSync(bundle)) {
    const size = lstatSync(bundle).size;
    if (!lstatSync(bundle).isFile() || size > MAX_BUNDLE) reject(`(a) the bundle is not a regular file of at most ${MAX_BUNDLE} bytes`);
    else {
      bundleSha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex");
      const heads = g(["bundle", "list-heads", bundle], { cwd: repo, allowFail: true });
      const refs = heads.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(" "));
      if (heads.status !== 0) reject("(a) the bundle cannot be read");
      else if (refs.length !== 1) reject(`(a) the bundle carries ${refs.length} refs (${refs.map((r) => r[1]).join(", ")}); only refs/heads/${branch} is allowed`);
      else if (refs[0][1] !== `refs/heads/${branch}`) reject(`(a) the bundle carries ${refs[0][1]}; only refs/heads/${branch} is allowed`);
      else if (g(["bundle", "verify", "-q", bundle], { cwd: repo, allowFail: true }).status !== 0) reject("(a) the bundle needs commits that are on neither main nor the task branch");
      else {
        const f = g(["-c", "fetch.fsckObjects=true", "fetch", "-q", "--no-tags", bundle, `refs/heads/${branch}:refs/devos/bundle`], { cwd: repo, allowFail: true });
        if (f.status !== 0) reject(`(a) the bundle's objects fail git's checks: ${f.stderr.trim().split(/\r?\n/).pop()}`);
        else bundleHead = sha(repo, "refs/devos/bundle");
      }
    }
  } else if (builder) reject("(a) the work job handed over no bundle, though its builder ran");
  if (reasons.length) return finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256 });

  // (b) the head descends from what is on GitHub.
  const base = remoteHead || mainSha;
  if (bundleHead && !isAncestor(repo, base, bundleHead)) {
    reject(`(b) the bundle's head ${bundleHead.slice(0, 12)} does not descend from ${remoteHead ? `${branch} on GitHub` : baseName === "main" ? "main at the run's commit" : `${baseName} at the run's start`} (${base.slice(0, 12)})`);
    return finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256 });
  }

  // The merge of the task branch and main, computed here: what the builder started from.
  let merge = mainSha;
  if (remoteHead) {
    if (isAncestor(repo, mainSha, remoteHead)) merge = remoteHead;
    else {
      const m = g(["merge-tree", "--write-tree", "--no-messages", "--name-only", remoteHead, mainSha], { cwd: repo, allowFail: true });
      const lines = m.stdout.split(/\r?\n/);
      if (m.status !== 0) {
        reject(`${branch} and ${baseName} conflict: ${lines.slice(1).filter(Boolean).join(", ") || "(unknown paths)"}`);
        return finish({ remote_head: remoteHead, bundle_sha256: bundleSha256 });
      }
      merge = commitTree(repo, lines[0].trim(), [remoteHead, mainSha], `Merge ${baseName} into ${branch}`);
    }
  }
  const baseTree = sha(repo, `${merge}^{tree}`);
  const headTree = bundleHead ? sha(repo, `${bundleHead}^{tree}`) : baseTree;
  const entries = rawDiff(repo, baseTree, headTree);

  // The rules, from main.
  let cfg = {};
  try { cfg = JSON.parse(trustedText("devos.config.json")); } catch { die("main's devos.config.json cannot be read"); }
  const rows = parsePhases(trustedText("docs/PHASES.md")).rows;
  const row = rows.find((r) => r.task === task);
  if (!row) die(`${task} is not in main's docs/PHASES.md`);
  const method = isMethodRow(row);
  const surfaces = cfg.surfaces ?? {};
  const ignore = surfaces.ignore ?? [];
  const deny = method ? (surfaces.builder_method?.deny ?? surfaces.builder?.deny ?? []) : (surfaces.builder?.deny ?? []);
  // PR-81: the media the fence names are made by the runner's step before the builder, in the same job.
  const show = (rev, rel) => g(["show", `${rev}:${rel}`], { cwd: repo, allowFail: true });
  const fence = show(merge, `docs/fences/${task}.md`).stdout;
  const mediaIds = fenceMedia(fence) ?? [];
  let planned = [];
  try { planned = JSON.parse(show(merge, "docs/design/media.json").stdout || "{}").items ?? []; } catch { planned = []; }
  const plannedFiles = new Set(planned.filter((i) => i && typeof i.file === "string").map((i) => i.file));
  const mediaAllowed = new Set(planned.filter((i) => i && mediaIds.includes(i.id) && typeof i.file === "string").map((i) => i.file));
  if (mediaIds.length) { mediaAllowed.add("docs/design/media.json"); mediaAllowed.add("docs/usage/media.jsonl"); }

  const blobs = entries.filter((e) => e.status !== "D" && e.newMode !== "120000" && e.newMode !== "160000");
  const sizes = new Map();
  if (blobs.length) {
    const lines = g(["cat-file", "--batch-check=%(objectname) %(objectsize)"], { cwd: repo, input: `${blobs.map((e) => e.newSha).join("\n")}\n` }).stdout.split(/\r?\n/);
    for (const line of lines) { const [oid, size] = line.split(" "); if (oid) sizes.set(oid, Number(size)); }
  }
  const changed = [];
  for (const e of entries) {
    const p = e.path;
    const n = q(p);
    changed.push(p);
    // (c) what a tree may not bring.
    if (/[\x00-\x1f\x7f]/.test(p)) { reject(`(c) ${n}: a control character in the path`); continue; }
    if (p.split("/").pop() === ".gitmodules") reject(`(c) ${n}: a .gitmodules file`);
    if (e.status !== "D") {
      if (e.newMode === "120000") reject(`(c) ${n}: a symbolic link`);
      else if (e.newMode === "160000") reject(`(c) ${n}: a submodule`);
      else if ((sizes.get(e.newSha) ?? 0) > MAX_FILE) reject(`(c) ${n}: ${sizes.get(e.newSha)} bytes, over the ${MAX_FILE}-byte cap`);
    }
    if (p === ".devos" || p.startsWith(".devos/")) { reject(`(e) ${n}: the runner's working folder is never committed`); continue; }
    if (matchesAny(p, ignore)) continue;
    // A workflow or an action of the branch would run, with the repository's secrets, on the push that brings it: DEV_OS
    // never pushes one, not even in a method fix. A person applies such a fix from the run's artifact.
    if (WORKFLOW_RE.test(p)) { reject(`(d) ${n}: a workflow or action file; DEV_OS never pushes one (PR-90)`); continue; }
    // (d) the method and the runner's files.
    if (METHOD_RE.test(p) && !method) { reject(`(d) ${n}: a method file, and ${task} is not a method fix (PR-28)`); continue; }
    if (RUNNER_ONLY(p)) { reject(`(d) ${n}: only the reviewer or the runner writes it`); continue; }
    // (e) the builder's surface; vercel.json's programmatic forms with it.
    if (mediaAllowed.has(p)) continue;
    if (matchesAny(p, deny) || (deny.includes("vercel.json") && VERCEL_CODE_RE.test(p))) { reject(`(e) ${n}: outside the builder's surface (devos.config.json surfaces.${method ? "builder_method" : "builder"}.deny)`); continue; }
    if (plannedFiles.has(p)) reject(`(e) ${n}: a planned media file the fence does not name (PR-81)`);
  }
  // The decision reads the task's risk and gate from main; the branch's row must agree.
  try {
    const branchRow = parsePhases(show(merge, "docs/PHASES.md").stdout).rows.find((r) => r.task === task);
    if (!branchRow || branchRow.risk !== row.risk || String(branchRow.gate) !== String(row.gate)) {
      reject(`(d) docs/PHASES.md: ${task}'s risk or gate on ${branch} differs from main's`);
    }
  } catch { reject(`(d) docs/PHASES.md on ${branch} cannot be read`); }
  if (!builder && entries.length) reject(`a run without a builder changed ${entries.length} path(s): ${changed.slice(0, 8).map(q).join(", ")}`);
  if (reasons.length) return finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256, changed });

  // Accepted: the head publish will push.
  let headCommit = merge;
  let tags = { slice: 1, stage: 1 };
  const stages = Number(/^- Stages: *(\d+)/m.exec(fence)?.[1] ?? 1) || 1;
  // PR-94 (N6): what the work job says of its builder reaches a commit and the reviewer's prompt only from fixed lists.
  const told = {
    model: allowedModel(a.model, trustedModels(cfg, [a["trusted-models"]])),
    effort: EFFORTS.includes(a.effort) ? a.effort : "unknown",
    fast: a.fast === "yes" || a.fast === "no" ? a.fast : "unknown",
  };
  if (builder) {
    const subjects = remoteHead ? g(["log", "-20", "--format=%s", remoteHead], { cwd: repo }).stdout.split(/\r?\n/) : [];
    tags = priorTags(subjects, task, attempt);
    if (tags.stage > stages) tags.stage = stages;
    const message = builderMessage({ task, attempt, model: told.model, effort: told.effort, fast: told.fast, exit: a.exit, slice: tags.slice, stage: tags.stage, stages });
    headCommit = commitTree(repo, headTree, [merge], message);
  }
  g(["update-ref", `refs/remotes/origin/${baseName}`, mainSha], { cwd: repo });
  g(["checkout", "-q", "-f", "-B", branch, headCommit], { cwd: repo });
  for (const rel of OVERLAY) {
    rmSync(path.join(repo, rel), { recursive: true, force: true });
    if (existsSync(path.join(TRUSTED, rel))) cpSync(path.join(TRUSTED, rel), path.join(repo, rel), { recursive: true, verbatimSymlinks: true });
  }
  rmSync(path.join(repo, ".devos"), { recursive: true, force: true });
  mkdirSync(path.join(repo, ".devos"), { recursive: true });
  // PR-28: a branch that changes the method, in any attempt, gets the deep review and stops at the human gate.
  const methodChanged = g(["diff", "--name-only", "--no-renames", "-z", `${mainSha}...${headCommit}`], { cwd: repo }).stdout.split("\0").some((p) => METHOD_RE.test(p));
  const result = finish({
    remote_head: remoteHead || null, merge, bundle_head: bundleHead || null, bundle_sha256: bundleSha256, head: headCommit,
    builder, method, method_changed: methodChanged, changed, slice: tags.slice, stage: tags.stage, stages,
    max_slices: cfg.builder?.max_time_slices ?? 4, exit: String(a.exit ?? ""),
  });
  const vsMain = g(["diff", "--name-only", "--no-renames", "-z", `${mainSha}...${headCommit}`], { cwd: repo }).stdout.split("\0").filter(Boolean);
  console.log(`verify: OK · head ${headCommit} · ${changed.length} path(s) changed by this run`);
  for (const p of changed) console.log(`  ${q(p)}`);
  console.log(`diff ${mainSha.slice(0, 12)}...${headCommit.slice(0, 12)}:`);
  for (const p of vsMain) console.log(`  ${q(p)}`);
  emit({ ok: "true", head: headCommit, method_changed: methodChanged, slice: tags.slice, stage: tags.stage, stages, bundle_sha256: bundleSha256,
    builder_model: told.model, builder_effort: told.effort, builder_fast: told.fast });
  return result;
}

// ---------- main's guards, before any push (PR-94, N2) -------------------------------------------------------------

const GUARD_TIMEOUT = 300000;
/** A finding without the text of its line: a secret's line is never repeated in a log, a comment or an artifact. */
const findingLine = (f) => String(f).replace(/^(.*? — [^:]*):.*$/s, "$1").slice(0, 300);

/** main's secret rules (`rules`, `skip`: guard:secrets') on every path this run changed, read from the head to be pushed. */
export function secretsInChange(repo, head, paths, { rules, skip }) {
  const found = [];
  for (const p of paths) {
    if (skip.some((re) => re.test(p))) continue;
    const blob = g(["cat-file", "-p", `${head}:${p}`], { cwd: repo, allowFail: true });
    if (blob.status !== 0) continue;
    blob.stdout.split(/\r?\n/).forEach((line, i) => {
      for (const { re, label } of rules) {
        re.lastIndex = 0;
        if (re.test(line)) found.push(`${q(p)}:${i + 1} — ${label}`);
      }
    });
  }
  return found;
}

export async function guards(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  const repo = path.join(out, "decide");
  // main's own copy of guard:secrets' rules, beside this script: a copy that cannot load rejects (nothing is pushed).
  let secretRules = null;
  try {
    const mod = await import(new URL("../guards/secrets.mjs", import.meta.url).href);
    if (Array.isArray(mod.RULES) && Array.isArray(mod.SKIP)) secretRules = { rules: mod.RULES, skip: mod.SKIP };
  } catch { secretRules = null; }
  // No secret, no token and no package manager: only main's guard code over the verified tree's files.
  const env = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C.UTF-8", TASK: s.task, DEVOS_SCOPE_BASE: s.main_sha,
    DEVOS_GUARDS_NO_AUDIT: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of ["TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec"]) if (process.env[name]) env[name] = process.env[name];
  const run = spawnSync(process.execPath, [path.join(repo, "scripts", "guards", "run-all.mjs"), "--json"], {
    cwd: repo, env, encoding: "utf8", timeout: GUARD_TIMEOUT, maxBuffer: 64 * 1024 * 1024,
  });
  let results = null;
  try {
    const parsed = JSON.parse(run.stdout || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) results = parsed;
  } catch { results = null; }
  const reasons = [];
  if (!results) reasons.push(`(f) main's guards did not finish on the verified tree (${run.error ? run.error.code || "error" : `exit ${run.status}`}); nothing is pushed until they do`);
  else if (results.secrets?.status !== "PASS") {
    const found = Array.isArray(results.secrets?.findings) && results.secrets.findings.length ? results.secrets.findings : ["guard:secrets did not pass"];
    reasons.push(...found.slice(0, 20).map((f) => `(f) guard:secrets: ${findingLine(f)}`));
  }
  if (!secretRules) reasons.push("(f) main's secret rules (scripts/guards/secrets.mjs) cannot be loaded; nothing is pushed until they can");
  else for (const f of secretsInChange(repo, s.head, Array.isArray(s.changed) ? s.changed : [], secretRules).slice(0, 20)) reasons.push(`(f) a secret in this run's change: ${f}`);
  const failed = results ? Object.entries(results).filter(([, r]) => r?.status === "FAIL").map(([n]) => n) : [];
  const lines = results ? Object.entries(results).flatMap(([n, r]) => [
    `guard:${n} ${String(r?.status ?? "?")}${r?.note ? ` (${String(r.note).slice(0, 300)})` : ""}`,
    ...(Array.isArray(r?.findings) ? r.findings.slice(0, 20).map((f) => `    ${n === "secrets" ? findingLine(f) : String(f).slice(0, 300)}`) : []),
  ]) : [];
  writeFileSync(path.join(out, "guards.json"), `${JSON.stringify({ finished: Boolean(results), exit: run.status, failed, lines }, null, 2)}\n`);
  for (const l of lines) console.log(l);
  if (reasons.length) {
    writeState(out, { ...s, ok: false, reasons: [...(Array.isArray(s.reasons) ? s.reasons : []), ...reasons] });
    for (const r of reasons) console.log(`REJECTED: ${r}`);
    console.log("guards: a secret, or guards that did not finish; the bundle is rejected and nothing is pushed");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=false\n`);
    process.exit(1);
  }
  console.log(failed.length ? `guards: ${failed.join(", ")} failed (red in the checks; the review decides)` : "guards: every guard passed on the verified tree");
  emit({ guards: failed.length ? "fail" : "pass", guards_failed: failed.join(",") });
}

// ---------- a planning run's bundle (PR-92) --------------------------------------------------------------------------

export function plan(a) {
  const kind = String(a.kind ?? "");
  const branch = String(a.branch ?? "");
  const baseName = String(a.base ?? "main");
  const baseSha = String(a["base-sha"] ?? "");
  const task = String(a.task ?? "");
  const message = String(a.message ?? "").trim();
  const fresh = a.fresh === "true";
  const method = a.method === "true";
  // PR-92: /devos revise on a unit's acceptance PR revises the unit's last task on the unit's branch, and reopens its row.
  const reopen = kind === "revise" && branch === `devos/unit-${task}`;
  if (!["intake", "revise"].includes(kind)) die("--kind must be intake or revise", 2);
  if (kind === "intake" && !/^intake\/issue-\d{1,7}$/.test(branch)) die("an intake plan's branch is intake/issue-N", 2);
  if (kind === "revise" && (!/^T\d{2}$/.test(task) || (branch !== `task/${task}` && !reopen))) die("a revision's branch is task/<--task>, or devos/unit-<--task> for its unit", 2);
  if (baseName !== "main") die("--base is main: a plan is made on main", 2);
  if (kind === "intake" && !/^[0-9a-f]{40}$/.test(baseSha)) die("--base-sha must be a full commit id", 2);
  if (kind === "intake" && (!message || message.length > 300 || /[\r\n]/.test(message))) die("--message must be one line of at most 300 characters", 2);
  const out = path.resolve(String(a.out ?? ""));
  const repo = path.join(out, "decide");
  if (existsSync(repo)) die(`${repo} exists: plan needs a fresh workspace`, 2);
  mkdirSync(out, { recursive: true });
  const remote = remoteOf(a);
  const reasons = [];
  const reject = (why) => reasons.push(why);
  const finish = (extra = {}) => {
    const result = { ok: reasons.length === 0, reasons, kind, branch, base: baseName, main_sha: baseSha, task: task || null, ...extra };
    writeState(out, result);
    if (reasons.length) {
      for (const r of reasons) console.log(`REJECTED: ${r}`);
      console.log(`plan: rejected (${reasons.length} reason${reasons.length > 1 ? "s" : ""}); nothing is pushed`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=false\nreasons=${reasons.join(" · ").replace(/\r?\n/g, " ").slice(0, 3000)}\n`);
      process.exit(1);
    }
    return result;
  };

  g(["init", "-q", repo]);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["core.fsmonitor", "false"], ["gc.auto", "0"], ["user.name", "devos-runner"], ["user.email", "devos-runner@users.noreply.github.com"]]) {
    g(["config", k, v], { cwd: repo });
  }
  if (kind === "intake") {
    // The planner's job says which commit of the base it started from; it must be one of the base's own.
    if (!g(["ls-remote", remote, `refs/heads/${baseName}`], { cwd: repo, auth: true }).stdout.trim()) die(`${baseName} is not on ${remote}`);
    g(["fetch", "-q", "--no-tags", remote, `+refs/heads/${baseName}:refs/devos/base-latest`], { cwd: repo, auth: true });
    if (!sha(repo, `${baseSha}^{commit}`) || !isAncestor(repo, baseSha, "refs/devos/base-latest")) die(`${baseSha} is not a commit of ${baseName}`);
  }
  let remoteHead = "";
  if (g(["ls-remote", remote, `refs/heads/${branch}`], { cwd: repo, auth: true }).stdout.trim()) {
    g(["fetch", "-q", "--no-tags", remote, `+refs/heads/${branch}:refs/devos/remote-branch`], { cwd: repo, auth: true });
    remoteHead = sha(repo, "refs/devos/remote-branch");
  }
  if (kind === "revise" && !remoteHead) die(`${branch} is not on ${remote}`);

  // (a) one ref, the branch.
  const bundle = a.bundle ? path.resolve(String(a.bundle)) : "";
  let head = "";
  let bundleSha256 = "";
  if (!bundle || !existsSync(bundle) || !lstatSync(bundle).isFile() || lstatSync(bundle).size > MAX_BUNDLE) reject("(a) the planning job handed over no bundle");
  else {
    bundleSha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex");
    const heads = g(["bundle", "list-heads", bundle], { cwd: repo, allowFail: true });
    const refs = heads.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(" "));
    if (heads.status !== 0) reject("(a) the bundle cannot be read");
    else if (refs.length !== 1 || refs[0][1] !== `refs/heads/${branch}`) reject(`(a) the bundle carries ${refs.map((r) => r[1]).join(", ") || "no ref"}; only refs/heads/${branch} is allowed`);
    else if (g(["bundle", "verify", "-q", bundle], { cwd: repo, allowFail: true }).status !== 0) reject(`(a) the bundle needs commits that are on neither ${baseName} nor ${branch}`);
    else {
      const f = g(["-c", "fetch.fsckObjects=true", "fetch", "-q", "--no-tags", bundle, `refs/heads/${branch}:refs/devos/bundle`], { cwd: repo, allowFail: true });
      if (f.status !== 0) reject(`(a) the bundle's objects fail git's checks: ${f.stderr.trim().split(/\r?\n/).pop()}`);
      else head = sha(repo, "refs/devos/bundle");
    }
  }
  if (reasons.length) return finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256 });

  // (b) what the planner started from: the task branch (a revision), the base (a fresh plan), or the plan on GitHub with
  // the base merged in (a resumed plan).
  let from = baseSha;
  if (kind === "revise") from = remoteHead;
  else if (!fresh && remoteHead) {
    if (isAncestor(repo, baseSha, remoteHead)) from = remoteHead;
    else {
      const m = g(["merge-tree", "--write-tree", "--no-messages", "--name-only", remoteHead, baseSha], { cwd: repo, allowFail: true });
      if (m.status !== 0) { reject(`${branch} and ${baseName} conflict: plan afresh with \`/devos intake\``); return finish({ remote_head: remoteHead, bundle_sha256: bundleSha256 }); }
      from = commitTree(repo, m.stdout.split(/\r?\n/)[0].trim(), [remoteHead, baseSha], `Merge ${baseName} into ${branch}`);
    }
  }
  const anchor = kind === "revise" || (!fresh && remoteHead) ? remoteHead : baseSha;
  if (!isAncestor(repo, anchor, head)) {
    reject(`(b) the bundle's head ${head.slice(0, 12)} does not descend from ${anchor === remoteHead ? `${branch} on GitHub` : `${baseName} at the run's start`}`);
    return finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256 });
  }
  const fromTree = sha(repo, `${from}^{tree}`);
  const headTree = sha(repo, `${head}^{tree}`);
  const entries = rawDiff(repo, fromTree, headTree);

  // (c)–(e), against main's surfaces.
  let cfg = {};
  try { cfg = JSON.parse(trustedText("devos.config.json")); } catch { die("main's devos.config.json cannot be read"); }
  const allow = cfg.surfaces?.intake?.allow ?? [];
  const blobs = entries.filter((e) => e.status !== "D" && e.newMode !== "120000" && e.newMode !== "160000");
  const sizes = new Map();
  if (blobs.length) {
    const lines = g(["cat-file", "--batch-check=%(objectname) %(objectsize)"], { cwd: repo, input: `${blobs.map((e) => e.newSha).join("\n")}\n` }).stdout.split(/\r?\n/);
    for (const line of lines) { const [oid, size] = line.split(" "); if (oid) sizes.set(oid, Number(size)); }
  }
  const changed = [];
  for (const e of entries) {
    const p = e.path;
    const n = q(p);
    changed.push(p);
    if (/[\x00-\x1f\x7f]/.test(p)) { reject(`(c) ${n}: a control character in the path`); continue; }
    if (p.split("/").pop() === ".gitmodules") reject(`(c) ${n}: a .gitmodules file`);
    if (e.status !== "D") {
      if (e.newMode === "120000") reject(`(c) ${n}: a symbolic link`);
      else if (e.newMode === "160000") reject(`(c) ${n}: a submodule`);
      else if ((sizes.get(e.newSha) ?? 0) > MAX_FILE) reject(`(c) ${n}: ${sizes.get(e.newSha)} bytes, over the ${MAX_FILE}-byte cap`);
    }
    if (kind === "revise") { if (p !== `docs/fences/${task}.md`) reject(`(e) ${n}: a revision changes only docs/fences/${task}.md`); continue; }
    if (!matchesAny(p, allow)) reject(`(e) ${n}: outside the intake surface (devos.config.json surfaces.intake.allow)`);
  }
  if (kind === "revise" && !changed.includes(`docs/fences/${task}.md`)) reject(`(e) the revision did not change docs/fences/${task}.md`);
  // A plan adds rows to docs/PHASES.md; it never changes one, so no task is ticked, re-scoped or un-gated by planning.
  if (kind === "intake" && changed.includes("docs/PHASES.md")) {
    try {
      const before = parsePhases(g(["show", `${from}:docs/PHASES.md`], { cwd: repo }).stdout).rows;
      const after = parsePhases(g(["show", `${head}:docs/PHASES.md`], { cwd: repo }).stdout).rows;
      const cells = (r) => [r.task, r.phase, r.station, r.name, r.risk, r.gate, r.doneRaw, r.verdict].join("|");
      for (const r of before) {
        const now = after.find((x) => x.task === r.task);
        if (!now) reject(`(d) docs/PHASES.md: ${r.task}'s row is removed (a plan only adds rows)`);
        else if (cells(now) !== cells(r)) reject(`(d) docs/PHASES.md: ${r.task}'s row is changed (a plan only adds rows)`);
      }
      const dup = [...new Set(after.map((r) => r.task).filter((t, i, all) => all.indexOf(t) !== i))];
      if (dup.length) reject(`(d) docs/PHASES.md: ${dup.join(", ")} has more than one row`);
      const added = after.filter((x) => !before.some((r) => r.task === x.task));
      for (const r of added) {
        if (r.done || !/^[—-]$/.test(r.verdict)) reject(`(d) docs/PHASES.md: the new row ${r.task} is ticked or has a verdict`);
        if (method && !isMethodRow(r)) reject(`(d) docs/PHASES.md: a method fix adds Phase PM rows only, not ${r.task} (Phase ${r.phase})`);
      }
    } catch (e) { reject(`(d) docs/PHASES.md cannot be read: ${String(e.message).slice(0, 200)}`); }
  }
  if (reasons.length) return finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256, changed });

  // Accepted: the planner's tree, committed by publish on what the planner started from. A revision's message names the
  // next attempt, counted here from the branch (next-task.mjs reads that line to allow a human revision past the cap).
  let attempt = null;
  let text = message;
  if (kind === "revise") {
    const reviews = g(["ls-tree", "--name-only", `${remoteHead}:docs/reviews`], { cwd: repo, allowFail: true }).stdout.split(/\r?\n/);
    const subjects = g(["log", "-300", "--format=%s", remoteHead], { cwd: repo }).stdout.split(/\r?\n/);
    let last = 0;
    for (const n of reviews) last = Math.max(last, Number(new RegExp(`^${task}-a(\\d+)\\.md$`).exec(n)?.[1] ?? 0));
    for (const l of subjects) last = Math.max(last, Number(new RegExp(`^${task} a(\\d+):`).exec(l)?.[1] ?? 0));
    attempt = last + 1;
    text = `${task}: fence reissued for human revision (attempt ${attempt})`;
  }
  const commit = headTree === fromTree ? from : commitTree(repo, headTree, [from], text);
  if (baseSha) g(["update-ref", `refs/remotes/origin/${baseName}`, baseSha], { cwd: repo });
  g(["checkout", "-q", "-f", "-B", branch, commit], { cwd: repo });
  for (const rel of OVERLAY) {
    rmSync(path.join(repo, rel), { recursive: true, force: true });
    if (existsSync(path.join(TRUSTED, rel))) cpSync(path.join(TRUSTED, rel), path.join(repo, rel), { recursive: true, verbatimSymlinks: true });
  }
  rmSync(path.join(repo, ".devos"), { recursive: true, force: true });
  mkdirSync(path.join(repo, ".devos"), { recursive: true });
  // PR-92: on a unit, the revised task's row is opened again (Done [ ], Verdict "REVISE aN — …"), so the cycle builds
  // attempt N inside the unit; `commit --amend` takes it into publish's commit. Its earlier review stays as the record of
  // what passed.
  if (reopen) {
    const file = path.join(repo, "docs", "PHASES.md");
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const parsed = (() => { try { return parsePhases(text); } catch { return null; } })();
    const row = parsed?.rows.find((r) => r.task === task);
    if (!row) die(`${task} is not in ${branch}'s docs/PHASES.md`);
    // One revision at a time: an open row is being built again already (its task PR takes a further /devos revise).
    if (!row.done) die(`${task} is already being revised on ${branch}: comment /devos revise on its task PR instead`);
    // The row carries its attempt ("REVISE aN — …"), so any run of it builds that attempt, as a revision, reviewed deep.
    const cells = parsed.lines[row.line].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    cells[6] = "[ ]";
    cells[7] = `REVISE a${attempt} — your revision on the acceptance PR (PR-92)`;
    parsed.lines[row.line] = `| ${cells.join(" | ")} |`;
    writeFileSync(file, parsed.lines.join(text.includes("\r\n") ? "\r\n" : "\n"));
  }
  const lease = kind === "intake" && fresh && remoteHead ? remoteHead : null;
  const result = finish({ remote_head: remoteHead || null, bundle_sha256: bundleSha256, head: commit, changed, lease, fresh, attempt, own: commit !== from });
  console.log(`plan: OK · head ${commit} · ${changed.length} path(s) changed`);
  for (const p of changed) console.log(`  ${q(p)}`);
  // What the plan holds against its base: nothing means the planner accepted without writing a plan.
  const planned = kind === "intake" ? rawDiff(repo, sha(repo, `${baseSha}^{tree}`), headTree).length : changed.length;
  emit({ ok: "true", head: commit, bundle_sha256: bundleSha256, changed: String(changed.length), planned: String(planned), attempt: attempt ?? "", own: commit !== from ? "true" : "false" });
  return result;
}

// ---------- the builder's outcome, bounded ------------------------------------------------------------------------

/**
 * The work job's builder-status (PR-12) is a claim. It can only delay or stop a task, never pass it: a time slice or a
 * stage continues within main's limits, a switch happens once (PR-76), anything else unknown is an error.
 */
export function boundState({ claimed, exit, slice, stage, stages, maxSlices, picked, fallback, notBefore, now = Date.now() }) {
  let state = STATES.includes(claimed) ? claimed : "error";
  let note = STATES.includes(claimed) ? "" : `the work job reported no known builder state (${String(claimed).slice(0, 40)})`;
  if (state === "continue") {
    const sliceLeft = String(exit) === "124" && slice < maxSlices;
    const stageLeft = stages > 1 && String(exit) === "0" && stage < stages;
    if (!sliceLeft && !stageLeft) { state = "error"; note = `no time slice or stage is left (slice ${slice} of ${maxSlices}, stage ${stage} of ${stages})`; }
  }
  if (state === "switch" && (!fallback || picked === fallback)) { state = "quota"; note = "the fallback builder is already building, or none is set (PR-76)"; }
  let nb = "";
  if (state === "quota") {
    const t = Date.parse(String(notBefore ?? ""));
    nb = Number.isFinite(t) && t > now - 3600e3 && t < now + 8 * 86400e3 ? new Date(t).toISOString() : new Date(now + 3600e3).toISOString();
  }
  return { state, note, not_before: nb };
}

function state(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  let cfg = {};
  try { cfg = JSON.parse(trustedText("devos.config.json")); } catch { /* defaults */ }
  const r = boundState({
    claimed: String(a.claimed ?? ""), exit: s.exit, slice: s.slice, stage: s.stage, stages: s.stages,
    maxSlices: s.max_slices, picked: String(a.picked ?? ""), fallback: cfg.agents?.fallback_builder ?? "", notBefore: a["not-before"],
  });
  if (r.note) console.log(`builder state: ${r.note}`);
  emit(r);
}

// ---------- checks: red blocks, green is a claim -------------------------------------------------------------------

/** The required checks, from main's configuration over the verified tree (DEVOS_ROOT), and the work job's results. */
export async function requiredFor({ root, cfg, fenceText, results }) {
  const required = new Set(cfg.required_checks ?? []);
  const toolchain = cfg.stack?.toolchain ?? "node";
  if (toolchain === "node") {
    for (const name of ["supabase", "r2", "firebase"]) {
      try {
        const mod = await import(`./${name === "firebase" ? "firebase" : name}.mjs`);
        if (mod.isActive?.()) for (const c of mod.moduleConfig?.()?.required_checks ?? []) required.add(c);
      } catch { /* a module that cannot load adds nothing */ }
    }
  }
  if (/^- Screens:/m.test(headOf(fenceText))) { required.add("ui-evidence"); required.add("a11y"); }
  if (/^- Launch:/m.test(fenceText)) required.add("readiness");
  for (const r of results) if (r.required === true && typeof r.name === "string") required.add(r.name);
  return [...required];
}

async function checks(a) {
  const root = process.env.DEVOS_ROOT;
  if (!root) die("checks needs DEVOS_ROOT (the verified workspace)", 2);
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  let work = {};
  try { work = JSON.parse(readFileSync(String(a.ci ?? ""), "utf8")); } catch { work = {}; }
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const results = (Array.isArray(work.results) ? work.results : []).filter((r) => r && typeof r.name === "string" && /^[A-Za-z0-9:._-]{1,60}$/.test(r.name))
    .map((r) => ({ name: r.name, required: r.required === true, command: str(r.command, 300), status: /^[a-z][a-z-]{0,39}$/.test(String(r.status)) ? r.status : "missing", exit: Number.isInteger(r.exit) ? r.exit : null, seconds: Number.isFinite(r.seconds) ? r.seconds : null, tail: str(r.tail, 8000), reported_by: "work" }));
  // PR-94 (N2): the guards are publish's own run on the verified tree; a red the work job reported stays red.
  let own = null;
  try { own = JSON.parse(readFileSync(path.join(out, "guards.json"), "utf8")); } catch { own = null; }
  if (own?.finished === true) {
    const work = results.find((r) => r.name === "guards");
    const workRed = Boolean(work) && work.status !== "pass";
    const mine = {
      name: "guards", required: work?.required === true, command: "node scripts/guards/run-all.mjs (main's, run by publish on the verified tree; the dependency audit stays the work job's)",
      status: (Array.isArray(own.failed) && own.failed.length) || workRed ? "fail" : "pass", exit: Number.isInteger(own.exit) ? own.exit : null, seconds: null,
      tail: [...(Array.isArray(own.lines) ? own.lines.map(String) : []), ...(workRed ? [`the work job's own run of the guards: ${work.status}`, work.tail] : [])].join("\n").slice(0, 8000),
      reported_by: "publish",
    };
    if (work) results.splice(results.indexOf(work), 1, mine); else results.push(mine);
  }
  const cfg = JSON.parse(readFileSync(path.join(root, "devos.config.json"), "utf8"));
  let fenceText = "";
  try { fenceText = readFileSync(path.join(root, "docs", "fences", `${s.task}.md`), "utf8"); } catch { fenceText = ""; }
  const required = await requiredFor({ root, cfg, fenceText, results });
  for (const r of results) r.required = required.includes(r.name);
  const green = (r) => r && ["pass", "skipped-no-package"].includes(r.status);
  const failed = required.filter((name) => !green(results.find((r) => r.name === name)));
  const toolchain = cfg.stack?.toolchain ?? "node";
  const manifest = toolchain === "node" ? "package.json" : cfg.stack?.manifest;
  const summary = {
    generated: new Date().toISOString(),
    head: s.head ?? null,
    reported_by: "work",
    has_package_json: Boolean(manifest) && existsSync(path.join(root, manifest)),
    all_required_passed: failed.length === 0,
    modules: Array.isArray(work.modules) ? work.modules.filter((m) => typeof m === "string").slice(0, 10) : [],
    failed_required: failed,
    checks_modified_tracked_files: [],
    results,
  };
  mkdirSync(path.join(root, ".devos"), { recursive: true });
  writeFileSync(path.join(root, ".devos", "ci-results.json"), JSON.stringify(summary, null, 2));
  for (const name of required) console.log(`${(results.find((r) => r.name === name)?.status ?? "missing").toUpperCase().padEnd(18)} ${name}`);
  console.log(failed.length ? `required checks not green: ${failed.join(", ")}` : `every required check reported green (${own?.finished === true ? "the guards publish's own run, the rest" : "a claim of"} the work job's)`);
  emit({ green: failed.length === 0, failed: failed.join(",") });
}

// ---------- usage records ------------------------------------------------------------------------------------------

const USAGE_STAGES = ["blueprint", "intake", "revise", "builder", "reviewer", "doctor", "supervisor", "media"];
/** A usage record (PR-52) rebuilt from known fields only; anything else is dropped. */
export function cleanUsage(line) {
  let r;
  try { r = JSON.parse(line); } catch { return null; }
  if (!r || typeof r !== "object" || r.v !== 1 || !USAGE_STAGES.includes(r.stage)) return null;
  const num = (v) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const s = (v, n, re) => (typeof v === "string" && v.length <= n && (!re || re.test(v)) ? v : "");
  return {
    v: 1, id: s(r.id, 200, /^[A-Za-z0-9._:+-]+$/), at: s(r.at, 40, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/), stage: r.stage,
    task: s(r.task, 20, /^[A-Za-z0-9-]*$/), attempt: num(r.attempt), tool: s(r.tool, 20, /^[a-z]+$/) || "unknown",
    model: s(r.model, 100, /^[A-Za-z0-9._:/@+-]+$/) || "auto", input: num(r.input), output: num(r.output),
    cache_read: num(r.cache_read), cache_write: num(r.cache_write), cost_usd: num(r.cost_usd), seconds: num(r.seconds),
    exit: num(r.exit), reported: r.reported === true, run: s(r.run, 300, /^https:\/\/[A-Za-z0-9./_-]+$/),
  };
}

function usage(a) {
  let lines = [];
  try { lines = readFileSync(String(a.in ?? ""), "utf8").split(/\r?\n/).filter(Boolean); } catch { lines = []; }
  const kept = lines.slice(0, 200).map(cleanUsage).filter(Boolean);
  const dest = path.resolve(String(a.dest ?? ""));
  mkdirSync(path.dirname(dest), { recursive: true });
  if (kept.length) appendFileSync(dest, `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`);
  console.log(`usage: ${kept.length} of ${lines.length} record(s) kept from the work job`);
}

// ---------- the review's inputs and outputs ------------------------------------------------------------------------

function reviewTree(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  const repo = path.join(out, "decide");
  const dest = path.resolve(String(a.dest ?? ""));
  if (existsSync(dest) && readdirSync(dest).length) die(`${dest} is not empty`, 2);
  mkdirSync(dest, { recursive: true });
  const index = { GIT_INDEX_FILE: path.join(out, "review.index") };
  g(["read-tree", s.head], { cwd: repo, env: index });
  g(["checkout-index", "-a", "-f", `--prefix=${dest}${path.sep}`], { cwd: repo, env: index });
  rmSync(path.join(dest, ".devos"), { recursive: true, force: true });
  mkdirSync(path.join(dest, ".devos"), { recursive: true });
  // The work job's evidence first (its claims; regular files only, no usage records), then publish's own files over it,
  // so no file of the evidence can stand for the diff or the checks.
  if (a.evidence && existsSync(String(a.evidence))) {
    cpSync(path.resolve(String(a.evidence)), path.join(dest, ".devos"), { recursive: true, filter: (src) => { try { const st = lstatSync(src); return st.isDirectory() || st.isFile(); } catch { return false; } } });
    rmSync(path.join(dest, ".devos", "usage"), { recursive: true, force: true });
  }
  for (const own of ["diff.patch", "diff-stat.txt", "ci-results.json"]) rmSync(path.join(dest, ".devos", own), { recursive: true, force: true });
  if (existsSync(path.join(repo, ".devos", "ci-results.json"))) cpSync(path.join(repo, ".devos", "ci-results.json"), path.join(dest, ".devos", "ci-results.json"));
  let patch = g(["diff", "--no-ext-diff", "--no-textconv", "--no-color", `${s.main_sha}...${s.head}`], { cwd: repo }).stdout;
  if (patch.length > MAX_PATCH) patch = `${patch.slice(0, MAX_PATCH)}\n\n[the diff is cut here at ${MAX_PATCH} bytes; .devos/diff-stat.txt lists every file]\n`;
  writeFileSync(path.join(dest, ".devos", "diff.patch"), patch);
  writeFileSync(path.join(dest, ".devos", "diff-stat.txt"), g(["diff", "--stat=200", "--no-color", `${s.main_sha}...${s.head}`], { cwd: repo }).stdout);
  console.log(`review tree: ${s.head} in ${dest}; the diff against main in .devos/diff.patch`);
}

/** A fence's `Fence version` (its head's `- Fence version: 3`, `v3` or `**v3 · date**`), or 0 when it has none. */
export function fenceVersion(text) {
  const m = /^- *Fence version: *\**\s*v?(\d{1,4})\b/im.exec(headOf(String(text ?? "")));
  return m ? Number(m[1]) : 0;
}

/** The review file of this attempt, and any fence, that the reviewer wrote and that differ from the head. */
function takeReview(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  const repo = path.join(out, "decide");
  const from = path.resolve(String(a.from ?? ""));
  const task = String(a.task ?? s.task);
  const attempt = Number(a.attempt ?? s.attempt);
  const taken = [];
  const ignored = [];
  const fenceChanges = [];
  const consider = (rel) => {
    const src = path.join(from, rel);
    let st;
    try { st = lstatSync(src); } catch { return; }
    if (!st.isFile()) { ignored.push(`${q(rel)} (not a regular file)`); return; }
    if (st.size > MAX_TEXT) { ignored.push(`${q(rel)} (over ${MAX_TEXT} bytes)`); return; }
    const text = readFileSync(src);
    const dest = path.join(repo, rel);
    const before = existsSync(dest) ? readFileSync(dest) : null;
    if (before && before.equals(text)) return;
    // PR-94: a fence the head already has is issued. It changes only when its Fence version goes up, in the open.
    if (rel.startsWith("docs/fences/")) {
      const now = fenceVersion(text.toString("utf8"));
      if (before) {
        const was = fenceVersion(before.toString("utf8"));
        if (!(now > was)) { ignored.push(`${q(rel)} (an issued fence changes only with a higher Fence version: it stays at ${was || "none"}, and this one says ${now || "none"})`); return; }
        fenceChanges.push(`${rel}: Fence version ${was || "none"} → ${now}`);
      } else fenceChanges.push(`${rel}: new, Fence version ${now || "none"}`);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    taken.push(rel);
  };
  const reviewRel = `docs/reviews/${task}-a${attempt}.md`;
  consider(reviewRel);
  for (const dir of ["docs/reviews", "docs/fences"]) {
    let names = [];
    try { names = readdirSync(path.join(from, dir)); } catch { names = []; }
    for (const name of names) {
      const rel = `${dir}/${name}`;
      if (rel === reviewRel) continue;
      if (dir === "docs/fences" && /^T\d{2}\.md$/.test(name)) consider(rel);
      else {
        const src = path.join(from, rel);
        const dest = path.join(repo, rel);
        try {
          if (lstatSync(src).isFile() && !(existsSync(dest) && readFileSync(dest).equals(readFileSync(src)))) ignored.push(`${q(rel)} (the reviewer writes only its own review file and fences)`);
        } catch { /* gone */ }
      }
    }
  }
  if (ignored.length) {
    mkdirSync(path.join(repo, ".devos"), { recursive: true });
    appendFileSync(path.join(repo, ".devos", "surface-warnings.txt"), ignored.map((x) => `reviewer wrote ${x}; not kept\n`).join(""));
  }
  if (fenceChanges.length) {
    mkdirSync(path.join(repo, ".devos"), { recursive: true });
    writeFileSync(path.join(repo, ".devos", "fence-changes.txt"), `${fenceChanges.join("\n")}\n`);
  }
  console.log(`review outputs kept: ${taken.join(", ") || "none"}${ignored.length ? ` · not kept: ${ignored.join(", ")}` : ""}`);
  emit({ taken: taken.join(" "), review_written: taken.includes(reviewRel) || existsSync(path.join(repo, reviewRel)) });
}

// ---------- commits, main, push ------------------------------------------------------------------------------------

function commit(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  const repo = path.join(out, "decide");
  const message = String(a.message ?? "").trim();
  if (!a.amend && (!message || message.length > 300 || /[\r\n]/.test(message))) die("--message must be one line of at most 300 characters", 2);
  // The runner's files, read by name (never through git status, which the branch's .gitignore could blind): every file
  // of the surface on disk whose bytes differ from the head's.
  const candidates = ["docs/PHASES.md", "docs/USAGE.md"];
  for (const dir of ["docs/reviews", "docs/fences", "docs/usage"]) {
    let names = [];
    try { names = readdirSync(path.join(repo, dir)); } catch { names = []; }
    for (const name of names) candidates.push(`${dir}/${name}`);
  }
  const paths = candidates.filter((p) => COMMIT_SURFACE(p)).filter((rel) => {
    let st;
    try { st = lstatSync(path.join(repo, rel)); } catch { return false; }
    if (!st.isFile() || st.size > MAX_FILE) return false;
    const inHead = g(["rev-parse", "--verify", "--quiet", `${s.head}:${rel}`], { cwd: repo, allowFail: true }).stdout.trim();
    return inHead !== g(["hash-object", "--no-filters", path.join(repo, rel)], { cwd: repo }).stdout.trim();
  });
  const index = { GIT_INDEX_FILE: path.join(out, "commit.index") };
  rmSync(index.GIT_INDEX_FILE, { force: true });
  g(["read-tree", s.head], { cwd: repo, env: index });
  for (const rel of paths) {
    const oid = g(["hash-object", "-w", "--no-filters", path.join(repo, rel)], { cwd: repo }).stdout.trim();
    g(["update-index", "--add", "--cacheinfo", `100644,${oid},${rel}`], { cwd: repo, env: index });
  }
  const tree = g(["write-tree"], { cwd: repo, env: index }).stdout.trim();
  if (tree === sha(repo, `${s.head}^{tree}`)) { console.log("commit: nothing to commit"); emit({ head: s.head, committed: "false" }); return; }
  // --amend: the runner's files join the head commit (the builder's usage records, PR-52), same parents, same message.
  const parents = a.amend ? g(["rev-list", "--parents", "-n", "1", s.head], { cwd: repo }).stdout.trim().split(" ").slice(1) : [s.head];
  const head = commitTree(repo, tree, parents, a.amend ? g(["log", "-1", "--format=%B", s.head], { cwd: repo }).stdout.trim() : message);
  g(["update-ref", `refs/heads/${s.branch}`, head], { cwd: repo });
  g(["read-tree", head], { cwd: repo });
  writeState(out, { ...s, head });
  console.log(`commit: ${head} (${paths.map(q).join(", ") || "no file"})`);
  emit({ head, committed: "true" });
}

function sync(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  const repo = path.join(out, "decide");
  const base = s.base ?? "main";
  g(["fetch", "-q", "--no-tags", remoteOf(a), `+refs/heads/${base}:refs/devos/base-latest`], { cwd: repo, auth: true });
  const latest = sha(repo, "refs/devos/base-latest");
  if (isAncestor(repo, latest, s.head)) { console.log(`sync: ${base} has not moved past this branch`); emit({ moved: "false", code_moved: "false", conflict: "" }); return; }
  const m = g(["merge-tree", "--write-tree", "--no-messages", "--name-only", s.head, latest], { cwd: repo, allowFail: true });
  const lines = m.stdout.split(/\r?\n/);
  let tree = lines[0].trim();
  if (m.status !== 0) {
    const conflicts = lines.slice(1).filter(Boolean);
    if (conflicts.length === 1 && conflicts[0] === "docs/USAGE.md") {
      // PR-52: docs/USAGE.md is counted from the records, so a conflict in it alone is resolved by counting again.
      const files = g(["ls-tree", "-r", "--name-only", tree, "--", "docs/usage"], { cwd: repo }).stdout.split(/\r?\n/).filter(Boolean);
      rmSync(path.join(repo, "docs", "usage"), { recursive: true, force: true });
      const index = { GIT_INDEX_FILE: path.join(out, "sync.index") };
      rmSync(index.GIT_INDEX_FILE, { force: true });
      g(["read-tree", tree], { cwd: repo, env: index });
      if (files.length) g(["checkout-index", "-f", "--", ...files], { cwd: repo, env: index });
      const r = spawnSync(process.execPath, [path.join(TRUSTED, "scripts", "devos", "usage.mjs"), "report", "--write"], { cwd: repo, env: { ...process.env, DEVOS_ROOT: repo }, encoding: "utf8" });
      if (r.status !== 0) die(`sync: docs/USAGE.md could not be counted again: ${r.stderr}`);
      const oid = g(["hash-object", "-w", "--no-filters", path.join(repo, "docs", "USAGE.md")], { cwd: repo }).stdout.trim();
      g(["update-index", "--add", "--cacheinfo", `100644,${oid},docs/USAGE.md`], { cwd: repo, env: index });
      tree = g(["write-tree"], { cwd: repo, env: index }).stdout.trim();
      console.log("sync: docs/USAGE.md counted again from the merged usage records");
    } else {
      console.log(`sync: ${base} changed during this run and conflicts with it: ${conflicts.join(", ")}`);
      emit({ moved: "true", code_moved: "true", conflict: conflicts.join(" ") });
      process.exit(3);
    }
  }
  const merged = commitTree(repo, tree, [s.head, latest], `Merge ${base} into ${s.branch}`);
  const moved = g(["diff", "--name-only", "--no-renames", "-z", s.head, merged], { cwd: repo }).stdout.split("\0").filter(Boolean);
  const code = moved.filter((p) => !p.startsWith("docs/") && !p.startsWith(".devos/"));
  g(["update-ref", `refs/heads/${s.branch}`, merged], { cwd: repo });
  writeState(out, { ...s, head: merged, synced_main: latest });
  console.log(`sync: merged ${base} ${latest.slice(0, 12)}; ${moved.length} path(s) came in${code.length ? `, ${code.length} of them code` : ""}`);
  emit({ moved: "true", code_moved: code.length ? "true" : "false", conflict: "", head: merged });
}

function push(a) {
  const out = path.resolve(String(a.out ?? ""));
  const s = readState(out);
  const repo = path.join(out, "decide");
  const to = a.to ? String(a.to) : `refs/heads/${s.branch}`;
  if (a.to && !/^refs\/heads\/rescue\/[A-Za-z0-9._/-]{1,200}$/.test(to)) die("--to must be refs/heads/rescue/…", 2);
  const remote = remoteOf(a);
  // PR-92: a fresh intake plan replaces the old plan on its branch, and only the one this run saw there.
  const lease = !a.to && s.lease && /^[0-9a-f]{40}$/.test(String(s.lease)) && /^intake\/issue-\d+$/.test(String(s.branch)) ? [`--force-with-lease=${to}:${s.lease}`] : [];
  const r = g(["push", "--porcelain", ...lease, remote, `${s.head}:${to}`], { cwd: repo, auth: true, allowFail: true });
  if (r.status !== 0) {
    const text = `${r.stdout}\n${r.stderr}`;
    console.log(text.trim().split(/\r?\n/).slice(-8).join("\n"));
    // GitHub refuses workflow-file changes from a token without the Workflows permission (PR-27).
    emit({ pushed: "", setup_missing: /workflow/i.test(text) ? "the runner token cannot push workflow changes: DEVOS_PAT needs the Workflows permission (Read and write)" : "" });
    process.exit(1);
  }
  const now = g(["ls-remote", remote, to], { cwd: repo, auth: true }).stdout.trim().split(/\s+/)[0] ?? "";
  console.log(`push: ${to} = ${now} (${now === s.head ? "MATCH" : "MISMATCH"})`);
  emit({ pushed: now, match: now === s.head ? "true" : "false" });
}

// ---------- main ---------------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const a = args(rest);
  try {
    if (command === "verify") verify(a);
    else if (command === "guards") await guards(a);
    else if (command === "state") state(a);
    else if (command === "checks") await checks(a);
    else if (command === "usage") usage(a);
    else if (command === "review-tree") reviewTree(a);
    else if (command === "take-review") takeReview(a);
    else if (command === "commit") commit(a);
    else if (command === "sync") sync(a);
    else if (command === "push") push(a);
    else if (command === "plan") plan(a);
    else die("usage: publish-verify.mjs verify|guards|state|checks|usage|review-tree|take-review|commit|sync|push|plan …", 2);
  } catch (e) {
    die(e.message);
  }
}
