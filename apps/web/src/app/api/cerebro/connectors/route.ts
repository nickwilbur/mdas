// GET /api/cerebro/connectors — live status for Cerebro Engage REST vs Cerebro/Glean.
import { NextResponse } from 'next/server';
import { getCerebroConnectorStatuses } from '@/lib/cerebro-connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const connectors = await getCerebroConnectorStatuses();
  return NextResponse.json({ connectors });
}
