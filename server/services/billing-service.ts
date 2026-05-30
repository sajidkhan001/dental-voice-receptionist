/**
 * billing-service.ts - no-op compatibility stubs for the self-hosted build.
 */

export interface CallUsageResult {
  count: number;
  limit: number | null;
  exceeded: boolean;
  overageRate: number | null;
  percentUsed: number | null;
}

const unlimitedUsage: CallUsageResult = {
  count: 0,
  limit: null,
  exceeded: false,
  overageRate: null,
  percentUsed: null,
};

export async function checkFeatureAccess(..._args: unknown[]): Promise<boolean> {
  return true;
}

export async function getCallUsage(..._args: unknown[]): Promise<CallUsageResult> {
  return unlimitedUsage;
}

export async function incrementCallCount(..._args: unknown[]): Promise<void> {
  // Billing is intentionally disabled in the self-hosted release.
}

export async function seedBillingTiers(..._args: unknown[]): Promise<void> {
  // Billing tables are not created in fresh self-hosted installs.
}
