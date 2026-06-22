import { NextResponse } from 'next/server';
import {
  assertExpand3AccountPlanEnabled,
  AccountPlanFeatureDisabledError,
} from '@/lib/account-plan/feature';
import { getBulkRefreshStatus } from '@/lib/account-plan/bulk-refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
): Promise<Response> {
  try {
    assertExpand3AccountPlanEnabled();
    const status = await getBulkRefreshStatus(params.jobId);
    if (!status) {
      return NextResponse.json({ error: 'Job not found', code: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof AccountPlanFeatureDisabledError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
