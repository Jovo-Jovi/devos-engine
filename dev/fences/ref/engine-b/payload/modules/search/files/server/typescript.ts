// Search module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface SearchStatus { configured: false; provider: string }

export const searchStatus: SearchStatus = { configured: false, provider: process.env.DEVOS_SEARCH_PROVIDER ?? 'pending' };

export function search(): never {
  throw new Error('search is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
