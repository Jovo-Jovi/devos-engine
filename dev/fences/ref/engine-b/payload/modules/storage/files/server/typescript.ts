// Storage module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface StorageStatus { configured: false; provider: string }

export const storageStatus: StorageStatus = { configured: false, provider: process.env.DEVOS_STORAGE_PROVIDER ?? 'pending' };

export function storage(): never {
  throw new Error('storage is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
