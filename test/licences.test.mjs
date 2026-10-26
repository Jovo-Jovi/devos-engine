import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// E10b, the owner's licence decision of 2026-10-26 (D-E4): PolyForm Shield 1.0.0 for the engine, MIT for the files it
// installs into a project, and every third-party licence, notice and attribution kept.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");
const SHIELD_SHA256 = "56328093d57c87dcf2811ddcc824caf2723a07ffc332e6fbe4f9f108a2893a91";
const NOTICE = "Required Notice: Copyright 2026 Jovo-Jovi (https://github.com/Jovo-Jovi)";
const pkg = JSON.parse(read("package.json"));
const skills = JSON.parse(read("payload/files/devos/skills/manifest.json"));
const vendored = skills.entries.filter((item) => item.delivery === "vendored");

test("licences.test.mjs (a) LICENSE is the PolyForm Shield License 1.0.0, unchanged, with the required notice", () => {
  const text = read("LICENSE");
  const cut = text.lastIndexOf(`\n\n${NOTICE}`);
  assert.equal(cut > 0, true, "the required notice follows the licence text");
  assert.equal(createHash("sha256").update(text.slice(0, cut + 1)).digest("hex"), SHIELD_SHA256);
  assert.equal(text.slice(cut + 2), `${NOTICE}\n`);
  assert.equal(pkg.license, "PolyForm-Shield-1.0.0");
  for (const file of ["LICENSE", "LICENSES.md", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md", "README.md"]) {
    assert.equal(pkg.files.includes(file), true, file);
  }
});

test("licences.test.mjs (b) the files DEV_OS installs carry the MIT licence, installed as devos/LICENSE.md", () => {
  const manifest = JSON.parse(read("payload/manifest.json"));
  assert.equal(manifest.files.some((file) => file.path === "devos/LICENSE.md" && file.owner === "engine"), true);
  const mit = read("payload/files/devos/LICENSE.md");
  assert.equal(mit.includes("\nMIT License\n\nCopyright (c) 2026 Jovo-Jovi\n\nPermission is hereby granted, free of charge,"), true);
  const canonical = read("payload/files/devos/skills/superpowers/LICENSE").split("\n").slice(3).join("\n");
  assert.equal(mit.endsWith(canonical), true, "the MIT terms are word for word");
  assert.equal(mit.includes("`devos/skills/manifest.json` names the source and the\nlicence of each."), true);
});

test("licences.test.mjs (c) every vendored skill keeps its licence and notices, and is listed in THIRD_PARTY_NOTICES.md", () => {
  assert.equal(vendored.length, 18);
  const notices = read("THIRD_PARTY_NOTICES.md");
  const rows = notices.split("\n").filter((line) => /^\| `[a-z0-9-]+` \|/.test(line));
  assert.equal(rows.length, vendored.length);
  for (const item of vendored) {
    const row = rows.find((line) => line.startsWith(`| \`${item.id}\` |`));
    assert.notEqual(row, undefined, item.id);
    const repo = item.source.repo.replace("https://github.com/", "");
    for (const part of [`[${repo}](${item.source.repo})`, `\`${item.source.commit.slice(0, 10)}\``, `\`${item.licence.spdx}\``]) {
      assert.equal(row.includes(part), true, `${item.id}: ${part}`);
    }
    for (const file of [item.licence.file, ...item.licence.notices]) {
      assert.equal(existsSync(path.join(root, "payload", "files", "devos", "skills", item.id, file)), true, `${item.id}/${file}`);
      assert.equal(row.includes(`\`${file}\``), true, `${item.id} names ${file}`);
    }
  }
});

test("licences.test.mjs (d) the IBM Plex fonts ship with the SIL Open Font License 1.1", () => {
  const fonts = readdirSync(path.join(root, "lib", "ui", "fonts")).filter((name) => name.endsWith(".woff2"));
  assert.equal(fonts.length, 5);
  for (const name of fonts) assert.equal(/^plex-(sans|serif|mono)-[0-9]{3}\.woff2$/.test(name), true, name);
  const ofl = read("lib/ui/fonts/OFL.txt");
  assert.equal(ofl.includes("Copyright 2017, 2019, 2020 IBM Corp."), true);
  assert.equal(ofl.includes("SIL OPEN FONT LICENSE Version 1.1"), true);
  assert.equal(read("THIRD_PARTY_NOTICES.md").includes("| `lib/ui/fonts/plex-*.woff2` (5 files) | `OFL-1.1`, in `lib/ui/fonts/OFL.txt` |"), true);
});

test("licences.test.mjs (e) LICENSES.md maps every file to one licence, first rule first", () => {
  const map = read("LICENSES.md");
  const rules = map.split("\n").filter((line) => /^\| [1-4] \|/.test(line)).map((line) => line.split(" | ")[0] + " | " + line.split(" | ")[2]);
  assert.deepEqual(rules, [
    "| 1 | `OFL-1.1`",
    "| 2 | each skill's own: `MIT`, `Apache-2.0`, `CC-BY-4.0` or `CC-BY-SA-4.0`",
    "| 3 | `MIT`",
    "| 4 | `PolyForm-Shield-1.0.0`",
  ]);
  const spdx = new Set(vendored.flatMap((item) => item.licence.spdx.split(" AND ")));
  assert.deepEqual([...spdx].sort(), ["Apache-2.0", "CC-BY-4.0", "CC-BY-SA-4.0", "MIT"]);
  const sources = vendored.flatMap((item) => item.files.filter((file) => file.origin === "source").map((file) => path.join(item.id, file.path)));
  assert.equal(sources.length, 157);
  for (const file of sources) assert.equal(existsSync(path.join(root, "payload", "files", "devos", "skills", file)), true, file);
});

test("licences.test.mjs (f) CHANGELOG.md opens with this version, and the README states the licences", () => {
  const changelog = read("CHANGELOG.md");
  assert.equal(changelog.split("\n").find((line) => line.startsWith("## ")), `## ${pkg.version} — Unreleased`);
  assert.equal(JSON.parse(read("payload/manifest.json")).engine_version, pkg.version);
  const readme = read("README.md");
  assert.equal(readme.includes("\n## Licence\n"), true);
  assert.equal(readme.includes("not licensed for use yet"), false);
  assert.equal(readme.includes(`Version \`${pkg.version}\`.`), true);
});
