// Email module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface EmailStatus { configured: false; provider: string }

export const emailStatus: EmailStatus = { configured: false, provider: process.env.DEVOS_EMAIL_PROVIDER ?? 'pending' };

export function email(): never {
  throw new Error('email is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
