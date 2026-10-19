import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toInstalled } from "../lib/paths.mjs";
import { engineRoot, normalizeLf } from "./sources.mjs";

const PATTERNS = [/tower/i, /\bpilot\b/i, /\bADR-0\d\d\b/, /Jovo-Jovi/];

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(abs));
    else if (entry.isFile()) found.push(abs);
  }
  return found;
}

function cell(text) {
  const trimmed = [...text.trim()].slice(0, 120).join("");
  return trimmed.replaceAll("|", "\\|");
}

const filesDir = path.join(engineRoot(), "payload", "files");
const matches = [];
for (const abs of walkFiles(filesDir)) {
  const stored = path.relative(filesDir, abs).split(path.sep).join("/");
  const installed = toInstalled(stored);
  const text = normalizeLf(readFileSync(abs)).toString("utf8");
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!PATTERNS.some((pattern) => pattern.test(lines[index]))) continue;
    matches.push({ path: installed, line: index + 1, text: cell(lines[index]) });
  }
}

matches.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
const fileCount = new Set(matches.map((match) => match.path)).size;
const rows = matches.map((match) => `| ${match.path} | ${match.line} | ${match.text} |`);
const body = [
  "# Tower- and pilot-specific lines in the payload (input for E03)",
  "",
  "| Installed path | Line | Text |",
  ...rows,
  `Total: ${matches.length} lines in ${fileCount} files`,
].join("\n");

writeFileSync(path.join(engineRoot(), "dev", "E01-specifics.md"), `${body}\n`);
