import { describe, it, expect } from 'vitest';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { buildCTARecord } from './build.js';
import { DEFAULT_CTA_CONFIG } from './config.js';
import type { PlayCandidate } from './rules.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');
const SCAN = '2026-06-16';

function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'Acme Corp',
    zuoraTenantId: null,
    accountOwner: { id: 'ae', name: 'Alex AE' },
    assignedCSE: { id: 'cse', name: 'Sneha Stephen' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Yellow',
    cseSentimentCommentary: 'Needs exec touchpoint.',
    cseSentimentLastUpdated: '2026-06-01T00:00:00Z',
    cseSentimentCommentaryLastUpdated: '2026-06-01T00:00:00Z',
    cerebroRiskCategory: null,
    cerebroRiskAnalysis: null,
    cerebroRisks: {
      utilizationRisk: null,
      engagementRisk: true,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    },
    cerebroSubMetrics: {},
    allTimeARR: 250_000,
    activeProductLines: [],
    engagementMinutes30d: 5,
    engagementMinutes90d: 20,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: 'https://slack.example/C123',
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function renewalOpp(overrides: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    opportunityId: 'opp-1',
    opportunityName: 'Acme Renewal FY27',
    accountId: '001',
    type: 'Renewal',
    stageName: 'Discovery',
    stageNum: 3,
    closeDate: '2026-08-01',
    closeQuarter: 'Q3',
    fiscalYear: 2027,
    acv: 250_000,
    availableToRenewUSD: 250_000,
    forecastMostLikely: null,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: null,
    forecastHedgeUSD: null,
    acvDelta: null,
    knownChurnUSD: null,
    productLine: null,
    flmNotes: null,
    slmNotes: null,
    scNextSteps: null,
    salesEngineer: null,
    fullChurnNotificationToOwnerDate: null,
    fullChurnFinalEmailSentDate: null,
    churnDownsellReason: null,
    renewalStatus: 'Open',
    sourceLinks: [
      {
        source: 'salesforce',
        url: 'https://zuora.lightning.force.com/lightning/r/Opportunity/006OPP/view',
      },
    ],
    ...overrides,
  };
}

const candidate: PlayCandidate = {
  play_type: 'engagement_risk',
  priority_score: 72,
  drivers: ['Low exec engagement'],
  source_signals: [{ source: 'cerebro', signal: 'engagementRisk=true' }],
  data_gaps: [],
  confidence: 'high',
};

describe('buildCTARecord', () => {
  it('builds a complete CTA with CSE owner, drivers, and dedup key', () => {
    const view = buildAccountView(acct(), [renewalOpp()]);
    const record = buildCTARecord(view, candidate, SCAN, DEFAULT_CTA_CONFIG, NOW);

    expect(record.cta_id).toBe('expand3-2026-06-16-acme-corp-engagement_risk');
    expect(record.primary_owner).toEqual({ name: 'Sneha Stephen', role: 'CSE' });
    expect(record.cc_owners).toEqual([{ name: 'Alex AE', role: 'AE' }]);
    expect(record.dedup_key).toBe('001:engagement_risk');
    expect(record.requested_action).toMatch(/engagement/i);
    expect(record.drivers.some((d) => /renewal date/i.test(d))).toBe(true);
    expect(record.drivers.some((d) => /^arr:/i.test(d))).toBe(true);
    expect(record.renewal_opportunity_url).toContain('006OPP');
    expect(record.renewal_opportunity_name).toBe('Acme Renewal FY27');
    expect(record.destination_slack_channel).toBe('https://slack.example/C123');
    expect(record.data_gaps).toEqual([]);
  });

  it('falls back to AE ownership and records data gaps when CSE and Slack are missing', () => {
    const view = buildAccountView(
      acct({
        assignedCSE: null,
        salesforceSlackChannelUrl: null,
      }),
      [renewalOpp()],
    );
    const record = buildCTARecord(view, candidate, SCAN, DEFAULT_CTA_CONFIG, NOW);

    expect(record.primary_owner).toEqual({ name: 'Alex AE', role: 'AE' });
    expect(record.cc_owners).toEqual([]);
    expect(record.cse).toBeNull();
    expect(record.data_gaps).toEqual(
      expect.arrayContaining(['No CSE assigned (digital coverage)', 'No Slack channel confirmed']),
    );
  });

  it('escalates dark-account risk color when renewal is within 30 days', () => {
    const view = buildAccountView(
      acct({ cseSentiment: 'Green' }),
      [renewalOpp({ closeDate: '2026-06-25' })],
    );
    const record = buildCTARecord(
      view,
      { ...candidate, play_type: 'dark_renewal' },
      SCAN,
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(record.risk_color).toBe('Red');
  });
});
