#!/usr/bin/env tsx
/**
 * Backfill renewal_opportunity_id on legacy expand3_cta_log.jsonl entries
 * by parsing renewal_opportunity_url.
 *
 * Usage: npx tsx scripts/backfill-cta-opportunity-ids.ts
 */

import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
process.chdir(resolve(__dirname, '../apps/web'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { backfillCtaLogOpportunityIds } = require('../apps/web/src/lib/cta-log.ts') as {
  backfillCtaLogOpportunityIds: () => { updated: number; total: number };
};

const result = backfillCtaLogOpportunityIds();
console.log(
  JSON.stringify({
    msg: 'cta.opportunity_id.backfill',
    updated: result.updated,
    total: result.total,
  }),
);
