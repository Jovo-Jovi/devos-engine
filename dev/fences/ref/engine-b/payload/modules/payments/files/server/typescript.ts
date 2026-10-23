// Payments module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface PaymentsStatus { configured: false; provider: string }

export const paymentsStatus: PaymentsStatus = { configured: false, provider: process.env.DEVOS_PAYMENTS_PROVIDER ?? 'pending' };

export function payments(): never {
  throw new Error('payments is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
