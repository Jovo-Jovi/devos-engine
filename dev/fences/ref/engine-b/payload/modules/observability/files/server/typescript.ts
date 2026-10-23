// Observability module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface ObservabilityStatus { configured: false; provider: string }

export const observabilityStatus: ObservabilityStatus = { configured: false, provider: process.env.DEVOS_OBSERVABILITY_PROVIDER ?? 'pending' };

export function observability(): never {
  throw new Error('observability is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
