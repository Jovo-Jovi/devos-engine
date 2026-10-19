import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { run } from "./which.mjs";
import { loadRoster } from "./roster.mjs";

function warn(id, model) {
  console.log(`devos: warning: ${id} uses ${model}, the same model as the reviewer`);
}

export function doctorCommand() {
  const roster = loadRoster();
  if (roster && roster.reviewer && Array.isArray(roster.pool)) {
    const model = roster.reviewer.model;
    for (const item of roster.pool) {
      if (item.model === model) warn(item.id, item.model);
    }
    if (roster.reviewer_light && roster.reviewer_light.model === model) {
      warn(roster.reviewer_light.id, roster.reviewer_light.model);
    }
  }
  const gh = run("gh", ["--version"]);
  if (gh === null || gh.status !== 0) {
    console.log("devos: gh is not installed. Install the GitHub CLI, then run: gh auth login");
    return 1;
  }
  console.log("devos: doctor ok");
  return 0;
}

export function statusCommand() {
  const projectPath = path.join(process.cwd(), "devos", "project.json");
  if (!existsSync(projectPath)) {
    console.log("devos: no project here");
    return 0;
  }
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  console.log(`devos: project ${project.project}`);
  const roster = loadRoster();
  if (roster && roster.reviewer && typeof roster.reviewer.id === "string") {
    console.log(`devos: roster ${roster.reviewer.id}`);
  } else {
    console.log("devos: roster none");
  }
  return 0;
}
