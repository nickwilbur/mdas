// One-shot refresh, useful for `make seed` and CI.
import { runRefresh } from './orchestrate.js';

const result = await runRefresh({ actor: 'manual:cli' });
console.log(JSON.stringify(result, null, 2));
process.exit(0);
