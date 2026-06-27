import { describe, it, expect } from 'vitest';
import { classifyFromMdasSignal } from './classify.js';

describe('classifyFromMdasSignal', () => {
  it('treats workshop WoW changes as customer-facing', () => {
    const out = classifyFromMdasSignal({
      kind: 'change_event',
      title: 'workshop',
      summary: 'New workshop logged (0 → 1)',
      field: 'workshops',
      changeCategory: 'workshop',
    });
    expect(out.category).toBe('qbr_ebr_prep');
    expect(out.customerFacing).toBe(true);
  });

  it('keeps risk sentiment changes as health signal review', () => {
    const out = classifyFromMdasSignal({
      kind: 'change_event',
      title: 'risk',
      summary: 'cerebroRisks.shareRisk changed',
      field: 'cerebroRisks.shareRisk',
      changeCategory: 'risk',
    });
    expect(out.customerFacing).toBe(false);
    expect(out.category).toBe('health_signal_review');
  });

  it('treats slack messages as customer-facing', () => {
    const out = classifyFromMdasSignal({
      kind: 'slack',
      title: 'Customer thread',
      summary: 'Discussed renewal timeline',
    });
    expect(out.customerFacing).toBe(true);
    expect(out.category).toBe('customer_follow_up');
  });
});
