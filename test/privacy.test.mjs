import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// E10b2, the owner's decisions of 2026-10-26: before a developer answers the link question, the contract says who keeps
// what about them, why, for how long, where, and how to reach the operator. It claims no legal compliance and states
// only facts the owner verified.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");
const flat = (text) => text.replace(/\s+/g, " ");
const CONTACT = "jiovanny.adel@gmail.com";
const contract = read("payload/contract/CONTRACT.md");
const beforeAccepting = flat(contract.slice(0, contract.indexOf("## Accepting")));
const readme = read("README.md");
const tower = flat(readme.slice(readme.indexOf("## The DEV_OS Control Tower (optional)"), readme.indexOf("## Current limits")));

test("privacy.test.mjs (a) the contract says, before it is accepted, who keeps what, why, how long, where, and how to reach them", () => {
  for (const words of [
    "## What the Control Tower keeps",
    "Jovo-Jovi, the operator of the Control Tower. Only the operator can read it.",
    "the repository's full name, which contains its owner's GitHub login; the owner's numeric GitHub id; the proposed project key; the engine and contract versions;",
    "keeps only the repository and its owner's numeric GitHub id from it, and drops the token.",
    "each step of the cycle sends one event: its format version, the project key,",
    "To decide on each link request, and to show the operator which projects use DEV_OS and how their cycles run.",
    "A pending or declined request: up to 180 days after its last request.",
    "A project the operator disconnects, with its events: up to 365 days after that decision.",
    "A linked project: while it stays linked.",
    "Encrypted backups can keep a deleted record for up to 30 days.",
    "Supabase stores the records in Frankfurt, Germany (region `eu-central-1`), and the Control Tower runs on Vercel in Frankfurt (`fra1`).",
    "Supabase, Vercel and GitHub are companies based in the United States.",
    "## Your rights",
    `or to withdraw your consent, write to the operator at: ${CONTACT}`,
  ]) {
    assert.equal(beforeAccepting.includes(words), true, words);
  }
  assert.equal(contract.includes("open an issue"), false);
});

test("privacy.test.mjs (b) the contract and the README claim no legal compliance", () => {
  for (const [name, text] of [["contract", contract], ["README", readme]]) {
    assert.equal(/complian|complies|compliant|lawful basis|legal basis|GDPR|Law 151|certified/i.test(text), false, name);
  }
});

test("privacy.test.mjs (c) the README states the same periods, places and contact", () => {
  for (const words of [
    "The operator, Jovo-Jovi, alone reads it.",
    "A pending or declined request: up to 180 days after its last request.",
    "A disconnected project with its events: up to 365 days after the decision.",
    "Encrypted backups: up to 30 days after a deletion.",
    "Supabase in Frankfurt, Germany (`eu-central-1`), and Vercel in Frankfurt (`fra1`);",
    `write to ${CONTACT}.`,
  ]) {
    assert.equal(tower.includes(words), true, words);
  }
});
