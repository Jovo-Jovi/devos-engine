// Product AI module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface ProductAiStatus { configured: false; provider: string }

export const productAiStatus: ProductAiStatus = { configured: false, provider: process.env.DEVOS_PRODUCT_AI_PROVIDER ?? 'pending' };

export function productAi(): never {
  throw new Error('product-ai is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
