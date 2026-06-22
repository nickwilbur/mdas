import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapCerebroHealthRecord, mapAccountDetailsItem } from './mapper.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const healthSuccess = JSON.parse(
  readFileSync(join(__dir, 'fixtures/health-risk-success.json'), 'utf8'),
);
const accountDetailsSuccess = JSON.parse(
  readFileSync(join(__dir, 'fixtures/account-details-success.json'), 'utf8'),
);

const REFRESH_AT = new Date('2026-06-15T00:00:00.000Z');

describe('mapAccountDetailsItem', () => {
  it('maps risk category, analysis, and health signals from account details', () => {
    const rec = mapAccountDetailsItem(accountDetailsSuccess.items[0], {
      refreshAt: REFRESH_AT,
    });
    expect(rec).not.toBeNull();
    expect(rec!.patch.cerebroRiskCategory).toBe('High');
    expect(rec!.patch.cerebroRiskAnalysis).toContain('Executive engagement');
    expect(rec!.patch.cerebroRisks?.engagementRisk).toBe(true);
    expect(rec!.patch.cerebroRisks?.utilizationRisk).toBe(true);
    expect(rec!.patch.sourceLinks?.[0]?.source).toBe('cerebro');
  });

  it('normalizes Moderate-to-High to High', () => {
    const item = {
      ...accountDetailsSuccess.items[0],
      customerState: {
        ...accountDetailsSuccess.items[0].customerState,
        risks: {
          ...accountDetailsSuccess.items[0].customerState.risks,
          riskCategory: 'Moderate-to-High',
        },
      },
    };
    const rec = mapAccountDetailsItem(item, { refreshAt: REFRESH_AT });
    expect(rec!.patch.cerebroRiskCategory).toBe('High');
  });

  it('falls back to riskCategoryRationale when riskAnalysis is absent', () => {
    const item = {
      ...accountDetailsSuccess.items[0],
      customerState: {
        ...accountDetailsSuccess.items[0].customerState,
        risks: {
          riskCategory: 'High',
          riskCategoryRationale: 'Elevated share and utilization risks.',
          riskAnalysis: null,
        },
      },
    };
    const rec = mapAccountDetailsItem(item, { refreshAt: REFRESH_AT });
    expect(rec!.patch.cerebroRiskAnalysis).toContain('Elevated share');
  });

  it('falls back to summary headline when only summary is present', () => {
    const item = {
      account: accountDetailsSuccess.items[0].account,
      summary: {
        headline: 'Renewal at risk due to executive disengagement.',
        risksAndConcerns: ['Low meeting cadence'],
      },
      customerState: {
        risks: { riskCategory: 'Medium' },
      },
    };
    const rec = mapAccountDetailsItem(item, { refreshAt: REFRESH_AT });
    expect(rec!.patch.cerebroRiskAnalysis).toContain('executive disengagement');
  });

  it('returns null without salesforce account id', () => {
    const rec = mapAccountDetailsItem({ account: {} }, { refreshAt: REFRESH_AT });
    expect(rec).toBeNull();
  });
});

describe('mapCerebroHealthRecord', () => {
  it('maps risk category and analysis from REST payload', () => {
    const rec = mapCerebroHealthRecord(healthSuccess, {
      refreshAt: REFRESH_AT,
      salesforceAccountId: '0017000000FAKEACE',
    });
    expect(rec).not.toBeNull();
    expect(rec!.patch.cerebroRiskCategory).toBe('High');
    expect(rec!.patch.cerebroRiskAnalysis).toContain('Executive engagement');
    expect(rec!.patch.cerebroRisks?.engagementRisk).toBe(true);
    expect(rec!.patch.sourceLinks?.[0]?.source).toBe('cerebro');
  });

  it('returns null without account id', () => {
    const rec = mapCerebroHealthRecord({}, {
      refreshAt: REFRESH_AT,
      salesforceAccountId: '',
    });
    expect(rec).toBeNull();
  });
});
