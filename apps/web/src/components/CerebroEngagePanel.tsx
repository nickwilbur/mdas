import type { CerebroAccountIntel } from '@/lib/cerebro-account-intel';

function BulletList({ items }: { items: string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function CerebroEngagePanel({
  intel,
  execMode = false,
}: {
  intel: CerebroAccountIntel;
  execMode?: boolean;
}): JSX.Element {
  if (!intel.ok) {
    return (
      <p className="text-sm text-gray-600">
        {intel.unavailableReason ?? 'Cerebro Engage data unavailable for this account.'}
      </p>
    );
  }

  const { summary, team, engagement } = intel;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        {intel.engageHealthUrl ? (
          <a
            href={intel.engageHealthUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline"
          >
            Open health risk in Cerebro Engage ↗
          </a>
        ) : null}
        {intel.engageCatalystsUrl ? (
          <a
            href={intel.engageCatalystsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline"
          >
            Open catalysts in Cerebro Engage ↗
          </a>
        ) : null}
      </div>

      {summary?.headline ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Summary</h3>
          <p className="text-sm font-medium text-gray-900">{summary.headline}</p>
          {summary.asOfDate ? (
            <p className="mt-1 text-xs text-gray-500">As of {summary.asOfDate}</p>
          ) : null}
        </div>
      ) : null}

      {summary?.whatChanged?.length ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">What changed</h3>
          <BulletList items={summary.whatChanged} />
        </div>
      ) : null}

      {summary?.suggestedFocus?.length ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Suggested focus</h3>
          <BulletList items={summary.suggestedFocus} />
        </div>
      ) : null}

      {summary?.risksAndConcerns?.length ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Risks & concerns</h3>
          <BulletList items={summary.risksAndConcerns} />
        </div>
      ) : null}

      {engagement ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Engagement (30d)</h3>
          <p className="text-sm text-gray-800">
            Level: <span className="font-medium capitalize">{engagement.level}</span>
            {' · '}
            {engagement.totalEvents} event{engagement.totalEvents === 1 ? '' : 's'}
            {engagement.latestEngagementDate
              ? ` · latest ${engagement.latestEngagementDate}`
              : null}
          </p>
          {engagement.recentEvents.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {engagement.recentEvents.map((e, i) => (
                <li key={i} className="flex justify-between border-b border-gray-100 py-1">
                  <span>{e.type}</span>
                  <span className="text-xs text-gray-500">
                    {e.date}
                    {e.score != null ? ` · score ${e.score.toFixed(1)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!execMode && team && team.length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Account team (Cerebro)</h3>
          <ul className="space-y-1 text-sm">
            {team.map((m, i) => (
              <li key={i} className="flex justify-between border-b border-gray-100 py-1">
                <span>
                  {m.name}{' '}
                  <span className="text-xs uppercase text-gray-500">{m.role}</span>
                </span>
                {m.email ? (
                  <a href={`mailto:${m.email}`} className="text-xs text-blue-700 hover:underline">
                    {m.email}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!summary?.headline &&
      !summary?.whatChanged?.length &&
      !summary?.suggestedFocus?.length &&
      !engagement ? (
        <p className="text-sm text-gray-500">
          Cerebro Engage recognizes this account but has no synthesis or engagement summary yet.
        </p>
      ) : null}
    </div>
  );
}
