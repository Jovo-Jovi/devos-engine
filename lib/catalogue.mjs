import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cataloguePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "catalogue.json");

export function loadCatalogue() {
  return JSON.parse(readFileSync(cataloguePath, "utf8"));
}

export function typeById(id) {
  return loadCatalogue().types.find((type) => type.id === id);
}

export function stacksFor(typeId) {
  return loadCatalogue().stacks.filter((stack) => stack.runs === true && stack.fits.includes(typeId));
}

export function modulesFor(typeId) {
  const catalogue = loadCatalogue();
  const defaults = typeById(typeId)?.defaults ?? {};
  return catalogue.modules
    .filter((module) => Object.hasOwn(defaults, module.id))
    .map((module) => ({ ...module, default: defaults[module.id] }));
}

export function prepareFor(typeId) {
  const catalogue = loadCatalogue();
  const byId = new Map(catalogue.documents.map((doc) => [doc.id, doc]));
  return (typeById(typeId)?.prepare ?? []).map((id) => byId.get(id)).filter(Boolean);
}

function chosenProvider(module, modules) {
  const id = modules?.[module.id];
  if (typeof id !== "string") return undefined;
  return module.providers.find((provider) => provider.id === id);
}

export function methodModules(modules) {
  const methods = new Set();
  for (const module of loadCatalogue().modules) {
    const provider = chosenProvider(module, modules);
    if (!provider?.method || provider.method === "vercel") continue;
    methods.add(provider.method);
  }
  return [...methods].sort();
}

export function derivedAnswers(modules) {
  const chosen = modules ?? {};
  const database = chosen.database;
  return {
    stores_data: typeof database === "string" && database !== "none",
    sign_in: typeof chosen.auth === "string" ? chosen.auth : "none",
    deploy: chosen.hosting === "vercel" ? "vercel" : "none",
  };
}

export function appKeys(modules) {
  const names = [];
  for (const module of loadCatalogue().modules) {
    const provider = chosenProvider(module, modules);
    if (!provider?.env) continue;
    names.push(...provider.env);
  }
  return names;
}
