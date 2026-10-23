// Auth module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface AuthStatus { configured: false; provider: string }

export const authStatus: AuthStatus = { configured: false, provider: process.env.DEVOS_AUTH_PROVIDER ?? 'pending' };

export function auth(): never {
  throw new Error('auth is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
