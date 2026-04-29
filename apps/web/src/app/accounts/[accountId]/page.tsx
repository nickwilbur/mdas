import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccount } from '@/lib/read-model';
import {
  BucketBadge,
  Card,
  FreshnessRow,
  GainsightTaskList,
  RelativeTime,
  RiskBadge,
  RiskScoreBadge,
  SentimentBadge,
  SourceLinksGrouped,
  StatTile,
  UpsellBandBadge,
  fmtUSD,
} from '@/components/ui';
import { RiskScoreExplainer } from '@/components/RiskScoreExplainer';
import type { AdapterSource } from '@mdas/canonical';

// Sources we expect to have run for an Expand 3 account when adapters
// are fully configured. Any of these missing from `lastFetchedFromSource`
// will render as a grey "no data" pill so a manager can spot a missing
// integration at a glance (e.g. SF creds expired → no salesforce pill).
const EXPECTED_SOURCES: AdapterSource[] = [
  'salesforce',
  'cerebro',
  'gainsight',
  'glean-mcp',
];

export const dynamic = 'force-dynamic';

// PR-C4 (§3): exec/QBR print mode.
//
// When the URL carries ?mode=exec we render a stripped-down view that
// hides MDAS-internal sections (hygiene scoring, WoW debug feed, raw
// gainsight task list, source links) so the page is appropriate to
// share with a customer or to print for a QBR. The full view stays
// the default — managers should not lose ambient context unless they
// explicitly ask for the curated view.
//
// Print CSS: a <style jsx global> tag below adds @media print rules
// that drop the global nav and the "All accounts" back-link so the
// printed page starts at the H1.
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: { accountId: string };
  // Next 14 App Router exposes searchParams as a Promise; matches the
  // pattern used in @/Users/nick.wilbur/ai/mdas/apps/web/src/app/accounts/page.tsx.
  searchParams: Promise<{ mode?: string }>;
}) {
  const v = await getAccount(params.accountId);
  if (!v) notFound();

  const a = v.account;
  const opps = v.opportunities;
  const { mode } = await searchParams;
  const isExec = mode === 'exec';

  return (
    <div className="space-y-6">
      {/* Print + exec-mode CSS. The selectors target server-rendered
          markup so React hydration isn't required for print to work. */}
      <style>{`
        @media print {
          header, nav, [data-mdas-print="hide"] { display: none !important; }
          body { background: white !important; }
          .shadow-sm, .shadow { box-shadow: none !important; }
          a { color: #1d4ed8 !important; text-decoration: underline; }
        }
      `}</style>
      <div className="flex items-end justify-between" data-mdas-print="hide">
        <div className="space-y-1">
          <Link href="/accounts" className="text-xs text-gray-500 hover:underline">← All accounts</Link>
          <div className="flex items-center gap-2 text-xs">
            {isExec ? (
              <Link
                href={`/accounts/${a.accountId}`}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-50"
              >
                Exit exec view
              </Link>
            ) : (
              <Link
                href={`/accounts/${a.accountId}?mode=exec`}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-50"
              >
                Open in exec / print view
              </Link>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{a.accountName}</h1>
          <div className="flex items-center gap-2 text-sm">
            <BucketBadge bucket={v.bucket} />
            <RiskBadge level={v.risk.level} source={v.risk.source} />
            <SentimentBadge value={a.cseSentiment} />
            <UpsellBandBadge band={v.upsell.band} score={v.upsell.score} />
          </div>
          <FreshnessRow
            freshness={a.lastFetchedFromSource}
            errors={a.sourceErrors}
            expectedSources={EXPECTED_SOURCES}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="ARR" value={fmtUSD(a.allTimeARR)} />
          <StatTile label="ATR" value={fmtUSD(v.atrUSD)} />
          <StatTile label="Renewal" value={v.daysToRenewal == null ? '—' : `${v.daysToRenewal}d`} />
        </div>
      </div>

      {/* PR-B1: per-signal explainer answers "why is this account at
          risk score N?" using the same RiskScoreSignal[] from the
          composite score. Reads from v.riskScore so it gracefully
          degrades when a pre-B1 view loads. */}
      {v.riskScore ? (
        <Card
          title="Risk Score Breakdown"
          right={
            <RiskScoreBadge
              score={v.riskScore.score}
              band={v.riskScore.band}
              confidence={v.riskScore.confidence}
              showLabel
            />
          }
        >
          <RiskScoreExplainer riskScore={v.riskScore} />
        </Card>
      ) : null}

      <Card title="Cerebro Risk Analysis" right={<RiskBadge level={v.risk.level} source={v.risk.source} />}>
        <p className="text-sm text-gray-800">
          {a.cerebroRiskAnalysis ?? <em className="text-gray-500">{v.risk.rationale}</em>}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(a.cerebroRisks).map(([k, val]) => (
            <div key={k} className="rounded border border-gray-200 px-2 py-1 text-xs">
              <div className="text-gray-500">{k}</div>
              <div className={val ? 'font-semibold text-red-700' : 'text-gray-700'}>
                {val == null ? '—' : val ? 'TRUE' : 'false'}
              </div>
            </div>
          ))}
        </div>
        {Object.keys(a.cerebroSubMetrics).length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Sub-metrics</h3>
            <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              {Object.entries(a.cerebroSubMetrics).map(([k, val]) => (
                <li key={k} className="flex justify-between border-b border-gray-100 py-1">
                  <span className="text-gray-600">{k}</span>
                  <span className="font-medium tabular-nums">{val == null ? '—' : String(val)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card
        title="CSE Sentiment Commentary"
        right={
          <span className="text-xs text-gray-500">
            Updated <RelativeTime iso={a.cseSentimentCommentaryLastUpdated} />
          </span>
        }
      >
        <pre className="whitespace-pre-wrap text-sm text-gray-800">{a.cseSentimentCommentary ?? '—'}</pre>
      </Card>

      <Card title={`Open Opportunities (${opps.length})`}>
        <div className="space-y-3">
          {opps.length === 0 && <p className="text-sm text-gray-500">No opportunities.</p>}
          {opps.map((o) => (
            <div key={o.opportunityId} className="rounded border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{o.opportunityName}</div>
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span>{o.type}</span>
                  <span>Stage: {o.stageName}</span>
                  <span>Close: {o.closeDate}</span>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><span className="text-gray-500">ACV</span> <span className="font-medium">{fmtUSD(o.acv)}</span></div>
                <div><span className="text-gray-500">ATR</span> <span className="font-medium">{fmtUSD(o.availableToRenewUSD)}</span></div>
                <div><span className="text-gray-500">Most Likely</span> <span className="font-medium">{fmtUSD(o.forecastMostLikely)}</span></div>
                <div><span className="text-gray-500">ACV Δ</span> <span className={`font-medium ${(o.acvDelta ?? 0) < 0 ? 'text-red-700' : (o.acvDelta ?? 0) > 0 ? 'text-green-700' : ''}`}>{fmtUSD(o.acvDelta)}</span></div>
              </div>
              {o.flmNotes ? (
                <div className="mt-2 text-sm">
                  <div className="text-xs font-semibold uppercase text-gray-500">FLM Notes</div>
                  <div className="text-gray-800">{o.flmNotes}</div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-amber-700">⚠ No FLM Notes</div>
              )}
              {o.scNextSteps ? (
                <div className="mt-2 text-sm">
                  <div className="text-xs font-semibold uppercase text-gray-500">SC Next Steps</div>
                  <div className="text-gray-800">{o.scNextSteps}</div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Workshops (${a.workshops.length})`}>
          <ul className="space-y-1 text-sm">
            {a.workshops.length === 0 && <li className="text-gray-500">No workshops in last 12 months.</li>}
            {a.workshops.map((w) => (
              <li key={w.id} className="flex justify-between border-b border-gray-100 py-1">
                <span>{w.engagementType}</span>
                <span className="text-gray-500">{w.workshopDate?.slice(0, 10) ?? '—'}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Recent Meetings (${a.recentMeetings.length})`}>
          <ul className="space-y-1 text-sm">
            {a.recentMeetings.length === 0 && <li className="text-gray-500">No recent meetings.</li>}
            {a.recentMeetings.map((m, i) => (
              <li key={i} className="flex flex-col border-b border-gray-100 py-1">
                <div className="flex justify-between">
                  <span>{m.title}</span>
                  <span className="text-xs text-gray-500">{m.source} • {m.startTime.slice(0, 10)}</span>
                </div>
                {m.summary && <span className="text-xs text-gray-600">{m.summary}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Hidden in exec mode — Gainsight task hygiene is internal. */}
      {isExec ? null : (
        <Card
          title={`Gainsight Tasks (${a.gainsightTasks.length})`}
          right={
            <span className="text-xs text-gray-500">
              {a.gainsightTasks.filter((t) => !/^closed/i.test(t.status)).length} open
            </span>
          }
        >
          <GainsightTaskList
            tasks={a.gainsightTasks}
            sourceLinkByCtaId={
              new Map(
                a.sourceLinks
                  .filter((l) => l.source === 'gainsight')
                  .map((l) => {
                    const m = l.url.match(/\/cta\/([A-Z0-9]+)/i);
                    return [m?.[1] ?? '', l.url] as [string, string];
                  })
                  .filter(([id]) => id !== ''),
              )
            }
          />
        </Card>
      )}

      <Card title={`Account Plans & Docs (${a.accountPlanLinks.length})`}>
        <ul className="space-y-1 text-sm">
          {a.accountPlanLinks.map((l, i) => (
            <li key={i}><a className="text-blue-700 hover:underline" href={l.url}>{l.title}</a> <span className="text-xs text-gray-500">({l.lastModified.slice(0, 10)})</span></li>
          ))}
        </ul>
      </Card>

      {/* WoW + Hygiene + raw Source Links are MDAS-internal: omitted
          from exec/QBR mode so a customer-facing share doesn't expose
          internal speculation or rule names. */}
      {isExec ? null : (
        <>
          <Card title={`WoW Changes (${v.changeEvents.length})`}>
            <ul className="space-y-1 text-sm">
              {v.changeEvents.length === 0 && <li className="text-gray-500">No changes this week.</li>}
              {v.changeEvents.map((e, i) => (
                <li key={i} className="border-b border-gray-100 py-1">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{e.category}</span> {e.label}
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`Hygiene Issues (${v.hygiene.score})`}>
            <ul className="space-y-2 text-sm">
              {v.hygiene.violations.length === 0 && <li className="text-gray-500">Clean.</li>}
              {v.hygiene.violations.map((h, i) => (
                <li key={i} className="rounded border border-amber-200 bg-amber-50 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{h.rule}</span>
                    <span className="text-[10px] uppercase text-amber-700">{h.confidence}</span>
                  </div>
                  <div className="text-xs text-gray-700">{h.description}</div>
                  <div className="mt-1 text-xs italic text-gray-800">→ {h.coachingPrompt}</div>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title={`Source Links (${
              a.sourceLinks.length + opps.flatMap((o) => o.sourceLinks).length
            })`}
            right={<span className="text-[10px] text-gray-500">📍 = anchored citation</span>}
          >
            <SourceLinksGrouped
              links={[
                ...a.sourceLinks,
                // Prefix each opportunity's links with the opp name so
                // the user can tell which opp each link belongs to once
                // they're sorted alphabetically inside their source bucket.
                ...opps.flatMap((o) =>
                  o.sourceLinks.map((l) => ({
                    ...l,
                    label: `${o.opportunityName} — ${l.label}`,
                  })),
                ),
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
