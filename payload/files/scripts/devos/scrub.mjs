#!/usr/bin/env node
// Remove secret values from text an agent wrote before anything is published (PR-90). The values come from this
// process's environment, by name; they are never printed. Each occurrence, as it is, in base64 or in hex, becomes
// [redacted NAME]. Values shorter than 8 characters are left alone (they would match ordinary words). Best effort: a
// value re-encoded another way, or cut in pieces, is not found.
//
// Usage: node scripts/devos/scrub.mjs --names NAME1,NAME2,… <file>…
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";

export function scrubText(text, secrets) {
  let out = String(text);
  let count = 0;
  for (const [name, value] of secrets) {
    if (typeof value !== "string" || value.length < 8) continue;
    const hex = Buffer.from(value).toString("hex");
    for (const form of new Set([value, Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64").replace(/=+$/, ""), hex, hex.toUpperCase()])) {
      if (form.length < 8) continue;
      const parts = out.split(form);
      if (parts.length > 1) { count += parts.length - 1; out = parts.join(`[redacted ${name}]`); }
    }
  }
  return { text: out, count };
}

if (process.argv[1] && process.argv[1].endsWith("scrub.mjs")) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--names");
  const names = i >= 0 ? String(argv[i + 1] ?? "").split(",").map((n) => n.trim()).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)) : [];
  const files = argv.filter((a, j) => a !== "--names" && j !== i + 1);
  const secrets = names.map((n) => [n, process.env[n]]).filter(([, v]) => v);
  let total = 0;
  for (const file of files) {
    if (!existsSync(file) || !lstatSync(file).isFile()) continue;
    const { text, count } = scrubText(readFileSync(file, "utf8"), secrets);
    if (count) { writeFileSync(file, text); total += count; console.log(`scrub: ${file}: ${count} secret value(s) removed`); }
  }
  console.log(`scrub: ${files.length} file(s) read, ${total} value(s) removed`);
}
