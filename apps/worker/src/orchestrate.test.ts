import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalAccount,
  CanonicalOpportunity,
  ReadAdapter,
} from '@mdas/canonical';

// ---------------------------------------------------------------------------
// Mock @mdas/db so the orchestrator never touches Postgres. We capture
// the args passed to write/read helpers so the test can assert ordering
// (e.g. that snapshot writes ran in parallel with the baseline lookup).
// ---------------------------------------------------------------------------

const dbCalls: string[] = [];

const {
  startRefreshRun,
  completeRefreshRun,
  baselineRunForWindow,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  writeSnapshotAccounts,
  writeSnapshotOpportunities,
  writeAccountViews,
  replaceSnapshotAccounts,
  replaceSnapshotOpportunities,
  replaceAccountViews,
  pruneOldRuns,
  updateRefreshProgress,
  attachRefreshRunToJob,
  updateRefreshTrajectoryKpis,
  audit,
} = vi.hoisted(() => ({
  startRefreshRun: vi.fn(async () => 'refresh-123'),
  completeRefreshRun: vi.fn(async () => undefined),
  // Use a relaxed return-type for the baseline lookup so individual tests
  // can mockResolvedValue() either null or a real RefreshRun-shaped object
  // without TS narrowing the return type to `null` forever.
  baselineRunForWindow: vi.fn<[string, number], Promise<{ id: string; started_at: string } | null>>(
    async () => null,
  ),
  readSnapshotAccounts: vi.fn<[string], Promise<CanonicalAccount[]>>(async () => []),
  readSnapshotOpportunities: vi.fn<[string], Promise<CanonicalOpportunity[]>>(async () => []),
  writeSnapshotAccounts: vi.fn(async () => undefined),
  writeSnapshotOpportunities: vi.fn(async () => undefined),
  writeAccountViews: vi.fn(async () => undefined),
  replaceSnapshotAccounts: vi.fn(async () => undefined),
  replaceSnapshotOpportunities: vi.fn(async () => undefined),
  replaceAccountViews: vi.fn(async () => undefined),
  pruneOldRuns: vi.fn(async () => 0),
  updateRefreshProgress: vi.fn(async () => undefined),
  attachRefreshRunToJob: vi.fn(async () => undefined),
  updateRefreshTrajectoryKpis: vi.fn(async () => undefined),
  audit: vi.fn(async () => undefined),
}));

vi.mock('@mdas/db', () => ({
  startRefreshRun,
  completeRefreshRun,
  baselineRunForWindow,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  writeSnapshotAccounts,
  writeSnapshotOpportunities,
  writeAccountViews,
  replaceSnapshotAccounts,
  replaceSnapshotOpportunities,
  replaceAccountViews,
  pruneOldRuns,
  updateRefreshProgress,
  attachRefreshRunToJob,
  updateRefreshTrajectoryKpis,
  audit,
  latestSuccessfulRun: vi.fn(async () => null),
}));

// Stub out every real adapter. The orchestrator picks adapters by env
// flag (ADAPTER_*); we leave those unset so only localSnapshots is in
// play. `vi.hoisted` makes the stub accessible inside the hoisted
// `vi.mock` factory below — without it the factory would run before
// the local `const` declaration and crash.
const { fakeLocal } = vi.hoisted(() => ({
  fakeLocal: {
    name: 'local-snapshots',
    source: 'local-snapshots',
    isReadOnly: true as const,
    fetch: vi.fn(async () => ({ accounts: [], opportunities: [] })),
  } as ReadAdapter,
}));

vi.mock('@mdas/adapter-local-snapshots', () => ({
  localSnapshotsAdapter: fakeLocal,
}));
vi.mock('@mdas/adapter-salesforce', () => ({ salesforceAdapter: { name: 'sf', isReadOnly: true, fetch: vi.fn() } }));
const { fakeCerebroRest, fakeCerebroGlean } = vi.hoisted(() => ({
  fakeCerebroRest: {
    name: 'cerebro-rest',
    source: 'cerebro',
    isReadOnly: true as const,
    fetch: vi.fn(async () => ({ accounts: [], opportunities: [] })),
  } as ReadAdapter,
  fakeCerebroGlean: {
    name: 'cerebro-glean',
    source: 'cerebro',
    isReadOnly: true as const,
    fetch: vi.fn(async () => ({ accounts: [], opportunities: [] })),
  } as ReadAdapter,
}));
vi.mock('@mdas/adapter-cerebro-rest', async () => {
  const actual = await vi.importActual<typeof import('@mdas/adapter-cerebro-rest')>(
    '@mdas/adapter-cerebro-rest',
  );
  return {
    ...actual,
    cerebroRestAdapter: fakeCerebroRest,
  };
});
vi.mock('@mdas/adapter-cerebro-glean', () => ({ cerebroGleanAdapter: fakeCerebroGlean }));
vi.mock('@mdas/adapter-gainsight', () => ({ gainsightAdapter: { name: 'gs', isReadOnly: true, fetch: vi.fn() } }));
vi.mock('@mdas/adapter-staircase-gmail', () => ({ staircaseGmailAdapter: { name: 'sg', isReadOnly: true, fetch: vi.fn() } }));
vi.mock('@mdas/adapter-zuora-mcp', () => ({ zuoraMcpAdapter: { name: 'zu', isReadOnly: true, fetch: vi.fn() } }));
vi.mock('@mdas/adapter-glean-mcp', () => ({
  gleanMcpAdapter: { name: 'glean-mcp', source: 'glean-mcp', isReadOnly: true, fetch: vi.fn() },
  readGleanCredsFromEnv: vi.fn(() => undefined),
  GleanClient: vi.fn(),
}));

vi.mock('@mdas/forecast-generator', () => ({
  computeRefreshTrajectoryKpis: vi.fn(() => ({
    asOfDate: '2026-01-01',
    current: { fiscalQuarterKey: 'FY27Q1', fiscalQuarterLabel: 'FY27 Q1', planUSD: null, flashUSD: 0, gapUSD: null, totalRiskUSD: 0, hedgeUSD: 0, redAccountCount: 0, yellowAccountCount: 0, accountCount: 0, opportunityCount: 0 },
    next: { fiscalQuarterKey: 'FY27Q2', fiscalQuarterLabel: 'FY27 Q2', planUSD: null, flashUSD: 0, gapUSD: null, totalRiskUSD: 0, hedgeUSD: 0, redAccountCount: 0, yellowAccountCount: 0, accountCount: 0, opportunityCount: 0 },
  })),
}));

// Mute the logger to keep test output clean.
vi.mock('./logger.js', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import {
  runRefresh,
  partitionAdaptersForFetch,
  mergeSourceLinks,
  mergeCerebroRisks,
  buildCerebroRestCoverage,
} from './orchestrate.js';
import { applySalesforceAuthoritativeSnapshot } from './salesforce-authoritative.js';

// Helpers to keep tests focused. The fixture only carries the fields
// the orchestrator itself reads; we cast through `unknown` because we
// don't want to maintain a full CanonicalAccount shape just for these
// unit tests (the canonical shape has many CSE-specific fields that
// don't influence orchestrator behavior).
const accountFixture = (id: string): CanonicalAccount =>
  ({
    accountId: id,
    accountName: `Acct ${id}`,
    franchise: 'Expand 3',
    allTimeARR: 100_000,
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    gainsightTasks: [],
    sourceLinks: [],
    activeProductLines: [],
    cerebroSubMetrics: {},
    cerebroRisks: {
      utilizationRisk: null,
      engagementRisk: null,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    },
    lastFetchedFromSource: {},
    lastUpdated: new Date().toISOString(),
  } as unknown as CanonicalAccount);

describe('runRefresh — orchestrator', () => {
  beforeEach(() => {
    dbCalls.length = 0;
    vi.clearAllMocks();
    delete process.env.ADAPTER_CEREBRO;
    delete process.env.ADAPTER_GAINSIGHT;
    delete process.env.ADAPTER_GLEAN_MCP;
    delete process.env.ADAPTER_STAIRCASE;
    delete process.env.ADAPTER_ZUORA_MCP;
    delete process.env.ADAPTER_SALESFORCE;
    // Re-arm minimum default mock behavior cleared by clearAllMocks.
    startRefreshRun.mockResolvedValue('refresh-123');
    baselineRunForWindow.mockResolvedValue(null);
    readSnapshotAccounts.mockResolvedValue([]);
    readSnapshotOpportunities.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sections with per-adapter status + duration', async () => {
    (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accounts: [accountFixture('A1'), accountFixture('A2')],
      opportunities: [],
    });

    const result = await runRefresh({ actor: 'test' });

    expect(result.status).toBe('success');
    expect(result.sections).toHaveLength(1);
    const s = result.sections[0]!;
    expect(s.source).toBe('local-snapshots');
    expect(s.status).toBe('success');
    expect(s.accounts).toBe(2);
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof s.refreshedAt).toBe('string');
  });

  it('marks a single failed adapter as section.failed and surfaces the error message', async () => {
    (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('upstream 503'),
    );

    const result = await runRefresh({ actor: 'test' });

    // Only adapter failed → run is 'failed' (succeeded.length === 0).
    expect(result.status).toBe('failed');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      source: 'local-snapshots',
      status: 'failed',
      error: 'upstream 503',
      accounts: 0,
    });
  });

  it('links the job row to the refresh run at start (not at completion) when jobId is supplied', async () => {
    (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accounts: [],
      opportunities: [],
    });

    await runRefresh({ actor: 'test', jobId: 'job-xyz' });

    // The whole point of attaching early is that the status API can see
    // refresh_runs.progress mid-run. So this MUST be called with the run
    // id returned by startRefreshRun, not deferred to completeJob.
    expect(attachRefreshRunToJob).toHaveBeenCalledWith('job-xyz', 'refresh-123');
  });

  it('does not attach a job link when jobId is omitted (refresh-once / tests)', async () => {
    (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accounts: [],
      opportunities: [],
    });

    await runRefresh({ actor: 'test' });

    expect(attachRefreshRunToJob).not.toHaveBeenCalled();
  });

  it('swallows attach failures so the refresh still proceeds', async () => {
    attachRefreshRunToJob.mockRejectedValueOnce(new Error('db down'));
    (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accounts: [accountFixture('A1')],
      opportunities: [],
    });

    // Should NOT throw — the attach is best-effort.
    const result = await runRefresh({ actor: 'test', jobId: 'job-xyz' });
    expect(result.status).toBe('success');
  });

  it('defers glean-mcp until other adapters so it does not compete for Glean rate limits', () => {
    const mk = (name: string, source: string): ReadAdapter =>
      ({ name, source, isReadOnly: true, fetch: vi.fn() }) as ReadAdapter;
    const adapters = [
      mk('local-snapshots', 'local-snapshots'),
      mk('cerebro-rest', 'cerebro'),
      mk('cerebro-glean', 'cerebro'),
      mk('gainsight', 'gainsight'),
      mk('glean-mcp', 'glean-mcp'),
      mk('salesforce', 'salesforce'),
    ];
    const { immediate, deferredCerebroGlean, deferred } = partitionAdaptersForFetch(adapters);
    expect(immediate.map((a) => a.name)).toEqual([
      'local-snapshots',
      'cerebro-rest',
      'gainsight',
      'salesforce',
    ]);
    expect(deferredCerebroGlean.map((a) => a.name)).toEqual(['cerebro-glean']);
    expect(deferred.map((a) => a.name)).toEqual(['glean-mcp']);
  });

  it('keeps cerebro-glean in immediate phase when cerebro-rest is absent', () => {
    const mk = (name: string, source: string): ReadAdapter =>
      ({ name, source, isReadOnly: true, fetch: vi.fn() }) as ReadAdapter;
    const adapters = [mk('cerebro-glean', 'cerebro')];
    const { immediate, deferredCerebroGlean } = partitionAdaptersForFetch(adapters);
    expect(immediate.map((a) => a.name)).toEqual(['cerebro-glean']);
    expect(deferredCerebroGlean).toHaveLength(0);
  });

  // cerebro-glean inclusion policy is covered in cerebro-glean-policy.test.ts.

  it('keeps results from two adapters that share a source (cerebro-rest + cerebro-glean)', async () => {
    // Regression: fetchResults was keyed by `source`, so cerebro-glean
    // (source 'cerebro', runs second) overwrote cerebro-rest's result
    // (also source 'cerebro'), silently dropping Risk Category +
    // narrative from every snapshot. Keying by adapter NAME fixes it.
    process.env.ADAPTER_CEREBRO = 'real';
    process.env.CEREBRO_GLEAN_FALLBACK = '1';
    try {
      (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accounts: [accountFixture('A1')],
        opportunities: [],
      });
      (fakeCerebroRest.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accounts: [
          {
            accountId: 'A1',
            cerebroRiskCategory: 'Critical',
            cerebroRiskAnalysis: 'Paused use of Zuora Revenue.',
          } as unknown as CanonicalAccount,
        ],
        opportunities: [],
      });
      (fakeCerebroGlean.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accounts: [
          {
            accountId: 'A1',
            cerebroRisks: {
              utilizationRisk: true,
              engagementRisk: null,
              suiteRisk: true,
              shareRisk: null,
              legacyTechRisk: null,
              expertiseRisk: true,
              pricingRisk: null,
            },
          } as unknown as CanonicalAccount,
        ],
        opportunities: [],
      });

      await runRefresh({ actor: 'test' });

      const persisted = replaceSnapshotAccounts.mock.calls.at(-1)?.[1] as
        | CanonicalAccount[]
        | undefined;
      const a1 = persisted?.find((a) => a.accountId === 'A1');
      // cerebro-rest's Risk Category survives the merge…
      expect(a1?.cerebroRiskCategory).toBe('Critical');
      expect(a1?.cerebroRiskAnalysis).toBe('Paused use of Zuora Revenue.');
      // …and cerebro-glean's booleans are also merged in.
      expect(a1?.cerebroRisks?.utilizationRisk).toBe(true);
    } finally {
      delete process.env.ADAPTER_CEREBRO;
      delete process.env.CEREBRO_GLEAN_FALLBACK;
    }
  });

  it('preserves cerebro-rest risk flags when cerebro-glean omits them (null)', async () => {
    process.env.ADAPTER_CEREBRO = 'real';
    process.env.CEREBRO_GLEAN_FALLBACK = '1';
    try {
      (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accounts: [accountFixture('A1')],
        opportunities: [],
      });
      (fakeCerebroRest.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accounts: [
          {
            accountId: 'A1',
            cerebroRisks: {
              utilizationRisk: true,
              engagementRisk: null,
              suiteRisk: null,
              shareRisk: null,
              legacyTechRisk: null,
              expertiseRisk: null,
              pricingRisk: null,
            },
          } as unknown as CanonicalAccount,
        ],
        opportunities: [],
      });
      (fakeCerebroGlean.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accounts: [
          {
            accountId: 'A1',
            cerebroRisks: {
              utilizationRisk: null,
              engagementRisk: true,
              suiteRisk: null,
              shareRisk: null,
              legacyTechRisk: null,
              expertiseRisk: null,
              pricingRisk: null,
            },
          } as unknown as CanonicalAccount,
        ],
        opportunities: [],
      });

      await runRefresh({ actor: 'test' });

      const persisted = replaceSnapshotAccounts.mock.calls.at(-1)?.[1] as
        | CanonicalAccount[]
        | undefined;
      const a1 = persisted?.find((a) => a.accountId === 'A1');
      expect(a1?.cerebroRisks?.utilizationRisk).toBe(true);
      expect(a1?.cerebroRisks?.engagementRisk).toBe(true);
    } finally {
      delete process.env.ADAPTER_CEREBRO;
      delete process.env.CEREBRO_GLEAN_FALLBACK;
    }
  });

  it('reuses the priorRun prefetch instead of re-reading for the diff window', async () => {
    // Prefetch returns this run; diff-window query returns the SAME run.
    const priorRunId = 'prior-abc';
    baselineRunForWindow.mockResolvedValue({
      id: priorRunId,
      started_at: new Date().toISOString(),
    });
    readSnapshotAccounts.mockResolvedValue([accountFixture('A1')]);
    readSnapshotOpportunities.mockResolvedValue([]);

    (fakeLocal.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accounts: [accountFixture('A1')],
      opportunities: [],
    });

    await runRefresh({ actor: 'test' });

    // Phase 0 prefetch reads accounts+opps once. Diff-window lookup
    // reuses the same priorRun (no second pair of reads). Therefore
    // each *read* helper is called exactly once.
    expect(readSnapshotAccounts).toHaveBeenCalledTimes(1);
    expect(readSnapshotOpportunities).toHaveBeenCalledTimes(1);
    expect(readSnapshotAccounts).toHaveBeenCalledWith(priorRunId);
  });
});

describe('buildCerebroRestCoverage', () => {
  it('lists account IDs with narrative from REST results', () => {
    const coverage = buildCerebroRestCoverage(
      {
        accounts: [
          { accountId: 'A1', cerebroRiskCategory: 'High' } as CanonicalAccount,
          { accountId: 'A2', cerebroRiskAnalysis: 'Stable.' } as CanonicalAccount,
          { accountId: 'A3' } as CanonicalAccount,
        ],
      },
      true,
    );
    expect(coverage?.enrichedAccountIds.sort()).toEqual(['A1', 'A2']);
    expect(coverage?.restAttempted).toBe(true);
  });

  it('returns undefined when REST was not attempted', () => {
    expect(buildCerebroRestCoverage({ accounts: [] }, false)).toBeUndefined();
  });
});

describe('mergeSourceLinks', () => {
  const sfLink = {
    source: 'salesforce' as const,
    label: 'SFDC Account',
    url: 'https://zuora.my.salesforce.com/lightning/r/Account/001/view',
  };
  const gleanLink = {
    source: 'glean' as const,
    label: 'Account plan',
    url: 'https://docs.google.com/document/d/abc/edit',
  };

  it('dedupes identical URLs within the prior snapshot payload', () => {
    const bloatedPrior = Array.from({ length: 200 }, () => sfLink);
    const merged = mergeSourceLinks(bloatedPrior, [gleanLink]);
    expect(merged).toHaveLength(2);
    expect(merged.map((l) => l.url).sort()).toEqual([gleanLink.url, sfLink.url].sort());
  });

  it('keeps bounded size when simulating many consecutive refresh merges', () => {
    let links = [sfLink, gleanLink];
    for (let refresh = 0; refresh < 100; refresh += 1) {
      links = mergeSourceLinks(links, [sfLink, gleanLink]);
    }
    expect(links).toHaveLength(2);
  });

  it('lets later adapter links override labels for the same URL', () => {
    const updated = mergeSourceLinks([sfLink], [{ ...sfLink, label: 'Updated label' }]);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.label).toBe('Updated label');
  });
});

describe('mergeCerebroRisks', () => {
  const withUtilizationTrue = {
    utilizationRisk: true as const,
    engagementRisk: null,
    suiteRisk: null,
    shareRisk: null,
    legacyTechRisk: null,
    expertiseRisk: null,
    pricingRisk: null,
  };

  it('preserves existing true flags when the patch omits signals (null)', () => {
    const sparse = {
      utilizationRisk: null,
      engagementRisk: true as const,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    };
    expect(mergeCerebroRisks(withUtilizationTrue, sparse)).toEqual({
      utilizationRisk: true,
      engagementRisk: true,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    });
  });

  it('returns existing risks when next is undefined', () => {
    expect(mergeCerebroRisks(withUtilizationTrue, undefined)).toEqual(withUtilizationTrue);
  });
});
