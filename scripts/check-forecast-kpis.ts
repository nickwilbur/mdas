#!/usr/bin/env tsx
import { latestSuccessfulRun, readAccountViews } from '@mdas/db';
import { generateWeeklyForecast } from '@mdas/forecast-generator';

async function main(): Promise<void> {
  const run = await latestSuccessfulRun();
  if (!run) throw new Error('no run');
  const views = (await readAccountViews(run.id)).filter(
    (v) => v.account.franchise === 'Expand 3',
  );
  const md = generateWeeklyForecast({
    views,
    changeEvents: [],
    asOfDate: '2026-06-25',
    plan: { currentQuarterUSD: -2_164_000 },
  });
  console.log(md.split('\n').slice(0, 10).join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
