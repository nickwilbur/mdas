import { describe, expect, it } from 'vitest';
import { getMockData, getMockDataPrior } from './fixtures.js';

describe('getMockDataPrior', () => {
  it('mutates real Expand 3 account IDs so WoW diffs are non-empty', () => {
    const current = getMockData();
    const prior = getMockDataPrior();

    expect(current.accounts).toHaveLength(prior.accounts.length);
    expect(current.opportunities).toHaveLength(prior.opportunities.length);

    const adweekId = current.accounts[0]!.accountId;
    const wehcoId = current.accounts[1]!.accountId;
    const quotitId = current.accounts[2]!.accountId;

    expect(adweekId).toMatch(/^001/);
    expect(prior.accounts[0]!.accountId).toBe(adweekId);
    expect(prior.accounts[0]!.cerebroRiskCategory).toBe('High');
    expect(current.accounts[0]!.cerebroRiskCategory).toBe('Critical');

    expect(prior.accounts[1]!.cseSentiment).toBe('Yellow');
    expect(current.accounts[1]!.cseSentiment).toBe('Red');

    expect(prior.accounts[2]!.workshops).toEqual([]);
    expect(current.accounts[2]!.workshops.length).toBeGreaterThan(0);

    const wehcoRenewalCurrent = current.opportunities.find((o) => o.accountId === wehcoId);
    const wehcoRenewalPrior = prior.opportunities.find((o) => o.accountId === wehcoId);
    expect(wehcoRenewalPrior?.stageNum).toBe(2);
    expect(wehcoRenewalCurrent?.stageNum).toBeGreaterThan(2);

    const adweekRenewalPrior = prior.opportunities.find((o) => o.accountId === adweekId);
    expect(adweekRenewalPrior?.fullChurnNotificationToOwnerDate).toBeNull();
    expect(adweekRenewalPrior?.fullChurnFinalEmailSentDate).toBeNull();

    // Guard against stale synthetic IDs silently breaking seed-prior.
    expect([adweekId, wehcoId, quotitId].every((id) => !id.startsWith('0010000000'))).toBe(true);
  });
});
