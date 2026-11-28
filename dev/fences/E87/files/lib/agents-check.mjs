// E87 (PR-109): `devos agents check <id>` — one agent tool's file, checked on your computer before a run, with no AI
// call: the registry's rules, the roles it can take, whether its command is on this computer, whether the cycle's
// workflows pass its secret, and whether devos.config.json gives it a role it cannot fill. A project's own tool is
// devos/agents/<id>.json in the project; an engine tool is the engine's copy when the project has none.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OWN_SECRET, ROLE_NEEDS, ROLES, lacking, problems } from "../payload/files/scripts/devos/tools.mjs";
import { which } from "./which.mjs";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "payload", "files");
const ID = /^[a-z][a-z0-9-]{0,30}$/;

function readJson(file) {
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: error.message };
  }
}

/** The secrets the project's cycle workflow passes by name (E86b): the installed copy, else the engine's. */
function passedSecrets(root) {
  const installed = path.join(root, ".github", "workflows", "devos-cycle.yml");
  const file = existsSync(installed) ? installed : path.join(ENGINE, "dot-github", "workflows", "devos-cycle.yml");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  // The callers' lines that hand a job its keys: `KEY_1: ${{ (… == 'NAME' && secrets.NAME) || … }}`.
  const callers = text.split("\n").filter((line) => /^\s+L?(KEY|ALT)_[12]: \$\{\{/.test(line)).join("\n");
  return new Set([...callers.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
}

/** The lines `devos agents check <id>` prints, and whether the tool is ready. */
export function checkAgent(id, root = process.cwd()) {
  const lines = [];
  const found = [];
  if (!ID.test(String(id ?? ""))) return { ok: false, lines: [`devos agents check: "${id}" is not a tool id (lower-case letters, digits and hyphens)`] };
  const own = path.join(root, "devos", "agents", `${id}.json`);
  const engine = path.join(ENGINE, "devos", "agents", `${id}.json`);
  const file = existsSync(own) ? own : existsSync(engine) ? engine : "";
  if (!file) return { ok: false, lines: [`devos agents check: no devos/agents/${id}.json in this project or the engine`] };
  const where = file === own ? `devos/agents/${id}.json` : `the engine's devos/agents/${id}.json`;
  const { value: t, error } = readJson(file);
  if (error) return { ok: false, lines: [`devos agents check: ${where} is not valid JSON (${error})`] };
  lines.push(`devos agents check ${id}: ${t.label ?? id} (${where})`);

  const wrong = problems(t, `${id}.json`);
  for (const p of wrong) found.push(p);
  lines.push(wrong.length ? `- file: ${wrong.length} problem(s)` : "- file: passes the registry's rules");
  for (const p of wrong) lines.push(`  - ${p}`);
  if (wrong.length) return { ok: false, lines: [...lines, `result: ${found.length} problem(s)`] };

  const roles = ROLES.filter((role) => lacking(t, role).length === 0);
  lines.push(`- can: ${t.can.length ? t.can.join(", ") : "nothing"}, so it can be ${roles.length ? roles.join(", ") : "no role"}`);

  const command = which(t.command);
  lines.push(command ? `- command ${t.command}: on this computer (${command.path})` : `- command ${t.command}: not on this computer (on GitHub, ${t.install.kind === "none" ? "it must be on the runner" : "the cycle installs it"})`);

  const passed = passedSecrets(root);
  for (const secret of [t.keys.secret, ...(t.keys.alt ? [t.keys.alt.secret] : [])]) {
    if (passed.has(secret) && passed.has(`${secret}_2`)) lines.push(`- secret ${secret}: the cycle passes it (and ${secret}_2) to the tool's job; set it in GitHub`);
    else {
      found.push(`secret ${secret}`);
      lines.push(`- secret ${secret}: no workflow passes it, so the tool's job would get no key; a project's own tool uses ${OWN_SECRET} (and ${OWN_SECRET}_2)`);
    }
  }

  const cfgFile = path.join(root, "devos.config.json");
  if (existsSync(cfgFile)) {
    const { value: cfg } = readJson(cfgFile);
    const agents = cfg?.agents ?? {};
    const uses = [
      ...[["reviewer", agents.reviewer], ["reviewer_light", agents.reviewer_light]].filter(([, a]) => a?.tool === id).map(([label]) => [label, "reviewer"]),
      ...(Array.isArray(agents.pool) ? agents.pool : []).filter((a) => a?.tool === id).map((a) => [`pool item ${a.id}`, "builder"]),
    ];
    if (!uses.length) lines.push("- devos.config.json: no role uses it");
    for (const [label, role] of uses) {
      const gap = lacking(t, role);
      if (gap.length) {
        found.push(label);
        lines.push(`- devos.config.json: ${label} is the ${role}, which needs ${ROLE_NEEDS[role].join(", ")}; it lacks ${gap.join(", ")}`);
      } else lines.push(`- devos.config.json: ${label} (${role}) fits`);
    }
  }
  lines.push(found.length ? `result: ${found.length} problem(s)` : "result: ready");
  return { ok: found.length === 0, lines };
}

export function agentsCheckCommand(id, root = process.cwd()) {
  const { ok, lines } = checkAgent(id, root);
  console.log(lines.join("\n"));
  return ok ? 0 : 1;
}
