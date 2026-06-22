import { NextResponse } from 'next/server';
import { assertExpand3AccountPlanEnabled, AccountPlanFeatureDisabledError } from '@/lib/account-plan/feature';
import { listAccountPlanHistory } from '@mdas/db';
import type { PersistedAccountPlan } from '@mdas/account-plan-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rowToPlan(row: Awaited<ReturnType<typeof listAccountPlanHistory>>[number]): PersistedAccountPlan {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name ?? undefined,
    franchise: 'Expand 3',
    status: row.status as PersistedAccountPlan['status'],
    schemaVersion: row.schema_version,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by ?? undefined,
    generationMode: row.generation_mode as PersistedAccountPlan['generationMode'],
    sourceSnapshot: row.source_snapshot as PersistedAccountPlan['sourceSnapshot'],
    plan: row.plan as PersistedAccountPlan['plan'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  try {
    assertExpand3AccountPlanEnabled();
    const rows = await listAccountPlanHistory(params.accountId, 20);
    return NextResponse.json({ history: rows.map(rowToPlan) });
  } catch (err) {
    if (err instanceof AccountPlanFeatureDisabledError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
