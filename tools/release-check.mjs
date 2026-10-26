#!/usr/bin/env node
// The release check (D-E10, E10c). The owner runs it before tagging a release:
//
//   node tools/release-check.mjs [--root <folder>]
//
// It prints "release check: ok (N files scanned)" and exits 0 when the tree is ready, or lists every problem and
// exits 1. It reads only files; it runs no git and calls no network. A secret's value is never printed, only its
// file, line and kind. The whole history is scanned separately, with gitleaks (dev/RELEASE.md).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NOTICE = "Required Notice: Copyright 2026 Jovo-Jovi (https://github.com/Jovo-Jovi)";
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip)$/i;

// The same kinds of secret as the method's guard:secrets (payload/files/scripts/guards/secrets.mjs).
const RULES = [
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/, label: "Anthropic key" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, label: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{30,}/, label: "GitHub fine-grained token" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key" },
  { re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, label: "JWT or service key" },
  { re: /\b[a-z]{20}\.supabase\.co\b/, label: "Supabase project ref" },
  { re: /\bsb_secret_[A-Za-z0-9_-]{16,}/, label: "Supabase secret key" },
  { re: /\bsbp_[a-f0-9]{32,}/, label: "Supabase access token" },
  { re: /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/, label: "connection string with a password" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: "Google API key" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, label: "Slack token" },
];

function walk(abs) {
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) =>
    entry.name === ".git" || entry.name === "node_modules" ? [] : walk(path.join(abs, entry.name)),
  );
}

/** The problems that stop a release of the tree at `root`, and how many shipped files were scanned. */
export function releaseCheck(root) {
  const problems = [];
  const text = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n") : null);

  const pkg = JSON.parse(text("package.json") ?? "{}");
  const version = String(pkg.version ?? "");
  const manifest = JSON.parse(text("payload/manifest.json") ?? "{}");
  if (manifest.engine_version !== version) problems.push(`payload/manifest.json: engine_version is not ${version}, the version in package.json`);

  const heading = (text("CHANGELOG.md") ?? "").split("\n").find((line) => line.startsWith("## ")) ?? "";
  const match = /^## (\S+) — (.+)$/.exec(heading);
  if (!match || match[1] !== version) problems.push(`CHANGELOG.md: its first heading is not version ${version}`);
  else if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(match[2])) problems.push(`CHANGELOG.md: the ${version} heading has no date; set it when you tag`);

  if (pkg.license !== "PolyForm-Shield-1.0.0") problems.push("package.json: license is not PolyForm-Shield-1.0.0");
  if (!(text("LICENSE") ?? "").endsWith(`\n\n${NOTICE}\n`)) problems.push("LICENSE: it does not end with the required notice");
  if (text("SECURITY.md") === null) problems.push("SECURITY.md: missing");
  if ((text("README.md") ?? "").includes("private until the release")) problems.push("README.md: it still says the repository is private");

  const decision = (text("dev/DECISIONS.md") ?? "").split("\n").find((line) => line.startsWith("| D-E11 |"));
  if (!decision) problems.push("dev/DECISIONS.md: no D-E11 row (the privacy facts)");
  else if (/provisional/i.test(decision)) problems.push("dev/DECISIONS.md: D-E11 still names the operator provisionally; confirm the legal identity first");

  const shipped = [...(Array.isArray(pkg.files) ? pkg.files : []), "SECURITY.md"];
  const files = [...new Set(shipped.flatMap((entry) => walk(path.join(root, entry))))].filter((file) => !BINARY.test(file)).sort();
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.re.test(line)) problems.push(`${rel}:${index + 1}: looks like a ${rule.label}`);
      }
    });
  }
  return { problems, scanned: files.length };
}

export function main(argv = process.argv.slice(2), out = (line) => console.log(line)) {
  const at = argv.indexOf("--root");
  const root = at >= 0 ? path.resolve(argv[at + 1] ?? ".") : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { problems, scanned } = releaseCheck(root);
  if (problems.length === 0) {
    out(`release check: ok (${scanned} files scanned)`);
    return 0;
  }
  out(`release check: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const problem of problems) out(`- ${problem}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
