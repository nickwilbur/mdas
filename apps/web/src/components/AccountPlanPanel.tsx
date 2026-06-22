'use client';

import { useCallback, useState } from 'react';
import type { AccountPlan, PersistedAccountPlan } from '@mdas/account-plan-engine';
import { Card, RelativeTime } from '@/components/ui';

interface Props {
  accountId: string;
  initialPlan: PersistedAccountPlan | null;
  enabled: boolean;
}

function FindingList({ items }: { items: AccountPlan['renewal']['risks'] }) {
  if (items.length === 0) return <p className="text-sm text-gray-500">None identified from available signals.</p>;
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <li key={f.title} className="rounded border border-gray-200 bg-gray-50 p-2 text-sm">
          <div className="font-medium">{f.title}</div>
          <div className="text-gray-600">{f.detail}</div>
          <div className="mt-1 text-xs text-gray-500">
            Confidence: {f.confidence} · Impact: {f.impact}
            {f.sourceSignalIds.length > 0 ? ` · Evidence: ${f.sourceSignalIds.join(', ')}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActionList({ actions }: { actions: AccountPlan['actionPlan'] }) {
  return (
    <ul className="space-y-2">
      {actions.map((a) => (
        <li key={a.action} className="rounded border border-blue-100 bg-blue-50 p-2 text-sm">
          <div className="font-medium">{a.action}</div>
          <div className="text-gray-600">{a.rationale}</div>
          <div className="mt-1 text-xs text-gray-500">
            Owner: {a.ownerRole} · Priority: {a.priority}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AccountPlanPanel({ accountId, initialPlan, enabled }: Props) {
  const [plan, setPlan] = useState<PersistedAccountPlan | null>(initialPlan);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const url = refresh
          ? `/api/accounts/${accountId}/account-plan/refresh`
          : `/api/accounts/${accountId}/account-plan`;
        const res = await fetch(url, { method: 'POST' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Generation failed');
        setPlan(body.plan);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [accountId],
  );

  if (!enabled) return null;

  const p = plan?.plan;

  return (
    <Card
      title="Expand 3 Account Plan"
      right={
        <div className="flex items-center gap-2">
          {plan?.generatedAt ? (
            <span className="text-xs text-gray-500">
              Last generated <RelativeTime iso={plan.generatedAt} />
            </span>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => run(Boolean(plan))}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Generating…' : plan ? 'Refresh Account Plan' : 'Generate Account Plan'}
          </button>
        </div>
      }
    >
      {error ? (
        <p className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>
      ) : null}

      {!p ? (
        <p className="text-sm text-gray-500">
          Generate an evidence-first account plan from Salesforce, CSE sentiment, Cerebro, Glean, and Slack signals.
        </p>
      ) : (
        <div className="space-y-4">
          {(p.dataQuality.collectorFailures.length > 0 ||
            p.dataQuality.missingSignals.length > 0 ||
            p.dataQuality.staleSignals.length > 0) && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">Partial data warnings</div>
              {p.dataQuality.collectorFailures.length > 0 ? (
                <div>Collector failures: {p.dataQuality.collectorFailures.join('; ')}</div>
              ) : null}
              {p.dataQuality.missingSignals.length > 0 ? (
                <div>Missing: {p.dataQuality.missingSignals.join(', ')}</div>
              ) : null}
              {p.dataQuality.staleSignals.length > 0 ? (
                <div>Stale: {p.dataQuality.staleSignals.slice(0, 5).join(', ')}</div>
              ) : null}
            </div>
          )}

          <section>
            <h3 className="text-sm font-semibold">Executive summary</h3>
            <p className="mt-1 text-sm font-medium">{p.summary.headline}</p>
            <p className="mt-1 text-sm text-gray-600">{p.summary.executiveSummary}</p>
            <p className="mt-1 text-xs text-gray-500">
              Renewal: {p.summary.renewalOutlook} · Expansion: {p.summary.expansionPotential} · Confidence:{' '}
              {p.summary.confidence}
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Renewal outlook</h3>
            <p className="mt-1 text-sm text-gray-600">{p.renewal.assessment}</p>
            <FindingList items={p.renewal.risks} />
          </section>

          <section>
            <h3 className="text-sm font-semibold">Expansion opportunities</h3>
            <FindingList items={p.expansion.hypotheses} />
          </section>

          <section>
            <h3 className="text-sm font-semibold">Support and product risk</h3>
            <p className="text-sm text-gray-600">Overall risk: {p.supportAndRisk.overallRisk}</p>
            <FindingList items={p.supportAndRisk.findings} />
          </section>

          <section>
            <h3 className="text-sm font-semibold">Product usage</h3>
            <p className="text-sm text-gray-600">{p.productUsage.usageAssessment}</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold">CSE / customer health</h3>
            <p className="text-sm text-gray-600">{p.customerHealth.healthAssessment}</p>
            {p.customerHealth.cseCommentary ? (
              <p className="mt-1 text-sm text-gray-700">{p.customerHealth.cseCommentary}</p>
            ) : null}
          </section>

          <section>
            <h3 className="text-sm font-semibold">Relationship and engagement</h3>
            <p className="text-sm text-gray-600">{p.relationshipAndEngagement.assessment}</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Recommended next actions</h3>
            <ActionList actions={p.actionPlan} />
          </section>

          <section>
            <h3 className="text-sm font-semibold">Evidence ({p.evidence.length})</h3>
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-xs text-gray-600">
              {p.evidence.slice(0, 20).map((s) => (
                <li key={s.id}>
                  <span className="font-medium">{s.label}:</span> {String(s.value ?? '—')}
                  {s.sourceUrl ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={s.sourceUrl} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                        source
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Data quality</h3>
            {p.dataQuality.conflictingSignals.length > 0 ? (
              <p className="text-sm text-amber-700">Conflicts: {p.dataQuality.conflictingSignals.join('; ')}</p>
            ) : null}
            {p.dataQuality.lowConfidenceSignals.length > 0 ? (
              <p className="text-sm text-gray-600">
                Low confidence signals: {p.dataQuality.lowConfidenceSignals.slice(0, 5).join(', ')}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </Card>
  );
}
