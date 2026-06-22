import { NextResponse } from 'next/server';
import {
  assertExpand3AccountPlanEnabled,
  AccountPlanFeatureDisabledError,
  isExpand3AccountPlanBulkEnabled,
  resolveAccountPlanActor,
} from '@/lib/account-plan/feature';
import { enqueueExpand3BulkRefresh } from '@/lib/account-plan/bulk-refresh';
import { audit } from '@mdas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    assertExpand3AccountPlanEnabled();
    if (!isExpand3AccountPlanBulkEnabled()) {
      return NextResponse.json(
        { error: 'Bulk account plan refresh is not enabled', code: 'bulk_disabled' },
        { status: 403 },
      );
    }
    const actor = resolveAccountPlanActor(req);
    const jobId = await enqueueExpand3BulkRefresh(actor);
    await audit(actor, 'account_plan.bulk.requested', { jobId });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    if (err instanceof AccountPlanFeatureDisabledError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
