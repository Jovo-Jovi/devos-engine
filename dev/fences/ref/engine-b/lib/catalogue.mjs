import { readFileSync, existsSync } from 'node:fs';
import { payloadPath } from './paths.mjs';

let cached = null;

export function loadCatalogue() {
  if (!cached) cached = JSON.parse(readFileSync(payloadPath('catalogue.json'), 'utf8'));
  return cached;
}

export function getType(catalogue, id) {
  return catalogue.types.find((t) => t.id === id) || null;
}

export function getModule(catalogue, id) {
  return catalogue.modules.find((m) => m.id === id) || null;
}

export function loadStack(id) {
  const p = payloadPath('stacks', `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function stackCards(catalogue) {
  return catalogue.frameworks.map((id) => {
    const s = loadStack(id);
    return {
      id,
      label: s?.label || id,
      languages: s?.languages || [],
      fits: s?.fits || [],
      packageManager: s?.packageManager || 'npm',
      commands: s?.commands || {},
      note: s?.note || '',
    };
  });
}

export function frameworksForType(catalogue, typeId) {
  return stackCards(catalogue).filter((s) => s.fits.includes(typeId));
}

// Web UI stacks show styling/ui-kit questions; extension counts as UI without a server.
export function typeHasUi(type) {
  return Boolean(type?.ui);
}

export function typeHasWebServer(type) {
  return Boolean(type?.web);
}

export function moduleTemplateDir(id) {
  return payloadPath('modules', id);
}
