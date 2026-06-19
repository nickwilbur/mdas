import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  probeCerebroEngageRest,
  probeCerebroHealthGlean,
  summarizeCerebroSnapshotQuality,
} from './cerebro-connectors.js';

const origEnv = { ...process.env };

afterEach(() => {
  process.env = { ...origEnv };
  vi.restoreAllMocks();
});

describe('probeCerebroEngageRest', () => {
  it('reports disabled when ADAPTER_CEREBRO is not real', async () => {
    delete process.env.ADAPTER_CEREBRO;
    const status = await probeCerebroEngageRest();
    expect(status.state).toBe('disabled');
    expect(status.ok).toBe(false);
    expect(status.summary).toMatch(/disabled/i);
  });

  it('reports misconfigured when token env is missing', async () => {
    process.env.ADAPTER_CEREBRO = 'real';
    delete process.env.CEREBRO_API_TOKEN;
    delete process.env.CEREBRO_BASE_URL;

    const status = await probeCerebroEngageRest();
    expect(status.state).toBe('misconfigured');
    expect(status.ok).toBe(false);
    expect(status.summary).toMatch(/CEREBRO_API_TOKEN/);
  });
});

describe('probeCerebroHealthGlean', () => {
  it('reports disabled when adapter is off', async () => {
    delete process.env.ADAPTER_CEREBRO;
    const status = await probeCerebroHealthGlean();
    expect(status.state).toBe('disabled');
    expect(status.id).toBe('cerebro-health-glean');
  });

  it('reports misconfigured when Glean creds are missing', async () => {
    process.env.ADAPTER_CEREBRO = 'real';
    delete process.env.GLEAN_MCP_TOKEN;
    delete process.env.GLEAN_MCP_BASE_URL;

    const status = await probeCerebroHealthGlean();
    expect(status.state).toBe('misconfigured');
    expect(status.summary).toMatch(/GLEAN_MCP_TOKEN/);
  });
});

describe('summarizeCerebroSnapshotQuality', () => {
  it('buckets accounts by Engage-only vs Glean-only enrichment', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 100,
        cerebroRiskCategory: 'High',
        cerebroRisks: { utilizationRisk: true },
      },
      {
        allTimeARR: 200,
        cerebroRiskCategory: null,
        cerebroRisks: { engagementRisk: false },
        lastFetchedFromSource: { cerebro: '2026-06-01' },
      },
      {
        allTimeARR: 50,
        cerebroRiskCategory: null,
        cerebroRisks: { suiteRisk: null },
      },
      {
        allTimeARR: 75,
        cerebroRiskCategory: null,
        cerebroRisks: null,
        lastFetchedFromSource: { cerebro: '2026-06-02' },
      },
    ]);

    expect(summary).toEqual({
      withRiskCategory: 1,
      withRiskCategoryARR: 100,
      withBooleansOnly: 2,
      withBooleansOnlyARR: 275,
      withNeither: 1,
      withNeitherARR: 50,
      total: 4,
    });
  });

  it('counts untouched accounts in the neither bucket', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 1_000,
        cerebroRiskCategory: null,
        cerebroRisks: { utilizationRisk: null },
      },
    ]);

    expect(summary.withNeither).toBe(1);
    expect(summary.withNeitherARR).toBe(1_000);
    expect(summary.total).toBe(1);
  });
});
