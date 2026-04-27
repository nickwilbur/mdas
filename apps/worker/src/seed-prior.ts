// Seeds a "prior" refresh run using getMockDataPrior(), so the next refresh
// has a non-empty WoW diff against it.
import { getMockDataPrior } from '@mdas/adapters-mock';
import { runRefresh } from './orchestrate.js';

const prior = getMockDataPrior();
const result = await runRefresh({ actor: 'manual:seed-prior', injected: prior });
console.log('[seed-prior] done', result);
process.exit(0);
