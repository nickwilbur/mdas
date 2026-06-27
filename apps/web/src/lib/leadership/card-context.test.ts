import { describe, expect, it } from 'vitest';
import {
  collectTerms,
  getAttentionContext,
  getExecutiveSummaryContext,
  getHealthAreaContext,
  segmentTextWithTerms,
} from './card-context';

describe('getHealthAreaContext', () => {
  it('returns Team Accountability context grounded in actual MDAS behavior', () => {
    const ctx = getHealthAreaContext('Team Accountability');
    expect(ctx).not.toBeNull();
    expect(ctx!.id).toBe('team-accountability');
    expect(ctx!.measurementNote).toMatch(/does not auto-post/i);
    expect(ctx!.measurementNote).toMatch(/does not measure Slack thread/i);
    expect(ctx!.whatTheSignalMeans).toMatch(/SFDC CSE sentiment commentary/i);
    expect(ctx!.terms.some((t) => t.term === 'manager follow-through gap')).toBe(true);
    expect(ctx!.terms.some((t) => t.term === 'Slack threads not acknowledged')).toBe(true);
  });

  it('states CSEs do not review Engagio in hover context, not on card face', () => {
    const ctx = getHealthAreaContext('Customer Engagement Quality');
    expect(ctx!.whatTheInterpretationMeans).not.toMatch(/marketing scores/i);
    expect(ctx!.measurementNote).toMatch(/not part of the CSE workflow/i);
  });

  it('matches partial area names', () => {
    expect(getHealthAreaContext('Dark / Disengaged Accounts')?.id).toBe('dark-accounts');
  });
});

describe('getExecutiveSummaryContext', () => {
  it('returns engagement gap overview without implying Slack monitoring', () => {
    const ctx = getExecutiveSummaryContext('Engagement gap');
    expect(ctx?.overview).toMatch(/team_aware|commentary/i);
    expect(ctx?.overview).not.toMatch(/Slack repl/i);
  });
});

describe('getAttentionContext', () => {
  it('returns CTA closure context referencing /ctas', () => {
    const ctx = getAttentionContext('CTA closure cadence');
    expect(ctx?.overview).toMatch(/\/ctas/i);
  });
});

describe('segmentTextWithTerms', () => {
  it('highlights team_aware and manager follow-through gap', () => {
    const ctx = getHealthAreaContext('Team Accountability')!;
    const terms = collectTerms(ctx.terms);
    const signal = segmentTextWithTerms('3/31 CTAs `team_aware`; most Slack threads not acknowledged', terms);
    const interp = segmentTextWithTerms(
      'Risk signals are broadcast but not owned in-channel — manager follow-through gap',
      terms,
    );
    expect(signal.some((s) => s.term?.term === 'team_aware')).toBe(true);
    expect(signal.some((s) => s.term?.term === 'Slack threads not acknowledged')).toBe(true);
    expect(interp.some((s) => s.term?.term === 'risk signals are broadcast but not owned in-channel')).toBe(true);
    expect(interp.some((s) => s.term?.term === 'manager follow-through gap')).toBe(true);
  });
});
