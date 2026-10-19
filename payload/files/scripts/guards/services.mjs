// guard:services — the rules of the storage (R2) and Firebase modules (PR-26). N/A while neither is active.
//
// Storage (R2):
//   1. The storage keys and the S3 client are used only in server-only modules, never in a client
//      component, never through a NEXT_PUBLIC_ name.
// Firebase:
//   2. With client_sdk false (the default) no browser code imports the Firebase web SDK, and analytics,
//      performance or messaging SDKs are never imported (they are trackers: Boundary).
//   3. firebase-admin and the service account are used only in server-only modules.
//   4. The rules files firebase.json deploys exist, never allow a write with `if true`, and with
//      client_sdk false never allow anything with `if true`.
//   5. Rules tests exist (a *.rules.test.* file).
//   6. The seed in firebase/seed/*.json is valid and synthetic (scripts/devos/firebase.mjs validate).
// Both:
//   7. No service-account JSON file is in the tree.
import { exists, read, repoFiles, result } from "./lib.mjs";
import { config } from "../devos/lib.mjs";
import * as r2 from "../devos/r2.mjs";
import * as fb from "../devos/firebase.mjs";

const isTest = (f) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(f) || f.startsWith("e2e/") || f.startsWith("tests/");
const serverOnly = (text) => /import\s+["']server-only["']/.test(text);
const isClient = (text) => /^\s*["']use client["']/m.test(text);

export default function services() {
  const r2On = r2.isActive();
  const fbOn = fb.isActive();
  if (!r2On && !fbOn) return result("N/A", [], "no storage or Firebase module in the tree");
  const findings = [];
  const notes = [];
  const files = repoFiles();
  const src = files.filter((f) => /^src\/.*\.[cm]?[tj]sx?$/.test(f));

  // 7. Service-account files.
  for (const f of files.filter((x) => x.endsWith(".json") && !x.startsWith("node_modules/"))) {
    const t = read(f);
    if (/"type"\s*:\s*"service_account"/.test(t) || /"private_key"\s*:/.test(t)) findings.push(`${f} — a service-account key file is in the tree; keys live only in GitHub and Vercel secrets`);
  }

  if (r2On) {
    // 1.
    for (const f of src.filter((x) => !isTest(x))) {
      const t = read(f);
      if (/NEXT_PUBLIC_R2_[A-Z_]*(KEY|SECRET)/.test(t)) findings.push(`${f} — an R2 key under a NEXT_PUBLIC_ name reaches the browser`);
      if (/R2_(SECRET_ACCESS_KEY|ACCESS_KEY_ID)|@aws-sdk\/client-s3/.test(t)) {
        if (isClient(t)) findings.push(`${f} — a client component uses the storage keys or the S3 client`);
        else if (!serverOnly(t)) findings.push(`${f} — uses the storage keys or the S3 client without import "server-only"`);
      }
    }
    notes.push("storage: on");
  }

  if (fbOn) {
    const m = config().modules?.firebase ?? {};
    // 2, 3.
    for (const f of src.filter((x) => !isTest(x))) {
      const t = read(f);
      if (/from\s+["']firebase\/(analytics|performance|messaging|remote-config)["']/.test(t)) findings.push(`${f} — imports a Firebase tracking SDK (Boundary: no analytics or trackers)`);
      if (m.client_sdk === false && /from\s+["']firebase(\/[a-z-]+)?["']/.test(t)) findings.push(`${f} — imports the Firebase web SDK; this project reads Firestore on the server only (modules.firebase.client_sdk false)`);
      if (/from\s+["']firebase-admin(\/[a-z-]+)?["']|FIREBASE_SERVICE_ACCOUNT/.test(t)) {
        if (isClient(t)) findings.push(`${f} — a client component uses firebase-admin or the service account`);
        else if (!serverOnly(t)) findings.push(`${f} — uses firebase-admin or the service account without import "server-only"`);
      }
      if (/NEXT_PUBLIC_FIREBASE_[A-Z_]*(KEY|SECRET|SERVICE)/.test(t)) findings.push(`${f} — a Firebase credential under a NEXT_PUBLIC_ name`);
    }
    // 4.
    for (const rf of fb.rulesFiles()) {
      if (!exists(rf)) { findings.push(`${rf} — firebase.json names this rules file but it does not exist`); continue; }
      const rules = read(rf).replace(/\/\/[^\n]*/g, "");
      for (const m2 of rules.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+true\s*;/g)) {
        const ops = m2[1];
        if (/write|create|update|delete/.test(ops)) findings.push(`${rf} — "allow ${ops.trim()}: if true" lets anyone write`);
        else if (m.client_sdk === false) findings.push(`${rf} — "allow ${ops.trim()}: if true" opens reads to every client; with client_sdk false the rules deny all clients`);
      }
    }
    // 5.
    if (!files.some((f) => /\.rules\.test\.[cm]?[tj]s$/.test(f))) findings.push(`no *.rules.test.ts file — the Firestore rules must be proven against the emulator (${m.rules_test_script ?? "test:rules"})`);
    // 6.
    const { errors, collections } = fb.readSeed();
    findings.push(...errors);
    notes.push(`firebase: ${fb.rulesFiles().join(", ")}; seed ${collections.map((c) => `${c.name} (${c.docs.length})`).join(", ") || "none"}`);
  }

  return result(findings.length ? "FAIL" : "PASS", findings, notes.join("; "));
}
