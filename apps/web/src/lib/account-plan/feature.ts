import 'server-only';

/** Feature gate for Expand 3 Account Plan Generator (default off). */
export function isExpand3AccountPlanEnabled(): boolean {
  const raw = process.env.ENABLE_EXPAND3_ACCOUNT_PLAN ?? '';
  return raw.trim().toLowerCase() === 'true';
}

export function assertExpand3AccountPlanEnabled(): void {
  if (!isExpand3AccountPlanEnabled()) {
    throw new AccountPlanFeatureDisabledError();
  }
}

export class AccountPlanFeatureDisabledError extends Error {
  code = 'feature_disabled';
  status = 404;

  constructor() {
    super('Expand 3 Account Plan Generator is not enabled');
    this.name = 'AccountPlanFeatureDisabledError';
  }
}

/** Bulk refresh requires explicit admin flag (default off). */
export function isExpand3AccountPlanBulkEnabled(): boolean {
  const raw = process.env.ENABLE_EXPAND3_ACCOUNT_PLAN_BULK ?? '';
  return raw.trim().toLowerCase() === 'true';
}

export function resolveAccountPlanActor(req?: Request): string {
  const header = req?.headers.get('x-mdas-actor');
  return header?.trim() || 'manual:nick';
}
