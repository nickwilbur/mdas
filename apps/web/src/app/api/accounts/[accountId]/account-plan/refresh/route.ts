import { NextResponse } from 'next/server';
import {
  assertExpand3AccountPlanEnabled,
  AccountPlanFeatureDisabledError,
  resolveAccountPlanActor,
} from '@/lib/account-plan/feature';
import {
  generatePersistedAccountPlan,
  getPersistedAccountPlan,
  AccountPlanConcurrentError,
  AccountPlanNotEligibleError,
} from '@/lib/account-plan/generate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handleError(err: unknown): Response {
  if (err instanceof AccountPlanFeatureDisabledError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof AccountPlanNotEligibleError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof AccountPlanConcurrentError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  throw err;
}

export async function POST(
  req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  try {
    assertExpand3AccountPlanEnabled();
    const plan = await generatePersistedAccountPlan({
      accountId: params.accountId,
      generationMode: 'manual_refresh',
      generatedBy: resolveAccountPlanActor(req),
      req,
    });
    return NextResponse.json({ plan });
  } catch (err) {
    return handleError(err);
  }
}
