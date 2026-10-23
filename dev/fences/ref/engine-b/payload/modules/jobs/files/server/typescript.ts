// Jobs module: present because the answers turned it on.
// A later task implements the real provider wiring. Until then this throws.

export interface JobsStatus { configured: false; provider: string }

export const jobsStatus: JobsStatus = { configured: false, provider: process.env.DEVOS_JOBS_PROVIDER ?? 'pending' };

export function jobs(): never {
  throw new Error('jobs is not configured yet. A later task wires the provider; see SETUP.md and docs/ARCHITECTURE.md.');
}
