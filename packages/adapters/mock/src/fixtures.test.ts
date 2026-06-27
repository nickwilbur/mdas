import { describe, expect, it } from 'vitest';
import { getMockData, getMockDataPrior } from './fixtures';

describe('getMockDataPrior', () => {
  it('returns a non-empty prior snapshot for seed-prior and WoW flows', () => {
    const current = getMockData();
    const prior = getMockDataPrior();

    expect(prior.accounts.length).toBeGreaterThan(0);
    expect(prior.opportunities.length).toBeGreaterThan(0);
    expect(prior.accounts.length).toBe(current.accounts.length);
    expect(prior.opportunities.length).toBe(current.opportunities.length);
  });

  it('mutates known accounts so current vs prior diffs are non-empty', () => {
    const current = getMockData();
    const prior = getMockDataPrior();

    expect(prior.accounts[0]?.cerebroRiskCategory).toBe('High');
    expect(current.accounts[0]?.cerebroRiskCategory).toBe('Critical');

    expect(prior.accounts[1]?.cseSentiment).toBe('Yellow');
    expect(current.accounts[1]?.cseSentiment).toBe('Red');

    expect(prior.accounts[2]?.workshops).toEqual([]);
    expect(current.accounts[2]?.workshops.length).toBeGreaterThan(0);
  });
});
