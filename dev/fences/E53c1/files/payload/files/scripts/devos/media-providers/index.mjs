// The media providers (PR-80). Each provider is one module with the same shape:
//   id, kinds, terms_url, models: { <kind>: <model id> }, formats: { <kind>: [<file extension>] },
//   estimate(item) → USD, generate(item, ctx) → { bytes, model, cost_usd, cost_source, format } or throws.
// ctx: { key, fetch, sleep, now }. `fetch` already retries; a provider never logs its key.
import xai from "./xai.mjs";

const PROVIDERS = { xai };

export function provider(id) {
  return PROVIDERS[id] ?? null;
}

export function providerIds() {
  return Object.keys(PROVIDERS);
}

/** The environment variable that holds a provider's key, for example DEVOS_MEDIA_XAI_KEY. */
export function keyName(id) {
  return `DEVOS_MEDIA_${String(id).toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;
}
