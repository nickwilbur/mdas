// Per-signal explainer for the composite Risk Score.
//
// Audit ref: F-05 (Phase 2 default-on requirement).
//
// Renders one row per RiskScoreSignal showing the label, the points
// contributed, and which adapter / canonical field the signal was
// grounded in. The point value is rendered with a sign so a negative
// (improving) movement reads as "−3" not "3".
//
// Used on /accounts/[id] to answer "why is this account at risk score N?"
import type { AccountView } from '@mdas/canonical';

const SOURCE_TONE: Record<string, string> = {
  cerebro: 'bg-orange-50 text-orange-800 border-orange-200',
  salesforce: 'bg-blue-50 text-blue-800 border-blue-200',
  gainsight: 'bg-violet-50 text-violet-800 border-violet-200',
  'glean-mcp': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  derived: 'bg-gray-50 text-gray-700 border-gray-200',
  staircase: 'bg-pink-50 text-pink-800 border-pink-200',
  'zuora-mcp': 'bg-yellow-50 text-yellow-800 border-yellow-200',
};

function fmtPoints(p: number): string {
  if (p > 0) return `+${p}`;
  return String(p);
}

export function RiskScoreExplainer({
  riskScore,
}: {
  riskScore: NonNullable<AccountView['riskScore']>;
}): JSX.Element {
  if (riskScore.signals.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No risk signals fired this refresh — score is {riskScore.score} ({riskScore.band}).
      </p>
    );
  }

  // Sort by absolute points desc so the heaviest contributors lead.
  const ordered = [...riskScore.signals].sort(
    (a, b) => Math.abs(b.points) - Math.abs(a.points),
  );
  const total = ordered.reduce((s, x) => s + x.points, 0);
  const capped = total !== riskScore.score;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Composite score is the sum of the signals below, capped at 0–100.
        {riskScore.confidence === 'low' ? (
          <span className="ml-1 text-amber-700">
            Low confidence — Cerebro Risk Category is missing, so this score is
            directional only.
          </span>
        ) : null}
      </p>
      <ul className="space-y-1">
        {ordered.map((s, i) => (
          <li
            key={`${s.field ?? s.source}-${i}`}
            className="flex items-start gap-2 text-sm"
          >
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${SOURCE_TONE[s.source] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}
            >
              {s.source}
            </span>
            <span className="flex-1 text-gray-800">{s.label}</span>
            <span
              className={`shrink-0 tabular-nums font-semibold ${s.points < 0 ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {fmtPoints(s.points)}
            </span>
          </li>
        ))}
        <li className="mt-1 flex items-center gap-2 border-t border-gray-200 pt-2 text-sm font-semibold">
          <span className="flex-1">Total {capped ? '(capped 0–100)' : ''}</span>
          <span className="tabular-nums">
            {capped ? `${total} → ${riskScore.score}` : riskScore.score}
          </span>
        </li>
      </ul>
    </div>
  );
}
