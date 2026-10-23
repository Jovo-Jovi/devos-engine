// Database module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface DatabaseStatus { configured: false; provider: string }

export const databaseStatus: DatabaseStatus = { configured: false, provider: process.env.DEVOS_DATABASE_PROVIDER ?? 'pending' };

export function database(): never {
  throw new Error('database is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
