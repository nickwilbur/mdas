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

export async function GET(
  _req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  try {
    assertExpand3AccountPlanEnabled();
    const plan = await getPersistedAccountPlan(params.accountId);
    if (!plan) {
      return NextResponse.json({ error: 'No account plan found', code: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ plan });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  try {
    assertExpand3AccountPlanEnabled();
    const existing = await getPersistedAccountPlan(params.accountId);
    const plan = await generatePersistedAccountPlan({
      accountId: params.accountId,
      generationMode: existing ? 'manual_refresh' : 'single_account',
      generatedBy: resolveAccountPlanActor(req),
      req,
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
