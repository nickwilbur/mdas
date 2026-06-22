import type { AccountView } from '@mdas/canonical';
import { EXPAND3_FRANCHISE, isActiveExpand3Account } from '@mdas/canonical';
import type { EligibilityResult } from './types.js';

export function checkExpand3Eligibility(view: AccountView | null | undefined): EligibilityResult {
  if (!view) {
    return { eligible: false, reason: 'Account not found', code: 'not_found' };
  }

  if (view.account.franchise !== EXPAND3_FRANCHISE) {
    return {
      eligible: false,
      reason: 'Account plans are only available for Expand 3 accounts',
      code: 'not_expand3',
    };
  }

  if (!isActiveExpand3Account(view.account, view.opportunities)) {
    return {
      eligible: false,
      reason: 'Account is not in the active Expand 3 book',
      code: 'inactive_expand3',
    };
  }

  return { eligible: true };
}
