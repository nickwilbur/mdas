import type { ReadAdapter } from '@mdas/canonical';
import { getMockData, getMockDataPrior } from './fixtures';

// Mock adapters mirror the same canonical-output contract as real adapters.
// They are intentionally side-effect free.

export const isReadOnly: true = true;

function makeAdapter(name: string): ReadAdapter {
  return {
    name,
    isReadOnly: true,
    async fetch() {
      // First refresh returns "prior" snapshot, subsequent returns "current".
      // For mocks, we always return current; the worker stages a "prior" run during seed.
      return getMockData();
    },
  };
}

export const mockSalesforce = makeAdapter('mock:salesforce');
export const mockCerebroGlean = makeAdapter('mock:cerebro-glean');
export const mockGainsight = makeAdapter('mock:gainsight');
export const mockStaircaseGmail = makeAdapter('mock:staircase-gmail');
export const mockZuoraMcp = makeAdapter('mock:zuora-mcp');
export const mockGleanMcp = makeAdapter('mock:glean-mcp');

export { getMockData, getMockDataPrior };
