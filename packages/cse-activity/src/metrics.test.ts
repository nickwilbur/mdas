import { describe, expect, it } from 'vitest';
import type { AccountView } from '@mdas/canonical';
import {
  assessOverallStatus,
  buildAccountMetrics,
  buildTeamMetrics,
  computeDerivedMetrics,
  dedupeTeamMetrics,
} from './metrics.js';
import type { CseActivityConfig, NormalizedActivity, TeamMemberWeekMetrics } from './types.js';

const config: CseActivityConfig = {
  managerName: 'Manager',
  managerEmail: 'manager@zuora.com',
  teamMembers: [
    {
      name: 'Kiran Rajan',
      email: 'kiran.rajan@zuora.com',
      mdasCseId: 'U-CSE-01',
      active: true,
    },
    {
      name: 'Inactive CSE',
      email: 'inactive@zuora.com',
      mdasCseId: 'U-CSE-99',
      active: false,
    },
  ],
  strategicAccountIds: ['acct-risk'],
  expand3AccountIds: ['acct-risk', 'acct-healthy'],
  renewalRiskAccountIds: ['acct-risk'],
  atrRelevantAccountIds: ['acct-risk'],
  executiveSponsorMappings: {},
  prioritySlackChannels: [],
  customerSlackChannels: [],
  internalCseChannels: [],
  excludedSlackChannels: [],
  analyzePrivateSlackDms: false,
  timezone: 'America/Denver',
  fridayEodTime: '17:00',
  snapshotOutputDir: 'reports/cse_activity_snapshots',
  individualReportOutputDir: 'team_member_reports',
  autoDeliverReports: false,
  enablePdfExport: true,
};

function activity(overrides: Partial<NormalizedActivity>): NormalizedActivity {
  return {
    id: 'act-1',
    source: 'slack',
    occurredAt: '2026-06-18T12:00:00.000Z',
    title: 'Customer sync',
    summary: 'Discussed renewal',
    category: 'customer_follow_up',
    strategicTags: ['renewal_risk_prioritization'],
    qualityTags: ['customer_facing'],
    customerFacing: true,
    evidenceLevel: 'direct',
    ...overrides,
  };
}

function view(accountId: string, bucket: AccountView['bucket'], atrUSD: number): AccountView {
  return {
    account: {
      accountId,
      accountName: accountId,
      franchise: 'Expand 3',
      assignedCSE: { id: 'U-CSE-01', name: 'Kiran Rajan' },
      cseSentiment: bucket === 'Saveable Risk' ? 'Red' : 'Green',
    },
    bucket,
    atrUSD,
    risk: {
      level: bucket === 'Saveable Risk' ? 'High' : 'Low',
      source: 'cerebro',
      rationale: '',
    },
  } as AccountView;
}

describe('buildTeamMetrics', () => {
  it('matches activities by CSE name and skips inactive roster members', () => {
    const metrics = buildTeamMetrics(config, [
      activity({
        teamMemberName: 'Kiran Rajan',
        accountId: 'acct-risk',
        customerFacing: true,
      }),
      activity({
        teamMemberName: 'Inactive CSE',
        accountId: 'acct-healthy',
      }),
    ]);

    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.teamMemberName).toBe('Kiran Rajan');
    expect(metrics[0]!.customerFacingCount).toBe(1);
    expect(metrics[0]!.dataAvailable).toBe(true);
    expect(metrics[0]!.managerNote).toMatch(/Customer-facing motion observed/i);
  });

  it('coaches internal-only motion without customer-facing evidence', () => {
    const metrics = buildTeamMetrics(config, [
      activity({
        teamMemberName: 'Kiran Rajan',
        customerFacing: false,
        category: 'internal_strategy',
      }),
    ]);

    expect(metrics[0]!.managerNote).toMatch(/coaching opportunity on strategic outreach/i);
  });
});

describe('buildAccountMetrics', () => {
  it('prioritizes renewal-risk accounts and surfaces coverage gaps', () => {
    const views = [
      view('acct-healthy', 'Healthy', 10_000),
      view('acct-risk', 'Saveable Risk', 500_000),
    ];
    const metrics = buildAccountMetrics(views, [], config);

    expect(metrics[0]!.accountId).toBe('acct-risk');
    expect(metrics[0]!.gapConcern).toMatch(/High-value renewal risk with no observed activity/i);
    expect(metrics[0]!.recommendedManagerAction).toMatch(/Inspect coverage/i);
  });

  it('marks internal-only accounts and recommends customer-facing coaching', () => {
    const views = [view('acct-risk', 'Saveable Risk', 500_000)];
    const acts = [
      activity({
        accountId: 'acct-risk',
        customerFacing: false,
        category: 'internal_strategy',
        title: 'Internal risk review',
      }),
    ];
    const metrics = buildAccountMetrics(views, acts, config);

    expect(metrics[0]!.internalOnly).toBe(true);
    expect(metrics[0]!.gapConcern).toMatch(/Internal discussion without customer-facing motion/i);
    expect(metrics[0]!.recommendedManagerAction).toMatch(/Coach toward customer-facing next step/i);
  });
});

describe('computeDerivedMetrics', () => {
  it('counts renewal-risk coverage and AI adoption signals', () => {
    const accountMetrics = buildAccountMetrics(
      [view('acct-risk', 'Saveable Risk', 500_000), view('acct-healthy', 'Healthy', 10_000)],
      [
        activity({
          accountId: 'acct-healthy',
          category: 'executive_engagement',
        }),
        activity({
          teamMemberName: 'Kiran Rajan',
          category: 'ai_assisted_workflow',
        }),
      ],
      config,
    );
    const teamMetrics = buildTeamMetrics(config, [
      activity({ teamMemberName: 'Kiran Rajan', category: 'ai_assisted_workflow' }),
    ]);

    const derived = computeDerivedMetrics(
      [
        activity({ accountId: 'acct-healthy', category: 'executive_engagement' }),
        activity({ teamMemberName: 'Kiran Rajan', category: 'ai_assisted_workflow' }),
        activity({ category: 'health_signal_review' }),
        activity({ category: 'renewal_risk_activity', accountId: 'acct-risk' }),
      ],
      accountMetrics,
      teamMetrics,
    );

    expect(derived.highValueRenewalRisksWithoutActivity).toBe(1);
    expect(derived.accountsWithExecutiveEngagement).toBe(1);
    expect(derived.teamMembersUsingAi).toBe(1);
    expect(derived.healthSignalsReviewed).toBe(1);
  });
});

describe('assessOverallStatus', () => {
  it('returns Red when under-covered renewal risks dominate', () => {
    const red = assessOverallStatus(
      {
        highValueRenewalRisksWithActivity: 1,
        highValueRenewalRisksWithoutActivity: 4,
        accountsWithExecutiveEngagement: 0,
        accountsWithCustomerFacingActivity: 2,
        accountsInternalOnly: 1,
        accountsStaleNextSteps: 0,
        healthSignalsReviewed: 0,
        healthSignalsActedOn: 0,
        teamMembersUsingAi: 0,
        aiArtifactsCreated: 0,
        followUpsCreatedOrCompleted: 0,
        accountPlansUpdated: 0,
      },
      8,
      10,
    );
    expect(red.overallStatus).toBe('Red');
    expect(red.confidenceLevel).toBe('High');
  });

  it('returns Green when customer-facing coverage is strong and renewal gaps are low', () => {
    const green = assessOverallStatus(
      {
        highValueRenewalRisksWithActivity: 4,
        highValueRenewalRisksWithoutActivity: 1,
        accountsWithExecutiveEngagement: 2,
        accountsWithCustomerFacingActivity: 6,
        accountsInternalOnly: 1,
        accountsStaleNextSteps: 0,
        healthSignalsReviewed: 2,
        healthSignalsActedOn: 1,
        teamMembersUsingAi: 2,
        aiArtifactsCreated: 3,
        followUpsCreatedOrCompleted: 2,
        accountPlansUpdated: 1,
      },
      7,
      10,
    );
    expect(green.overallStatus).toBe('Green');
    expect(green.strategicPosture).toBe('Proactive');
  });
});

describe('dedupeTeamMetrics', () => {
  it('dedupes by normalized team member name', () => {
    const dupes: TeamMemberWeekMetrics[] = [
      {
        teamMemberId: 'a',
        teamMemberName: 'Kiran Rajan',
        customerFacingCount: 1,
        strategicInternalCount: 0,
        highValueAccountsTouched: 1,
        renewalRisksTouched: 0,
        executiveEngagementCount: 0,
        aiUsageSignal: 'Observed',
        managerNote: '',
        dataAvailable: true,
      },
      {
        teamMemberId: 'b',
        teamMemberName: ' kiran rajan ',
        customerFacingCount: 2,
        strategicInternalCount: 0,
        highValueAccountsTouched: 2,
        renewalRisksTouched: 0,
        executiveEngagementCount: 0,
        aiUsageSignal: 'No direct evidence',
        managerNote: '',
        dataAvailable: true,
      },
    ];
    expect(dedupeTeamMetrics(dupes)).toHaveLength(1);
  });
});
