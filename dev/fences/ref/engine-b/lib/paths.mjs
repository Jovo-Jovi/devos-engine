import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

export function engineRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function payloadPath(...parts) {
  return join(engineRoot(), 'payload', ...parts);
}

export function uiPath(...parts) {
  return join(engineRoot(), 'ui', ...parts);
}

// ~/.devos unless overridden (tests override with DEVOS_HOME).
export function devosHome(env = process.env) {
  return env.DEVOS_HOME || join(os.homedir(), '.devos');
}

export function underHome(home, ...parts) {
  return join(home, ...parts);
}

export function draftFile(home) {
  return join(home, 'draft.json');
}

export function defaultsFile(home) {
  return join(home, 'defaults.json');
}

export function answersDir(home) {
  return join(home, 'answers');
}

export function lastProjectFile(home) {
  return join(home, 'last-project.json');
}
