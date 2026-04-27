import type { AccountView, ChangeEvent, SourceLink } from '@mdas/canonical';

export interface ForecastInput {
  views: AccountView[];
  changeEvents: ChangeEvent[];
  asOfDate: string; // ISO YYYY-MM-DD
  audience?: string; // default 'My Leader + Sales Leadership + CS Leadership'
}

const fmtUSD = (n: number) =>
  n === 0 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`;

function findChange(events: ChangeEvent[], accountId: string, field: string) {
  return events.find((e) => e.accountId === accountId && e.field === field);
}

function sourceFootnote(view: AccountView): string {
  const links: SourceLink[] = [
    ...view.account.sourceLinks,
    ...view.opportunities.flatMap((o) => o.sourceLinks),
  ];
  if (links.length === 0) return `_${view.account.accountName}_`;
  const md = links
    .slice(0, 6)
    .map((l) => `[${l.label}](${l.url})`)
    .join(' • ');
  return `**${view.account.accountName}** — ${md}`;
}

export function generateWeeklyForecast(input: ForecastInput): string {
  const audience =
    input.audience ?? 'My Leader + Sales Leadership + CS Leadership';
  const views = input.views;
  const events = input.changeEvents;

  const confirmedChurn = views.filter((v) => v.bucket === 'Confirmed Churn');
  const saveable = views.filter((v) => v.bucket === 'Saveable Risk');
  const upsellHotActive = views
    .filter((v) => v.upsell.band === 'Hot' || v.upsell.band === 'Active')
    .sort((a, b) => b.upsell.score - a.upsell.score);

  const confirmedSum = views
    .flatMap((v) => v.opportunities)
    .filter((o) => o.mostLikelyConfidence === 'Confirmed')
    .reduce((s, o) => s + (o.forecastMostLikelyOverride ?? o.forecastMostLikely ?? 0), 0);
  const mostLikelySum = views
    .flatMap((v) => v.opportunities)
    .reduce((s, o) => s + (o.forecastMostLikelyOverride ?? o.forecastMostLikely ?? 0), 0);
  const hedgeSum = views
    .flatMap((v) => v.opportunities)
    .reduce((s, o) => s + (o.forecastHedgeUSD ?? 0), 0);

  // Hygiene rollup per CSE
  const cseRollup = new Map<
    string,
    { stale: number; missingNext: number; noWorkshop: number; topAccounts: string[] }
  >();
  for (const v of views) {
    const cse = v.account.assignedCSE?.name ?? 'Unassigned';
    const r =
      cseRollup.get(cse) ?? {
        stale: 0,
        missingNext: 0,
        noWorkshop: 0,
        topAccounts: [],
      };
    for (const x of v.hygiene.violations) {
      if (x.rule === 'stale_sentiment_commentary') r.stale++;
      if (x.rule === 'missing_next_action') r.missingNext++;
      if (x.rule === 'no_workshop_logged') r.noWorkshop++;
    }
    if (v.hygiene.score > 0 && r.topAccounts.length < 3) {
      r.topAccounts.push(v.account.accountName);
    }
    cseRollup.set(cse, r);
  }

  // Churn-notice events (this week)
  const churnNoticeEvents = events.filter(
    (e) => e.category === 'churn-notice',
  );

  // Build per-account WoW summaries for saveable/upsell sections
  const lines: string[] = [];

  lines.push(`# Expand 3 Weekly Forecast Update — ${input.asOfDate}`);
  lines.push('');
  lines.push(`_Audience: ${audience}_`);
  lines.push('');

  // Headline
  const wowMovement = events.length;
  const accountsMoved = new Set(events.map((e) => e.accountId)).size;
  lines.push(`## Headline`);
  lines.push(`- Outlook: Confirmed ${fmtUSD(confirmedSum)} / Most Likely ${fmtUSD(mostLikelySum)} / Hedge ${fmtUSD(hedgeSum)}`);
  lines.push(`- WoW movement: ${wowMovement} change events across ${accountsMoved} accounts`);
  lines.push(`- Coverage to plan: _add manually if not in snapshot_`);
  lines.push('');

  // Confirmed Churn
  lines.push(`## Confirmed Churn — Movements This Week`);
  if (confirmedChurn.length === 0) {
    lines.push(`- None.`);
  } else {
    for (const v of confirmedChurn) {
      const churnUSD = v.opportunities.reduce(
        (s, o) => s + (o.knownChurnUSD ?? 0),
        0,
      );
      const reason =
        v.account.churnReasonSummary ??
        v.account.churnReason ??
        v.opportunities.find((o) => o.churnDownsellReason)?.churnDownsellReason ??
        '_no reason captured_';
      const links = v.account.sourceLinks
        .slice(0, 2)
        .map((l) => `[${l.label}](${l.url})`)
        .join(' • ');
      lines.push(`- **${v.account.accountName}** — ${fmtUSD(churnUSD)}, ${reason}${links ? ' (' + links + ')' : ''}`);
    }
  }
  lines.push('');

  // Saveable Risk
  lines.push(`## Saveable Risk — Movements This Week`);
  if (saveable.length === 0) {
    lines.push(`- None.`);
  } else {
    for (const v of saveable) {
      const riskChange = findChange(events, v.account.accountId, 'cerebroRiskCategory');
      const sentChange = findChange(events, v.account.accountId, 'cseSentiment');
      const riskStr = riskChange
        ? `Risk ${riskChange.oldValue ?? '∅'} → ${riskChange.newValue ?? '∅'}`
        : `Risk ${v.risk.level}`;
      const sentStr = sentChange
        ? `Sentiment ${sentChange.oldValue ?? '∅'} → ${sentChange.newValue ?? '∅'}`
        : `Sentiment ${v.account.cseSentiment ?? '∅'}`;
      const next =
        v.opportunities.map((o) => o.scNextSteps).find((x) => !!x?.trim()) ??
        '_no next step captured_';
      const link = v.account.sourceLinks[0];
      const linkStr = link ? ` ([${link.label}](${link.url}))` : '';
      lines.push(
        `- **${v.account.accountName}** — ${riskStr}, ${sentStr}, ATR ${fmtUSD(v.atrUSD)}, Next: ${String(next).split('\n')[0]?.slice(0, 140)}${linkStr}`,
      );
    }
  }
  lines.push('');

  // Upsell
  lines.push(`## Upsell — Movements This Week`);
  if (upsellHotActive.length === 0) {
    lines.push(`- None.`);
  } else {
    for (const v of upsellHotActive.slice(0, 8)) {
      const opp =
        v.opportunities.find((o) => ['Upsell', 'Cross-Sell'].includes(o.type)) ??
        v.opportunities[0];
      if (!opp) continue;
      const stageEv = events.find(
        (e) => e.opportunityId === opp.opportunityId && e.field === 'stageName',
      );
      const stageStr = stageEv
        ? `stage ${stageEv.oldValue} → ${stageEv.newValue}`
        : `stage ${opp.stageName}`;
      const ws = v.account.workshops
        .filter(
          (w) =>
            w.workshopDate &&
            Date.now() - Date.parse(w.workshopDate) <= 7 * 86400 * 1000,
        )
        .map((w) => w.workshopDate!.slice(0, 10))[0];
      lines.push(
        `- **${v.account.accountName}** — ${opp.opportunityName} ${stageStr}, ACV Δ ${fmtUSD(opp.acvDelta ?? 0)}${ws ? `, workshop ${ws}` : ''} (upsell ${v.upsell.score})`,
      );
    }
  }
  lines.push('');

  // CSE Hygiene Call-Outs
  lines.push(`## CSE Hygiene Call-Outs`);
  if (cseRollup.size === 0) {
    lines.push(`- None.`);
  } else {
    for (const [cse, r] of cseRollup) {
      if (r.stale + r.missingNext + r.noWorkshop === 0) continue;
      lines.push(
        `- @${cse}: ${r.stale} stale sentiment, ${r.missingNext} missing next action, ${r.noWorkshop} no workshop → top accounts: ${r.topAccounts.join(', ') || '_n/a_'}`,
      );
    }
  }
  lines.push('');

  // Asks of Leadership
  lines.push(`## Asks of Leadership`);
  const asks = saveable
    .filter((v) => v.risk.level === 'Critical' || v.risk.level === 'High')
    .slice(0, 5);
  if (asks.length === 0) {
    lines.push(`- None this week.`);
  } else {
    for (const v of asks) {
      const noExec =
        v.account.cerebroSubMetrics?.['Executive Meeting Count (90d)'] === 0;
      const ask = noExec
        ? 'exec sponsor / leadership meeting'
        : 'pricing or commercial review';
      lines.push(
        `- **${v.account.accountName}** — ${ask} (ATR ${fmtUSD(v.atrUSD)}, ${v.risk.level} risk).`,
      );
    }
  }
  lines.push('');

  // Talk Track
  lines.push(`## Talk Track (4–6 bullets for 1:1)`);
  const talkBullets: string[] = [];
  if (saveable.length)
    talkBullets.push(`Top saveable: ${saveable.slice(0, 3).map((v) => v.account.accountName).join(', ')}.`);
  if (confirmedChurn.length)
    talkBullets.push(`Confirmed churn this period: ${confirmedChurn.map((v) => v.account.accountName).join(', ')}.`);
  if (upsellHotActive.length)
    talkBullets.push(`Upsell motion: ${upsellHotActive.slice(0, 3).map((v) => v.account.accountName).join(', ')}.`);
  if (churnNoticeEvents.length)
    talkBullets.push(`New churn notices submitted: ${churnNoticeEvents.length}.`);
  const totalHygiene = views.reduce((s, v) => s + v.hygiene.score, 0);
  talkBullets.push(`Hygiene: ${totalHygiene} rule violations across ${views.filter((v) => v.hygiene.score > 0).length} accounts.`);
  talkBullets.push(`Outlook ${fmtUSD(mostLikelySum)} most likely; ${fmtUSD(hedgeSum)} hedge.`);
  for (const b of talkBullets.slice(0, 6)) lines.push(`- ${b}`);
  lines.push('');

  // Source Evidence
  lines.push(`## Source Evidence`);
  const cited = new Set<string>();
  for (const v of [...confirmedChurn, ...saveable, ...upsellHotActive.slice(0, 8)]) {
    if (cited.has(v.account.accountId)) continue;
    cited.add(v.account.accountId);
    lines.push(`- ${sourceFootnote(v)}`);
  }
  lines.push('');

  return lines.join('\n');
}
